"""Real copilot_rbac / copilot_docs / website_connector on the real test PostgreSQL, in WEBSITE mode."""
import io, os, sys, time, types, tempfile, uuid
from dotenv import load_dotenv
load_dotenv()
for k in ["POSTGRES_HOST","POSTGRES_PORT","POSTGRES_DB","POSTGRES_USER","POSTGRES_PASSWORD","AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY"]:
    os.environ.setdefault(k, "x")
KEY = "w" * 48
os.environ.update(WARM_ENTITY_INDEX="0", LOG_DIR=tempfile.mkdtemp(), COPILOT_DB_USER="copilot_app", RBAC_MODE="production",
                  DOCUMENT_UPLOADS="off", COPILOT_SERVICE_KEY=KEY, WEBSITE_AUTH_MODE="service",
                  WEBSITE_DOCS_BUCKET="website-bucket", WEBSITE_DOCS_PREFIX="documents/")
st = types.ModuleType("sentence_transformers")
class _M:
    def __init__(self, *a, **k): pass
    def encode(self, xs, **k): return [[0.0] * 4 for _ in xs]
st.SentenceTransformer = _M; sys.modules["sentence_transformers"] = st
PUT, GOT = [], []
def get_object(Bucket, Key):
    GOT.append((Bucket, Key)); data = b"%PDF-1.4 fake"
    return {"ContentLength": len(data), "Body": io.BytesIO(data)}
fake_client = types.SimpleNamespace(query_vectors=lambda **kw: {"vectors": []}, get_object=get_object,
                                    put_vectors=lambda **kw: PUT.append(len(kw["vectors"])), delete_vectors=lambda **kw: None)
b3 = types.ModuleType("boto3"); b3.client = lambda *a, **k: fake_client; sys.modules["boto3"] = b3
pc = types.ModuleType("pdf_chunker"); pc.chunk_pdf = lambda path: [{"text": "hello world", "page": 1}, {"text": "second", "page": 2}]
sys.modules["pdf_chunker"] = pc
dbc = types.ModuleType("db_connection"); dbc.get_connection = lambda: (_ for _ in ()).throw(AssertionError("direct DB access")); sys.modules["db_connection"] = dbc
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import server, copilot_docs
from fastapi.testclient import TestClient
client = TestClient(server.app, raise_server_exceptions=False)
server.generate_ex = lambda url, prompt, max_new_tokens=0, purpose="": ('{"route":"CHAT","related":false,"question":"hi","names":[],"safety":"ok"}' if purpose == "understand" else "Hello.", {"finish_reason": "stop", "completion_tokens": 5, "cut_off": False})

ok = fail = 0
def check(name, cond, detail=""):
    global ok, fail
    ok, fail = (ok + 1, fail) if cond else (ok, fail + 1)
    print("ok  " if cond else "FAIL", name, "" if cond else detail)

S = {"X-Copilot-Service-Key": KEY}
q = {"question": "hi", "history": [], "session_id": "sess-conn-000001"}
r = client.post("/v1/ask", json=q); check("no secret -> 401", r.status_code == 401, r.text)
r = client.post("/v1/ask", json=q, headers={"X-Demo-User": "seed-u-1"}); check("demo header ignored -> 401", r.status_code == 401, r.text)
r = client.post("/v1/ask", json=q, headers={"X-Copilot-User-Id": "seed-u-1"}); check("user without secret -> 401", r.status_code == 401, r.text)
r = client.post("/v1/ask", json=q, headers={**S, "X-Copilot-User-Id": "nobody-xyz"}); check("unknown user -> 401", r.status_code == 401, r.text)
r = client.post("/v1/ask", json=q, headers={**S, "X-Copilot-User-Id": "seed-u-5"})
check("secret + real user -> 200", r.status_code == 200, r.text[:300])
check("answers as that user", "Priya" in r.json().get("answer", "") or (r.json().get("scope") or {}).get("user_id") == "seed-u-5", r.text[:300])
r = client.post("/ask", json=q, headers={**S, "X-Copilot-User-Id": "seed-u-5"}); check("/ask still works", r.status_code == 200, r.text[:200])
check("no /documents upload", client.get("/documents", headers={**S, "X-Copilot-User-Id": "seed-u-1"}).status_code in (404, 405))
r = client.get("/demo/users"); check("demo user list off", r.status_code != 200 or not r.json(), r.text[:200])

doc = "web-" + uuid.uuid4().hex[:10]
body = {"doc_id": doc, "owner_user_id": "seed-u-5", "filename": "proposal.pdf", "region": "Indore", "s3_key": f"documents/{doc}.pdf"}
check("index without secret -> 401", client.post("/internal/index", json=body).status_code == 401)
r = client.post("/internal/index", json={**body, "s3_key": "other/x.pdf"}, headers=S); check("outside folder -> 400", r.status_code == 400, r.text)
r = client.post("/internal/index", json={**body, "s3_key": "documents/../x.pdf"}, headers=S); check("path trick -> 400", r.status_code == 400, r.text)
r = client.post("/internal/index", json={**body, "region": "East"}, headers=S); check("region not allowed for owner -> 403", r.status_code == 403, r.text)
r = client.post("/internal/index", json=body, headers=S); check("index -> 202 processing", r.status_code == 202 and r.json()["status"] == "processing", r.text)
check("read only the website bucket", GOT[-1] == ("website-bucket", f"documents/{doc}.pdf"), GOT)
for _ in range(50):
    time.sleep(0.1)
    with copilot_docs._tx("seed-u-5") as cur:
        cur.execute('select "Status", "Chunk_Count" from public.copilot_documents where "Doc_ID" = %s', (doc,))
        row = cur.fetchone()
    if row and row[0] != "processing":
        break
check("document ready with chunks", row == ("ready", 2), row)
with copilot_docs._tx("seed-u-14") as cur:
    cur.execute('select count(*) from public.copilot_documents where "Doc_ID" = %s', (doc,))
    other_count = cur.fetchone()[0]
print("   (a user from another region sees", other_count, "copy of it; RLS decides)")
r = client.post("/internal/index", json=body, headers=S); check("same doc again -> 409", r.status_code == 409, r.text)
r = client.post("/internal/remove", json={"doc_id": doc, "requested_by_user_id": "seed-u-2"}, headers=S); check("other user cannot remove (403/404)", r.status_code in (403, 404), r.text)
r = client.post("/internal/remove", json={"doc_id": doc, "requested_by_user_id": "seed-u-5"}, headers=S); check("owner removes -> 200", r.status_code == 200 and r.json()["status"] == "removed", r.text)
r = client.post("/internal/remove", json={"doc_id": doc, "requested_by_user_id": "seed-u-5"}, headers=S); check("removed twice -> 404", r.status_code == 404, r.text)
print(f"\n{ok}/{ok + fail} passed")
