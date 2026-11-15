"""Import server.py with fake RBAC/docs/DB/AWS/embedding modules (no network, no database)."""
import os, sys, types, json, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
for k in ["POSTGRES_HOST","POSTGRES_PORT","POSTGRES_DB","POSTGRES_USER","POSTGRES_PASSWORD","AWS_ACCESS_KEY_ID",
          "AWS_SECRET_ACCESS_KEY","COPILOT_DB_PASSWORD","COPILOT_RBAC_SECRET"]:
    os.environ.setdefault(k, "x")
os.environ["WARM_ENTITY_INDEX"] = "0"
os.environ["WARM_MODELS"] = "0"
os.environ["RAG_MODE"] = "levels"          # older tests use the distance levels; judge-mode tests switch it on
os.environ["LOG_DIR"] = tempfile.mkdtemp()
schema = {"deals": {"columns": {"Deal_ID": "text", "Deal_Name": "text", "Owner_ID": "text", "Deal_Value": "double precision",
                                "Current_Stage": "text", "Status": "text", "Expected_Close_Date": "date", "Updated_At": "timestamp with time zone"}},
          "users": {"columns": {"User_ID": "text", "First_Name": "text", "Last_Name": "text", "Email": "text", "Role": "text",
                                "Region": "text", "Status": "text"}},
          "contacts": {"columns": {"Contact_ID": "text", "First_Name": "text", "Last_Name": "text", "Organization_Name": "text",
                                   "Owner_ID": "text"}},
          "deal_team_members": {"columns": {"Deal_ID": "text", "User_ID": "text"}},
          "tasks": {"columns": {"Task_ID": "text", "Task_Title": "text", "Status": "text", "Due_Date": "date", "Assigned_To": "text"}}}
p = os.path.join(tempfile.mkdtemp(), "schema.json"); json.dump(schema, open(p, "w")); os.environ["SCHEMA_PATH"] = p

st = types.ModuleType("sentence_transformers")
class _M:
    def __init__(self, *a, **k): pass
    def encode(self, xs, **k):
        class V(list):
            def tolist(self): return list(self)
        return [V([0.0] * 4) for _ in xs]
st.SentenceTransformer = _M; sys.modules["sentence_transformers"] = st
b3 = types.ModuleType("boto3"); b3.client = lambda *a, **k: object(); sys.modules["boto3"] = b3
dbc = types.ModuleType("db_connection"); dbc.get_connection = lambda: (_ for _ in ()).throw(AssertionError("direct DB access")); sys.modules["db_connection"] = dbc

from fastapi import APIRouter, Header, HTTPException
from dataclasses import dataclass, field
rb = types.ModuleType("copilot_rbac")
@dataclass
class CurrentUser:
    user_id: str; role: str = "Sales_Rep"; regions: list = field(default_factory=list); name: str = "Test"
rb.CurrentUser = CurrentUser; rb.router = APIRouter()
rb.CALLS = []
def get_current_user(x_demo_user: str | None = Header(default=None)):
    if not x_demo_user: raise HTTPException(401, "no user")
    return CurrentUser(x_demo_user)
rb.get_current_user = get_current_user
_u = {}
rb.set_request_user = lambda u: _u.__setitem__("u", u)
rb.request_user = lambda: _u.get("u")
rb.connect_for_request = lambda ms: rb.CALLS.append(("request", ms)) or (_ for _ in ()).throw(RuntimeError("no db in tests"))
rb.connect_for_lookup = lambda ms: rb.CALLS.append(("lookup", ms)) or (_ for _ in ()).throw(RuntimeError("no db in tests"))
class SqlRejected(Exception):
    security = False
rb.SqlRejected = SqlRejected; rb.check_sql = lambda s: None
rb.audit = lambda **k: rb.CALLS.append(("audit", k))
rb.scope_info = lambda u: {"label": "test", "role": u.role, "role_label": u.role, "regions": u.regions, "user_id": u.user_id, "name": u.name}
rb.visible_sql = lambda u, s: s
sys.modules["copilot_rbac"] = rb
dc = types.ModuleType("copilot_docs"); dc.router = APIRouter(); dc.configure = lambda **k: None
dc.search = lambda user, vec, k: []
sys.modules["copilot_docs"] = dc
sys.path.insert(0, HERE)
import server  # noqa