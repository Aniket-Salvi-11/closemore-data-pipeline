"""
Phase 3 runner (documents) for the PRIVATE demo copy. Needs NO language model.

  1. applies 05_documents.sql (copilot_documents table + its rules)
  2. creates the vector index closemore-docs-demo if it does not exist (384 dims, cosine)
  3. live test with real S3, real S3 Vectors and the real embedding model:
       Priya uploads an Indore PDF, Kenji uploads a Japan PDF, then every persona's
       list, search and delete rights are checked. Test documents are deleted at the end.

Usage:
    python run_phase3.py              # setup + live test
    python run_phase3.py --no-live    # setup only
Put copilot_rbac.py, copilot_docs.py and pdf_chunker.py in the same folder as this file.
"""
import argparse
import os
import sys
import time

import psycopg2

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

RESULTS = []
TEST_PREFIX = "rbac-test-"

PRIYA, RAHUL, NEHA, KENJI, IMRAN = "seed-u-5", "seed-u-12", "seed-u-30", "seed-u-15", "seed-u-6"
MEERA, DEV, ASHA = "seed-u-2", "u-1786635589299-566", "seed-u-1"


def record(name, ok, detail=""):
    RESULTS.append((name, ok))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  - {detail}" if detail else ""))


def admin_connect(uri):
    conn = psycopg2.connect(uri) if uri else psycopg2.connect(
        host=os.getenv("DEMO_POSTGRES_HOST", "localhost"),
        port=int(os.getenv("DEMO_POSTGRES_PORT", "5432")),
        dbname=os.getenv("DEMO_POSTGRES_DB", "closemore_demo"),
        user=os.getenv("DEMO_POSTGRES_USER", "postgres"),
        password=os.getenv("DEMO_POSTGRES_PASSWORD", ""))
    conn.autocommit = True
    return conn


def tiny_pdf(title, lines):
    """A small valid PDF: one bold heading and some body lines."""
    esc = lambda t: t.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    body = " ".join(f"({esc(l)}) Tj T*" for l in lines)
    content = f"BT /F2 16 Tf 72 740 Td ({esc(title)}) Tj ET BT /F1 11 Tf 72 712 Td 15 TL {body} ET"
    objs = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        "/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
        f"<< /Length {len(content)} >>\nstream\n{content}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    ]
    out, offsets = "%PDF-1.4\n", []
    for i, o in enumerate(objs, start=1):
        offsets.append(len(out.encode("latin-1")))
        out += f"{i} 0 obj\n{o}\nendobj\n"
    xref = len(out.encode("latin-1"))
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n" + "".join(f"{o:010d} 00000 n \n" for o in offsets)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    return out.encode("latin-1")


INDORE_PDF = tiny_pdf("Indore Proposal", [
    "This proposal is for the Indore region customer.",
    "The Indore proposal offers a 12 percent discount on annual licences.",
    "Delivery of the Indore project is planned within six weeks of signing.",
])
JAPAN_PDF = tiny_pdf("Japan Warranty Terms", [
    "This document covers the warranty for the Japan region customer.",
    "The Japan warranty lasts three years and includes on-site support.",
    "Claims for the Japan contract must be filed within thirty days.",
])


def setup(admin, create_index=True):
    cur = admin.cursor()
    cur.execute("select current_database()")
    if cur.fetchone()[0] == "closemore_next":
        sys.exit("Refusing to run on the shared database.")
    cur.execute("select to_regclass('rbac.app_secret'), (select 1 from pg_roles where rolname = 'copilot_app')")
    secret_tbl, app_role = cur.fetchone()
    if secret_tbl is None or app_role is None:
        sys.exit("Run phase1/run_phase1.py and phase2/run_phase2.py first.")
    with open(os.path.join(HERE, "05_documents.sql"), encoding="utf-8") as f:
        cur.execute(f.read())
    print("  applied 05_documents.sql")
    cur.execute("select secret from rbac.app_secret limit 1")
    secret = cur.fetchone()[0]
    if os.getenv("COPILOT_RBAC_SECRET") != secret:
        sys.exit("COPILOT_RBAC_SECRET in .env does not match the database. Run phase2/run_phase2.py and copy its line.")
    if create_index:
        import copilot_docs as docs
        s3v = docs._s3v()
        try:
            s3v.get_index(vectorBucketName=docs.VECTOR_BUCKET, indexName=docs.DOCS_INDEX)
            print(f"  vector index {docs.DOCS_INDEX} already exists")
        except Exception:  # noqa: BLE001
            s3v.create_index(vectorBucketName=docs.VECTOR_BUCKET, indexName=docs.DOCS_INDEX, dataType="float32",
                             dimension=docs.EMBED_DIMENSION, distanceMetric="cosine",
                             metadataConfiguration={"nonFilterableMetadataKeys": ["text", "group", "source_file", "page"]})
            print(f"  created vector index {docs.DOCS_INDEX} (384 dims, cosine)")


def live_test(wait_seconds=300):
    import copilot_docs as docs
    import copilot_rbac as rbac
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(rbac.router)
    app.include_router(docs.router)
    client = TestClient(app)
    H = lambda uid: {rbac.DEMO_HEADER: uid}

    def upload(uid, name, data, region):
        return client.post("/documents", headers=H(uid), data={"region": region},
                           files={"file": (name, data, "application/pdf")})

    created = []
    try:
        print("\nREGIONS FOR UPLOAD (GET /me)")
        me_dev = client.get("/me", headers=H(DEV)).json()
        me_priya = client.get("/me", headers=H(PRIYA)).json()
        record("sales admin with no region may upload anywhere",
               me_dev.get("all_regions") is True and {"Indore", "Japan"} <= set(me_dev.get("regions", [])),
               f"{len(me_dev.get('regions', []))} regions")
        record("rep may upload only into own regions", me_priya.get("regions") == ["Indore"], str(me_priya.get("regions")))

        print("\nUPLOADS")
        r = upload(PRIYA, f"{TEST_PREFIX}indore.pdf", INDORE_PDF, "Indore")
        record("Priya uploads an Indore PDF -> 201", r.status_code == 201, r.json().get("status") if r.status_code == 201 else r.text)
        if r.status_code == 201:
            created.append(r.json()["doc_id"])
        indore_id = created[-1] if created else None
        r = upload(KENJI, f"{TEST_PREFIX}japan.pdf", JAPAN_PDF, "japan")
        record("Kenji uploads a Japan PDF (any case of region name) -> 201", r.status_code == 201,
               r.json().get("region") if r.status_code == 201 else r.text)
        if r.status_code == 201:
            created.append(r.json()["doc_id"])
        japan_id = created[-1] if len(created) == 2 else None

        record("Priya cannot upload into Japan -> 403", upload(PRIYA, f"{TEST_PREFIX}x.pdf", INDORE_PDF, "Japan").status_code == 403)
        record("text file -> 415", upload(PRIYA, f"{TEST_PREFIX}x.txt", b"hello", "Indore").status_code == 415)
        record("fake PDF -> 415", upload(PRIYA, f"{TEST_PREFIX}x.pdf", b"not a pdf", "Indore").status_code == 415)
        record("unknown region -> 403", upload(DEV, f"{TEST_PREFIX}x.pdf", INDORE_PDF, "Atlantis").status_code == 403)
        record("no user -> 401", client.post("/documents", data={"region": "Indore"},
                                              files={"file": ("a.pdf", INDORE_PDF, "application/pdf")}).status_code == 401)
        if not (indore_id and japan_id):
            return

        print(f"\nPROCESSING (chunk + embed + store; waiting up to {wait_seconds}s)")
        deadline = time.time() + wait_seconds
        states = {}
        while time.time() < deadline:
            states = {d: client.get(f"/documents/{d}", headers=H(ASHA)).json().get("status") for d in (indore_id, japan_id)}
            if all(s in ("ready", "failed") for s in states.values()):
                break
            time.sleep(2)
        detail = client.get(f"/documents/{indore_id}", headers=H(PRIYA)).json().get("status_detail")
        record("both documents become ready", all(s == "ready" for s in states.values()), f"{states} {detail or ''}")

        print("\nWHO SEES WHICH DOCUMENT (GET /documents)")
        expect = {PRIYA: {indore_id}, RAHUL: {indore_id}, NEHA: {indore_id}, KENJI: {japan_id},
                  IMRAN: set(), MEERA: set(), DEV: {indore_id, japan_id}, ASHA: {indore_id, japan_id}}
        names = {}
        for uid, want in expect.items():
            lst = client.get("/documents", headers=H(uid)).json()
            got = {d["doc_id"] for d in lst if d["filename"].startswith(TEST_PREFIX)}
            names[uid] = rbac.load_user(uid).name
            label = {indore_id: "Indore", japan_id: "Japan"}
            record(f"{names[uid]:14} sees {sorted(label[g] for g in got) or 'nothing'}", got == want,
                   "" if got == want else f"expected {sorted(label[w] for w in want)}")
        record("Kenji cannot open Priya's document -> 404",
               client.get(f"/documents/{indore_id}", headers=H(KENJI)).status_code == 404)

        print("\nRAG SEARCH (what the model would be given)")
        qv = docs._embed().encode(["What discount does the Indore proposal offer?"], normalize_embeddings=True)[0]
        for uid, want in expect.items():
            hits = docs.search(rbac.load_user(uid), [float(x) for x in qv], 8)
            got = {(h.get("metadata") or {}).get("doc_id") for h in hits} & {indore_id, japan_id}
            legacy = sum(1 for h in hits if not (h.get("metadata") or {}).get("doc_id"))
            record(f"{names[uid]:14} search returns only allowed documents", got <= want,
                   f"{len(got)} test doc(s), {legacy} old-index chunk(s)")
        rahul_hits = docs.search(rbac.load_user(RAHUL), [float(x) for x in qv], 8)
        record("Rahul finds Priya's Indore text (same region)",
               any((h.get("metadata") or {}).get("doc_id") == indore_id for h in rahul_hits))

        print("\nDELETE RIGHTS")
        record("Rahul cannot delete Priya's document -> 403",
               client.delete(f"/documents/{indore_id}", headers=H(RAHUL)).status_code == 403)
        record("Kenji cannot delete what he cannot see -> 404",
               client.delete(f"/documents/{indore_id}", headers=H(KENJI)).status_code == 404)
        record("Priya deletes her own document -> 204",
               client.delete(f"/documents/{indore_id}", headers=H(PRIYA)).status_code == 204)
        record("system admin deletes Kenji's document -> 204",
               client.delete(f"/documents/{japan_id}", headers=H(ASHA)).status_code == 204)
        left = docs._s3v().get_vectors(vectorBucketName=docs.VECTOR_BUCKET, indexName=docs.DOCS_INDEX,
                                       keys=[f"{indore_id}#0", f"{japan_id}#0"], returnMetadata=False, returnData=False)
        record("their vectors are removed", not left.get("vectors"))
        created.clear()
    finally:
        for d in created:          # clean up if a step failed
            client.delete(f"/documents/{d}", headers=H(ASHA))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--uri", default=None)
    ap.add_argument("--no-live", action="store_true")
    a = ap.parse_args()
    admin = admin_connect(a.uri)
    print("SETUP")
    setup(admin, create_index=not a.no_live)
    if not a.no_live:
        live_test()
        failed = [n for n, ok in RESULTS if not ok]
        print(f"\nSUMMARY: {len(RESULTS) - len(failed)} passed, {len(failed)} failed")
        for n in failed:
            print(f"  FAILED: {n}")


if __name__ == "__main__":
    main()
