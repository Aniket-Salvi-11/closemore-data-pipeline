"""
AWS permission check for the RAG pipeline (S3 + S3 Vectors).

It tests, with real calls, everything the RBAC document flow needs:
  - who you are (STS)
  - list / describe vector buckets and indexes
  - create a TEMPORARY test index (or reuse an existing one, see --index)
  - put vectors WITH metadata (doc_id, owner_id, region, text)
  - get / list vectors
  - query with a region filter ($eq and $in)
  - overwrite a vector to change its metadata (re-assign region)
  - delete vectors by key, then delete the temporary index
  - optional: normal S3 bucket upload / metadata / tags / delete (--bucket)

Safety: every test vector key starts with "__permtest__<id>-" and is removed at
the end. Nothing else is touched. Credentials come from your normal AWS setup
(~/.aws/credentials, environment variables, or --profile). No keys are printed.

Usage:
  python check_aws_rag_permissions.py --vector-bucket MY_VECTOR_BUCKET
  python check_aws_rag_permissions.py --vector-bucket MY_VECTOR_BUCKET --bucket MY_S3_BUCKET
  python check_aws_rag_permissions.py --vector-bucket B --index EXISTING_INDEX   # if CreateIndex is denied
  Add --region ap-south-1 (or your region) and/or --profile NAME if needed.

Needs a recent boto3:  pip install -U boto3
"""
import argparse
import os
import sys
import time
import uuid

import boto3
from botocore.exceptions import ClientError, NoCredentialsError

RESULTS = []
REPORT = []


def out(line=""):
    print(line)
    REPORT.append(line)


def record(name, ok, detail=""):
    RESULTS.append((name, ok, detail))
    out(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  - {detail}" if detail else ""))


def err_text(e):
    if isinstance(e, ClientError):
        code = e.response.get("Error", {}).get("Code", "")
        msg = e.response.get("Error", {}).get("Message", "")
        return f"{code}: {msg}"[:200]
    return f"{type(e).__name__}: {e}"[:200]


def attempt(name, fn):
    """Run fn; record PASS (with returned detail) or FAIL (with AWS error). Returns result or None."""
    try:
        res = fn()
        detail = res if isinstance(res, str) else ""
        record(name, True, detail)
        return res if res is not None else True
    except Exception as e:  # noqa: BLE001
        record(name, False, err_text(e))
        return None


def vec(dim, i):
    v = [0.0] * dim
    v[i % dim] = 1.0
    if dim > 1:
        v[(i + 1) % dim] = 0.2
    return v


def keys_of(resp):
    return sorted(v["key"] for v in resp.get("vectors", []))


def query_with_retry(client, expect_fn, **kwargs):
    last = None
    for _ in range(4):
        last = client.query_vectors(**kwargs)
        if expect_fn(keys_of(last)):
            return last
        time.sleep(2)
    return last


def test_identity(session):
    out("\n1. WHO YOU ARE")
    def who():
        ident = session.client("sts").get_caller_identity()
        return ident["Arn"]
    attempt("sts:GetCallerIdentity", who)


def test_vectors(session, region, bucket, index_arg):
    out("\n2. S3 VECTORS")
    try:
        client = session.client("s3vectors", region_name=region)
    except Exception as e:  # noqa: BLE001
        record("boto3 s3vectors client", False, f"{err_text(e)} (try: pip install -U boto3)")
        return

    listed = attempt("ListVectorBuckets",
                     lambda: ", ".join(b["vectorBucketName"] for b in
                                       client.list_vector_buckets().get("vectorBuckets", [])) or "no buckets")
    if not bucket:
        out("  (no --vector-bucket given; stopping vector tests)")
        return
    attempt("GetVectorBucket", lambda: client.get_vector_bucket(vectorBucketName=bucket) and "ok")
    indexes = attempt("ListIndexes",
                      lambda: ", ".join(i["indexName"] for i in
                                        client.list_indexes(vectorBucketName=bucket).get("indexes", [])) or "no indexes")

    created = False
    prefix = f"__permtest__{uuid.uuid4().hex[:6]}-"
    if index_arg:
        index = index_arg
        info = attempt("GetIndex (existing)", lambda: client.get_index(vectorBucketName=bucket, indexName=index))
        if not info or info is True:
            return
        dim = client.get_index(vectorBucketName=bucket, indexName=index)["index"]["dimension"]
        out(f"  using existing index '{index}' (dimension {dim}); test keys start with {prefix}")
    else:
        index = f"permtest-{uuid.uuid4().hex[:8]}"
        dim = 4
        ok = attempt("CreateIndex (temporary test index)", lambda: client.create_index(
            vectorBucketName=bucket, indexName=index, dataType="float32",
            dimension=dim, distanceMetric="cosine",
            metadataConfiguration={"nonFilterableMetadataKeys": ["chunk_text"]}) and index)
        if not ok:
            out("  -> CreateIndex denied. Re-run with --index EXISTING_INDEX to test on a real index.")
            return
        created = True

    kw = dict(vectorBucketName=bucket, indexName=index)
    kA0, kA1, kB0 = prefix + "docA#0", prefix + "docA#1", prefix + "docB#0"

    def meta(doc, owner, region_, page):
        return {"doc_id": doc, "owner_id": owner, "region": region_, "page": page,
                "chunk_text": "test chunk"}
    try:
        attempt("PutVectors (3 vectors with metadata)", lambda: client.put_vectors(
            **kw, vectors=[
                {"key": kA0, "data": {"float32": vec(dim, 0)}, "metadata": meta("docA", "u1", "In-south", 1)},
                {"key": kA1, "data": {"float32": vec(dim, 1)}, "metadata": meta("docA", "u1", "In-south", 2)},
                {"key": kB0, "data": {"float32": vec(dim, 2)}, "metadata": meta("docB", "u2", "In-north", 1)},
            ]) and "ok")
        time.sleep(1)

        def got():
            r = client.get_vectors(**kw, keys=[kA0, kB0], returnMetadata=True, returnData=False)
            regions = sorted(v.get("metadata", {}).get("region", "?") for v in r["vectors"])
            return f"metadata read back: {regions}"
        attempt("GetVectors (metadata readable)", got)

        attempt("ListVectors", lambda: f"{len(client.list_vectors(**kw, maxResults=50).get('vectors', []))} vectors")

        q = dict(**kw, topK=10, queryVector={"float32": vec(dim, 0)}, returnMetadata=True, returnDistance=True)

        def f_eq():
            r = query_with_retry(client, lambda k: k == sorted([kA0, kA1]),
                                 **q, filter={"region": {"$eq": "In-south"}})
            k = keys_of(r)
            assert k == sorted([kA0, kA1]), f"expected only In-south chunks, got {k}"
            return "only In-south chunks returned"
        attempt("QueryVectors filter region $eq", f_eq)

        def f_in():
            r = query_with_retry(client, lambda k: k == [kB0],
                                 **q, filter={"region": {"$in": ["In-north", "In-west"]}})
            k = keys_of(r)
            assert k == [kB0], f"expected only the In-north chunk, got {k}"
            return "$in over several regions works (multi-region users)"
        attempt("QueryVectors filter region $in", f_in)

        attempt("PutVectors overwrite (change region)", lambda: client.put_vectors(
            **kw, vectors=[{"key": kA1, "data": {"float32": vec(dim, 1)},
                            "metadata": meta("docA", "u1", "In-north", 2)}]) and "same key replaced")
        time.sleep(1)

        def after_overwrite():
            r = query_with_retry(client, lambda k: k == [kA0],
                                 **q, filter={"region": {"$eq": "In-south"}})
            k = keys_of(r)
            assert k == [kA0], f"expected only docA#0 in In-south now, got {k}"
            return "metadata update by overwrite works"
        attempt("Verify region re-assignment", after_overwrite)

        attempt("DeleteVectors (delete a document's chunks by key)",
                lambda: client.delete_vectors(**kw, keys=[kA0, kA1]) and "ok")
        time.sleep(1)

        def gone():
            r = client.get_vectors(**kw, keys=[kA0, kA1], returnMetadata=False, returnData=False)
            assert not r.get("vectors"), "chunks still present"
            return "deleted chunks no longer returned"
        attempt("Verify deletion", gone)
    finally:
        try:
            client.delete_vectors(**kw, keys=[kA0, kA1, kB0])
        except Exception:  # noqa: BLE001
            pass
        if created:
            attempt("DeleteIndex (cleanup)", lambda: client.delete_index(
                vectorBucketName=bucket, indexName=index) and "temporary index removed")
        else:
            out("  cleanup: test keys removed from existing index")


def test_s3(session, region, bucket):
    out("\n3. NORMAL S3 BUCKET (document files)")
    s3 = session.client("s3", region_name=region)
    key = f"__permtest__/{uuid.uuid4().hex[:8]}.txt"
    attempt("ListBucket", lambda: f"{s3.list_objects_v2(Bucket=bucket, MaxKeys=5).get('KeyCount', 0)} objects (sample)")
    ok = attempt("PutObject with user metadata (owner_id, region)", lambda: s3.put_object(
        Bucket=bucket, Key=key, Body=b"permission test",
        Metadata={"owner_id": "u1", "region": "In-south", "doc_id": "docA"}) and "ok")
    if ok:
        attempt("HeadObject (metadata readable)",
                lambda: f"metadata: {s3.head_object(Bucket=bucket, Key=key).get('Metadata')}")
        attempt("GetObject", lambda: f"{len(s3.get_object(Bucket=bucket, Key=key)['Body'].read())} bytes")
        attempt("PutObjectTagging (tags as alternative metadata)", lambda: s3.put_object_tagging(
            Bucket=bucket, Key=key, Tagging={"TagSet": [{"Key": "region", "Value": "In-south"}]}) and "ok")
        attempt("DeleteObject", lambda: s3.delete_object(Bucket=bucket, Key=key) and "ok")
    attempt("Presigned URL generation (local, no permission needed)", lambda: "ok" if s3.generate_presigned_url(
        "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=60) else "")


def summary():
    out("\n4. SUMMARY")
    failed = [n for n, ok, _ in RESULTS if not ok]
    out(f"  {len(RESULTS) - len(failed)} passed, {len(failed)} failed")
    for n in failed:
        out(f"  FAILED: {n}")
    out("\n  Design notes:")
    out("  - S3 Vectors deletes by KEY, not by metadata. Name chunk keys '<doc_id>#<chunk_no>'")
    out("    and keep the chunk count in the documents table, so a document can be deleted fully.")
    out("  - There is no metadata-update call: re-put the same key to change region/owner.")
    out("  - Anything marked FAIL needs an IAM permission (s3vectors:* / s3:*) from your AWS admin.")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--vector-bucket", default=os.getenv("VECTOR_BUCKET_NAME"))
    p.add_argument("--index", default=None, help="use an existing index instead of creating a temporary one")
    p.add_argument("--bucket", default=None, help="normal S3 bucket to test document upload/metadata/delete")
    p.add_argument("--region", default=os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION"))
    p.add_argument("--profile", default=None)
    a = p.parse_args()

    session = boto3.Session(profile_name=a.profile, region_name=a.region)
    out("AWS RAG PERMISSION CHECK")
    out(f"Region: {session.region_name or '(not set - pass --region)'}")
    try:
        session.client("sts").get_caller_identity()
    except NoCredentialsError:
        out("No AWS credentials found. Check `aws configure list`, or open a NEW terminal if you used setx.")
        sys.exit(1)
    except Exception:  # noqa: BLE001
        pass

    test_identity(session)
    test_vectors(session, a.region, a.vector_bucket, a.index)
    if a.bucket:
        test_s3(session, a.region, a.bucket)
    else:
        out("\n3. NORMAL S3 BUCKET: skipped (pass --bucket NAME to test document uploads)")
    summary()

    with open("aws_rag_permissions_report.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(REPORT))
    print("\nReport saved to aws_rag_permissions_report.txt (no keys inside).")


if __name__ == "__main__":
    main()
