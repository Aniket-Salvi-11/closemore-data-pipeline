"""Contract tests: the parts the CloseMore website depends on must never change shape.
Run:  python test_contract.py

If one of these fails after an optimization, the website integration would break: fix the code, not the test.
Only ADD to the lists below (new optional fields, new connector functions); never remove or rename."""
import inspect
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import test_stubs                      # noqa: E402  (fake database / models / AWS, then imports server)
from fastapi.testclient import TestClient  # noqa: E402
from starlette.requests import Request  # noqa: E402

server = test_stubs.server
import website_connector as wc        # noqa: E402

client = TestClient(server.app, raise_server_exceptions=False)
KEY = "k" * 40

# ---- frozen lists (add only) -------------------------------------------------------------------------
ASK_REQUEST_FIELDS = {"question", "history", "session_id"}
ASK_RESPONSE_FIELDS = {"question", "route", "answer", "sql", "sql_error", "table", "chart", "scope", "sources",
                       "choices", "tables", "request_id", "elapsed_ms", "people", "people_more", "choice_prompt"}
ASK_REQUIRED = {"question", "route", "answer"}
ROUTES = {("POST", "/ask"), ("POST", "/v1/ask"), ("POST", "/feedback"), ("POST", "/v1/feedback"),
          ("GET", "/health"), ("POST", "/internal/index"), ("POST", "/internal/remove")}
CONNECTOR_FUNCTIONS = {"get_website_user": ["request"]}
INDEX_FIELDS = {"doc_id", "owner_user_id", "filename", "region", "s3_key"}
REMOVE_FIELDS = {"doc_id", "requested_by_user_id"}
HEADERS = {"service_key": "X-Copilot-Service-Key", "user": "X-Copilot-User-Id"}


def _req(headers):
    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    return Request({"type": "http", "method": "POST", "path": "/v1/ask", "headers": raw})


def test_ask_request_and_response_fields_are_unchanged():
    req = set(server.AskRequest.model_fields)
    res = server.AskResponse.model_fields
    assert ASK_REQUEST_FIELDS <= req, ASK_REQUEST_FIELDS - req
    assert ASK_RESPONSE_FIELDS <= set(res), ASK_RESPONSE_FIELDS - set(res)
    required = {k for k, f in res.items() if f.is_required()}
    assert required == ASK_REQUIRED, f"new fields must be optional: {required - ASK_REQUIRED}"


def test_routes_exist():
    paths = server.app.openapi()["paths"]
    have = {(m.upper(), p) for p, ops in paths.items() for m in ops}
    assert ROUTES <= have, ROUTES - have
    assert paths["/v1/ask"]["post"]["responses"] == paths["/ask"]["post"]["responses"]       # same answer on both paths
    assert paths["/v1/ask"]["post"]["requestBody"] == paths["/ask"]["post"]["requestBody"]


def test_connector_functions_and_headers_are_unchanged():
    assert wc.CONNECTOR_VERSION == 1
    for name, params in CONNECTOR_FUNCTIONS.items():
        assert list(inspect.signature(getattr(wc, name)).parameters) == params, name
    assert set(wc.IndexRequest.model_fields) == INDEX_FIELDS
    assert set(wc.RemoveRequest.model_fields) == REMOVE_FIELDS
    assert (wc.SERVICE_KEY_HEADER, wc.USER_HEADER) == (HEADERS["service_key"], HEADERS["user"])


def test_service_mode_needs_the_secret():
    os.environ.update(WEBSITE_AUTH_MODE="service", COPILOT_SERVICE_KEY=KEY)
    ok = {"X-Copilot-Service-Key": KEY, "X-Copilot-User-Id": "seed-u-5"}
    assert wc.get_website_user(_req(ok)) == "seed-u-5"
    assert wc.get_website_user(_req({"X-Copilot-User-Id": "seed-u-5"})) is None                 # no secret
    assert wc.get_website_user(_req({**ok, "X-Copilot-Service-Key": "wrong"})) is None           # wrong secret
    assert wc.get_website_user(_req({"X-Copilot-Service-Key": KEY})) is None                     # no user
    os.environ["COPILOT_SERVICE_KEY"] = "short"                                                  # weak secret
    assert wc.get_website_user(_req(ok)) is None
    os.environ["COPILOT_SERVICE_KEY"] = ""                                                       # no secret set
    assert wc.get_website_user(_req({**ok, "X-Copilot-Service-Key": ""})) is None


def test_jwt_mode_checks_signature_and_expiry():
    import time
    import jwt
    secret = "s" * 40
    os.environ.update(WEBSITE_AUTH_MODE="jwt", WEBSITE_JWT_KEY=secret, WEBSITE_JWT_ALGORITHMS="HS256")
    good = jwt.encode({"sub": "seed-u-5", "exp": int(time.time()) + 60}, secret, algorithm="HS256")
    assert wc.get_website_user(_req({"Authorization": f"Bearer {good}"})) == "seed-u-5"
    forged = jwt.encode({"sub": "seed-u-1", "exp": int(time.time()) + 60}, "x" * 40, algorithm="HS256")
    assert wc.get_website_user(_req({"Authorization": f"Bearer {forged}"})) is None             # wrong signature
    old = jwt.encode({"sub": "seed-u-5", "exp": int(time.time()) - 60}, secret, algorithm="HS256")
    assert wc.get_website_user(_req({"Authorization": f"Bearer {old}"})) is None                # expired
    noexp = jwt.encode({"sub": "seed-u-5"}, secret, algorithm="HS256")
    assert wc.get_website_user(_req({"Authorization": f"Bearer {noexp}"})) is None              # no expiry
    assert wc.get_website_user(_req({"X-Copilot-User-Id": "seed-u-1"})) is None                 # header ignored
    os.environ["WEBSITE_AUTH_MODE"] = "something-else"
    assert wc.get_website_user(_req({"Authorization": f"Bearer {good}"})) is None               # unknown mode
    os.environ["WEBSITE_AUTH_MODE"] = "service"


def test_internal_endpoints_refuse_without_the_secret():
    os.environ["COPILOT_SERVICE_KEY"] = KEY
    body = {"doc_id": "d1", "owner_user_id": "seed-u-5", "filename": "a.pdf", "region": "Indore", "s3_key": "x/a.pdf"}
    assert client.post("/internal/index", json=body).status_code == 401
    assert client.post("/internal/index", json=body, headers={"X-Copilot-Service-Key": "wrong"}).status_code == 401
    rm = {"doc_id": "d1", "requested_by_user_id": "seed-u-5"}
    assert client.post("/internal/remove", json=rm).status_code == 401


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_") and callable(v)]
    failed = 0
    for f in tests:
        try:
            f(); print("ok  ", f.__name__)
        except Exception as e:  # noqa: BLE001
            failed += 1; print("FAIL", f.__name__, "->", repr(e))
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
