"""
copilot_docs.py  -  documents for the CloseMore AI Copilot (Phase 3)

Endpoints (see documents-api-contract.md):
    POST   /documents            multipart: file, region   -> 201 list item (+ owner_id, size)
    GET    /documents            documents this user may see
    GET    /documents/{doc_id}   one item (404 if unknown or not visible)
    DELETE /documents/{doc_id}   uploader or system admin  -> 204

search(user, query_vector, top_k)  is what RAG retrieval calls instead of s3vectors.query_vectors:
    1. searches the demo index only in the user's regions (S3 Vectors metadata filter)
    2. re-checks every hit against the copilot_documents table under the user's identity (RLS)
    3. full-view users (system admin, sales admin with no region) also get the old region-less index

Storage
    PDF file : s3://DOCS_BUCKET/DOCS_PREFIX<region>/<owner_id>/<doc_id>.pdf
    Vectors  : index DOCS_INDEX, keys "<doc_id>#<n>", metadata doc_id, owner_id, region, source_file, page, group, text
    Status   : table copilot_documents in the demo database (survives restarts)
Chunking is pdf_chunker.chunk_pdf (the same code as process_s3_bucket.py).

.env (optional, defaults shown)
    DOCS_BUCKET=dev-closemore   DOCS_PREFIX=rbac-demo/   VECTOR_BUCKET=vector-s3-bucket
    DOCS_INDEX=closemore-docs-demo   LEGACY_DOCS_INDEX=closemore-docs   AWS_REGION=ap-south-1
"""
from __future__ import annotations

import logging
import os
import tempfile
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager

import psycopg2
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile

import copilot_rbac as rbac
import pdf_chunker

log = logging.getLogger("copilot.docs")

DOCS_BUCKET = os.getenv("DOCS_BUCKET", "dev-closemore")
DOCS_PREFIX = os.getenv("DOCS_PREFIX", "rbac-demo/")
VECTOR_BUCKET = os.getenv("VECTOR_BUCKET", "vector-s3-bucket")
DOCS_INDEX = os.getenv("DOCS_INDEX", "closemore-docs-demo")
LEGACY_INDEX = os.getenv("LEGACY_DOCS_INDEX", "closemore-docs")
AWS_REGION = os.getenv("AWS_REGION", "ap-south-1")
EMBED_MODEL_NAME = "all-MiniLM-L6-v2"
EMBED_DIMENSION = 384
MAX_BYTES = 20 * 1024 * 1024

_state = {"embed": None, "s3": None, "s3vectors": None}
_worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="doc-worker")


def configure(embed_model=None, s3=None, s3vectors=None):
    """Share objects the server already created (the embedding model, AWS clients)."""
    if embed_model is not None:
        _state["embed"] = embed_model
    if s3 is not None:
        _state["s3"] = s3
    if s3vectors is not None:
        _state["s3vectors"] = s3vectors


def _embed():
    if _state["embed"] is None:
        from sentence_transformers import SentenceTransformer
        _state["embed"] = SentenceTransformer(EMBED_MODEL_NAME)
    return _state["embed"]


def _s3():
    if _state["s3"] is None:
        import boto3
        _state["s3"] = boto3.client("s3", region_name=AWS_REGION)
    return _state["s3"]


def _s3v():
    if _state["s3vectors"] is None:
        import boto3
        _state["s3vectors"] = boto3.client("s3vectors", region_name=AWS_REGION)
    return _state["s3vectors"]


# ---------------------------------------------------------------- database (signed identity, like deals)

@contextmanager
def _tx(user_id, write=False):
    conn = psycopg2.connect(**rbac._db_kwargs())
    try:
        cur = conn.cursor()
        cur.execute("SET TRANSACTION READ WRITE" if write else "SET TRANSACTION READ ONLY")
        cur.execute("SET LOCAL app.current_user_id = %s", (user_id,))
        cur.execute("SET LOCAL app.current_user_sig = %s", (rbac.sign_user(user_id),))
        yield cur
        if write:
            conn.commit()
        else:
            conn.rollback()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


_ITEM_SQL = '''
    select d."Doc_ID", d."Filename", d."Region", d."Owner_ID",
           coalesce(nullif(btrim(coalesce(u."First_Name", '') || ' ' || coalesce(u."Last_Name", '')), ''), d."Owner_ID"),
           d."Size_Bytes", d."Status", d."Status_Detail", d."Uploaded_At"
      from copilot_documents d
      left join users u on u."User_ID" = d."Owner_ID"
'''


def _item(row, user):
    doc_id, filename, region, owner_id, owner_name, size, status, detail, uploaded = row
    return {
        "doc_id": doc_id, "filename": filename, "region": region,
        "owner_id": owner_id, "owner_name": owner_name, "size": size,
        "status": status, "status_detail": detail if status == "failed" else None,
        "uploaded_at": uploaded.isoformat() if uploaded else None,
        "can_delete": owner_id == user.user_id or user.role in rbac.FULL_VIEW_ROLES,
    }


def _get_item(user, doc_id):
    with _tx(user.user_id) as cur:
        cur.execute(_ITEM_SQL + ' where d."Doc_ID" = %s', (doc_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Document not found.")
    return _item(row, user)


def _set_status(owner_id, doc_id, status, detail=None, chunk_count=0):
    try:
        with _tx(owner_id, write=True) as cur:
            cur.execute("select rbac.doc_set_status(%s, %s, %s, %s)", (doc_id, status, detail, chunk_count))
            return bool(cur.fetchone()[0])
    except Exception:  # noqa: BLE001
        log.exception(f"could not set status {status} for {doc_id}")
        return False


def _delete_vectors(doc_id, count):
    keys = [f"{doc_id}#{i}" for i in range(count or 0)]
    for i in range(0, len(keys), 500):
        try:
            _s3v().delete_vectors(vectorBucketName=VECTOR_BUCKET, indexName=DOCS_INDEX, keys=keys[i:i + 500])
        except Exception:  # noqa: BLE001
            log.exception(f"could not delete vectors of {doc_id}")


# ---------------------------------------------------------------- background processing

def _process(owner_id, doc_id, filename, region, data):
    """Chunk -> embed -> store vectors -> mark ready. Runs in the background worker."""
    written, path = 0, None
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(data)
            path = f.name
        try:
            chunks = pdf_chunker.chunk_pdf(path)
        except Exception as e:  # noqa: BLE001
            raise ValueError("The PDF could not be read.") from e
        chunks = [c for c in chunks if (c.get("text") or "").strip()]
        if not chunks:
            raise ValueError("No readable text was found in the PDF.")
        embeddings = _embed().encode([c["text"] for c in chunks], normalize_embeddings=True)
        vectors = [{
            "key": f"{doc_id}#{i}",
            "data": {"float32": [float(x) for x in emb]},
            "metadata": {
                "doc_id": doc_id, "owner_id": owner_id, "region": region,
                "source_file": filename, "page": c["page"],
                "group": (c.get("group") or "")[:500], "text": c["text"][:2000],
            },
        } for i, (c, emb) in enumerate(zip(chunks, embeddings))]
        for i in range(0, len(vectors), 500):
            batch = vectors[i:i + 500]
            _s3v().put_vectors(vectorBucketName=VECTOR_BUCKET, indexName=DOCS_INDEX, vectors=batch)
            written = i + len(batch)
        if not _set_status(owner_id, doc_id, "ready", None, len(vectors)):
            _delete_vectors(doc_id, len(vectors))          # deleted while it was processing
        log.info(f"document {doc_id} ready ({len(vectors)} chunks)")
    except Exception as e:  # noqa: BLE001
        log.exception(f"document {doc_id} failed")
        _delete_vectors(doc_id, written)
        detail = str(e) if isinstance(e, ValueError) else "Processing failed."
        _set_status(owner_id, doc_id, "failed", detail, 0)
    finally:
        if path:
            try:
                os.unlink(path)
            except OSError:
                pass


# ---------------------------------------------------------------- RAG search

def search(user, query_vector, top_k):
    """Chunks this user may see, nearest first, in the s3vectors query_vectors hit format."""
    if user is None:
        return []
    hits = []
    if user.is_full_view or user.regions:
        kw = dict(vectorBucketName=VECTOR_BUCKET, indexName=DOCS_INDEX, queryVector={"float32": list(query_vector)},
                  topK=top_k, returnMetadata=True, returnDistance=True)
        if not user.is_full_view:
            kw["filter"] = {"region": {"$in": list(user.regions)}}
        try:
            found = _s3v().query_vectors(**kw).get("vectors", [])
        except Exception:  # noqa: BLE001
            log.exception("demo document search failed")
            found = []
        ids = sorted({(h.get("metadata") or {}).get("doc_id") for h in found} - {None})
        visible = set()
        if ids:
            with _tx(user.user_id) as cur:     # second check: the database decides, under RLS
                cur.execute('select "Doc_ID" from copilot_documents where "Doc_ID" = any(%s) and "Status" = %s',
                            (ids, "ready"))
                visible = {r[0] for r in cur.fetchall()}
        hits += [h for h in found if (h.get("metadata") or {}).get("doc_id") in visible]
    if user.is_full_view and LEGACY_INDEX:
        try:
            hits += _s3v().query_vectors(
                vectorBucketName=VECTOR_BUCKET, indexName=LEGACY_INDEX, queryVector={"float32": list(query_vector)},
                topK=top_k, returnMetadata=True, returnDistance=True).get("vectors", [])
        except Exception:  # noqa: BLE001
            log.exception("legacy document search failed")
    hits.sort(key=lambda h: h.get("distance") if h.get("distance") is not None else 9)
    return hits[:top_k]


# ---------------------------------------------------------------- routes

router = APIRouter()


@router.post("/documents", status_code=201)
def upload(file: UploadFile = File(...), region: str = Form(...),
           user: rbac.CurrentUser = Depends(rbac.get_current_user)):
    filename = os.path.basename((file.filename or "").replace("\\", "/"))[:200] or "document.pdf"
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=415, detail="Only PDF files are accepted.")
    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="The file is larger than 20 MB.")
    if not data:
        raise HTTPException(status_code=400, detail="The file is empty.")
    if not data.startswith(b"%PDF-"):
        raise HTTPException(status_code=415, detail="Only PDF files are accepted.")

    wanted = (region or "").strip().lower()
    allowed = {r.lower(): r for r in rbac.upload_regions(user)}
    if not wanted:
        raise HTTPException(status_code=400, detail="A region is required.")
    if wanted not in allowed:
        raise HTTPException(status_code=403, detail="You cannot upload into that region.")
    region = allowed[wanted]

    doc_id = str(uuid.uuid4())
    s3_key = f"{DOCS_PREFIX}{region}/{user.user_id}/{doc_id}.pdf"
    try:
        with _tx(user.user_id, write=True) as cur:
            cur.execute("select rbac.doc_create(%s, %s, %s, %s, %s)", (doc_id, filename, region, len(data), s3_key))
    except psycopg2.errors.InsufficientPrivilege:
        raise HTTPException(status_code=403, detail="You cannot upload into that region.")

    try:
        _s3().put_object(Bucket=DOCS_BUCKET, Key=s3_key, Body=data, ContentType="application/pdf",
                         Metadata={"doc_id": doc_id, "owner_id": user.user_id, "region": region})
    except Exception:  # noqa: BLE001
        log.exception(f"S3 upload failed for {doc_id}")
        _set_status(user.user_id, doc_id, "failed", "The file could not be stored.", 0)
        return _get_item(user, doc_id)

    _worker.submit(_process, user.user_id, doc_id, filename, region, data)
    rbac.audit(event="document_upload", user_id=user.user_id, role=user.role, doc_id=doc_id,
               region=region, filename=filename, size=len(data))
    return _get_item(user, doc_id)


@router.get("/documents")
def list_documents(user: rbac.CurrentUser = Depends(rbac.get_current_user)):
    with _tx(user.user_id) as cur:
        cur.execute(_ITEM_SQL + ' order by d."Uploaded_At" desc')
        rows = cur.fetchall()
    return [_item(r, user) for r in rows]


@router.get("/documents/{doc_id}")
def get_document(doc_id: str, user: rbac.CurrentUser = Depends(rbac.get_current_user)):
    return _get_item(user, doc_id)


@router.delete("/documents/{doc_id}", status_code=204)
def delete_document(doc_id: str, user: rbac.CurrentUser = Depends(rbac.get_current_user)):
    try:
        with _tx(user.user_id, write=True) as cur:
            cur.execute("select * from rbac.doc_delete(%s)", (doc_id,))
            s3_key, chunk_count, _status = cur.fetchone()
    except psycopg2.errors.NoDataFound:
        raise HTTPException(status_code=404, detail="Document not found.")
    except psycopg2.errors.InsufficientPrivilege:
        raise HTTPException(status_code=403, detail="Only the uploader or a system admin can delete this document.")
    _delete_vectors(doc_id, chunk_count)      # a document still processing is cleaned up by its worker
    if s3_key:
        try:
            _s3().delete_object(Bucket=DOCS_BUCKET, Key=s3_key)
        except Exception:  # noqa: BLE001
            log.exception(f"could not delete s3://{DOCS_BUCKET}/{s3_key}")
    rbac.audit(event="document_delete", user_id=user.user_id, role=user.role, doc_id=doc_id)
    return Response(status_code=204)


# ---------------------------------------------------------------- website uploads (called through website_connector.py)
# The website stores the PDF in its own S3 bucket and calls POST /internal/index. The same rules as an upload in the
# Copilot apply, checked by the same functions: the owner must be an active user who may upload into that region
# (rbac.upload_regions + rbac.doc_create under the owner's own database identity).

def index_from_s3(doc_id, owner_id, filename, region, bucket, key, allowed_prefix=""):
    doc_id, owner_id, key = (doc_id or "").strip(), (owner_id or "").strip(), (key or "").strip()
    filename = os.path.basename((filename or "").replace("\\", "/"))[:200] or "document.pdf"
    if not doc_id or len(doc_id) > 128:
        raise HTTPException(status_code=400, detail="A doc_id of at most 128 characters is required.")
    if not bucket:
        raise HTTPException(status_code=503, detail="WEBSITE_DOCS_BUCKET is not configured.")
    if not key or ".." in key.split("/") or not key.startswith(allowed_prefix or ""):
        raise HTTPException(status_code=400, detail="The file must be inside the website's documents folder.")
    user = rbac.load_user(owner_id)
    if not user:
        raise HTTPException(status_code=404, detail="Unknown or inactive owner.")
    allowed = {r.lower(): r for r in rbac.upload_regions(user)}
    wanted = (region or "").strip().lower()
    if wanted not in allowed:
        raise HTTPException(status_code=403, detail="The owner cannot upload into that region.")
    region = allowed[wanted]

    try:
        obj = _s3().get_object(Bucket=bucket, Key=key)
        if int(obj.get("ContentLength") or 0) > MAX_BYTES:
            raise HTTPException(status_code=413, detail="The file is larger than 20 MB.")
        data = obj["Body"].read(MAX_BYTES + 1)
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001
        log.exception(f"could not read s3://{bucket}/{key}")
        raise HTTPException(status_code=404, detail="The file could not be read from S3.")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="The file is larger than 20 MB.")
    if not data.startswith(b"%PDF-"):
        raise HTTPException(status_code=415, detail="Only PDF files are accepted.")

    try:
        with _tx(user.user_id, write=True) as cur:
            cur.execute("select rbac.doc_create(%s, %s, %s, %s, %s)", (doc_id, filename, region, len(data), key))
    except psycopg2.errors.UniqueViolation:
        raise HTTPException(status_code=409, detail="This doc_id is already indexed. Remove it first to re-index.")
    except psycopg2.errors.InsufficientPrivilege:
        raise HTTPException(status_code=403, detail="The owner cannot upload into that region.")

    _worker.submit(_process, user.user_id, doc_id, filename, region, data)
    rbac.audit(event="document_index", user_id=user.user_id, role=user.role, doc_id=doc_id,
               region=region, filename=filename, size=len(data), source="website")
    return {"doc_id": doc_id, "status": "processing"}


def remove_indexed(doc_id, user_id):
    """Remove a website document from search. The PDF stays in the website's bucket (the website owns it)."""
    user = rbac.load_user((user_id or "").strip())
    if not user:
        raise HTTPException(status_code=404, detail="Unknown or inactive user.")
    try:
        with _tx(user.user_id, write=True) as cur:
            cur.execute("select * from rbac.doc_delete(%s)", ((doc_id or "").strip(),))
            _s3_key, chunk_count, _status = cur.fetchone()
    except psycopg2.errors.NoDataFound:
        raise HTTPException(status_code=404, detail="Document not found.")
    except psycopg2.errors.InsufficientPrivilege:
        raise HTTPException(status_code=403, detail="Only the uploader or a system admin can remove this document.")
    _delete_vectors(doc_id, chunk_count)
    rbac.audit(event="document_remove", user_id=user.user_id, role=user.role, doc_id=doc_id, source="website")
    return {"doc_id": doc_id, "status": "removed"}
