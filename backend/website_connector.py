"""
website_connector.py  -  the ONLY file that connects the CloseMore website to the AI Copilot.

    CloseMore website  --->  website_connector.py  --->  AI Copilot (all other files)
    (login, uploads,         (this file: fixed            (changed and optimized
     chat window, DB)         function names)              by the AI team)

Rules
  * The website team owns this file and may edit the INSIDE of the functions below to fit their login and uploads.
  * The AI team never changes this file. When the AI files are upgraded, keep your copy of this file and your .env.
  * The function NAMES, their arguments and what they return never change (CONNECTOR_VERSION). If the AI side ever
    needs something new, a NEW function is added; existing ones keep working.
  * Who may see what (roles, regions, row-level security) is NOT decided here. This file only answers "which
    logged-in user is asking?". Everything after that stays in copilot_rbac.py and the database.

Functions the AI Copilot calls
  get_website_user(request) -> str | None       which CloseMore user is asking (their users."User_ID"), or None

Endpoints the website calls (server to server only, never from the browser)
  POST /internal/index    {"doc_id", "owner_user_id", "filename", "region", "s3_key"}   index an uploaded PDF
  POST /internal/remove   {"doc_id", "requested_by_user_id"}                             remove a document's index
  Both need the header  X-Copilot-Service-Key: <COPILOT_SERVICE_KEY>.

Settings (.env)
  COPILOT_SERVICE_KEY      long random secret shared ONLY between the website backend and this service (required)
  WEBSITE_AUTH_MODE        service (default): the website backend sends the user id in a header, with the secret
                           jwt: the request carries the website's login token (Authorization: Bearer ...)
  WEBSITE_JWT_KEY          jwt mode: the public key (RS256/ES256) or shared secret (HS256) that signs website tokens
  WEBSITE_JWT_ALGORITHMS   jwt mode: e.g. RS256 (default)
  WEBSITE_JWT_USER_CLAIM   jwt mode: the claim that holds users."User_ID" (default: sub)
  WEBSITE_JWT_AUDIENCE / WEBSITE_JWT_ISSUER   jwt mode, optional checks
  WEBSITE_DOCS_BUCKET      S3 bucket where the website stores uploaded PDFs (only this bucket is accepted)
  WEBSITE_DOCS_PREFIX      folder inside that bucket (only keys under it are accepted), e.g. documents/
"""
import hmac
import logging
import os

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

CONNECTOR_VERSION = 1

log = logging.getLogger("website_connector")

SERVICE_KEY_HEADER = "X-Copilot-Service-Key"
USER_HEADER = "X-Copilot-User-Id"


def _service_key_ok(given):
    """True only when a secret is configured and the caller sent exactly that secret (constant-time compare)."""
    expected = os.getenv("COPILOT_SERVICE_KEY", "")
    if len(expected) < 32:                       # no secret, or a weak one: refuse everything
        log.error("COPILOT_SERVICE_KEY is missing or shorter than 32 characters; refusing website calls")
        return False
    return bool(given) and hmac.compare_digest(str(given).encode(), expected.encode())


# ------------------------------------------------------------------ who is asking

def get_website_user(request: Request):
    """Return the users."User_ID" of the logged-in CloseMore user making this request, or None (-> 401).

    Never trust a user id that the BROWSER could set by itself. Either the website backend calls us with the shared
    secret (service mode), or the request carries a token signed by the website (jwt mode)."""
    mode = os.getenv("WEBSITE_AUTH_MODE", "service").strip().lower()

    if mode == "service":
        # The website backend has already checked the login. It calls us server to server with the secret and
        # the user id taken from ITS OWN session, never from anything the browser sent.
        if not _service_key_ok(request.headers.get(SERVICE_KEY_HEADER)):
            return None
        user_id = (request.headers.get(USER_HEADER) or "").strip()
        return user_id or None

    if mode == "jwt":
        token = (request.headers.get("Authorization") or "").strip()
        if not token.lower().startswith("bearer "):
            return None
        try:
            import jwt                                    # PyJWT
            key = os.getenv("WEBSITE_JWT_KEY", "")
            if not key:
                log.error("WEBSITE_JWT_KEY is not set; refusing tokens")
                return None
            claims = jwt.decode(
                token[7:].strip(), key,
                algorithms=[a.strip() for a in os.getenv("WEBSITE_JWT_ALGORITHMS", "RS256").split(",") if a.strip()],
                audience=os.getenv("WEBSITE_JWT_AUDIENCE") or None,
                issuer=os.getenv("WEBSITE_JWT_ISSUER") or None,
                options={"require": ["exp"], "verify_aud": bool(os.getenv("WEBSITE_JWT_AUDIENCE"))},
            )
        except Exception as e:  # noqa: BLE001  - expired, wrong signature, malformed: all mean "not logged in"
            log.info(f"website token rejected: {type(e).__name__}")
            return None
        user_id = str(claims.get(os.getenv("WEBSITE_JWT_USER_CLAIM", "sub")) or "").strip()
        return user_id or None

    log.error(f"unknown WEBSITE_AUTH_MODE={mode!r}; refusing")
    return None


# ------------------------------------------------------------------ documents uploaded on the website

router = APIRouter()


def _require_service(key):
    if not _service_key_ok(key):
        raise HTTPException(status_code=401, detail="Service key required.")


class IndexRequest(BaseModel):
    doc_id: str                 # the website's document id (unique, max 128 characters)
    owner_user_id: str          # users."User_ID" of the person who uploaded it
    filename: str               # shown as the source name in answers
    region: str                 # who may see it: a region name, or "System" for every region (same rules as uploads)
    s3_key: str                 # where the website stored the PDF, inside WEBSITE_DOCS_BUCKET / WEBSITE_DOCS_PREFIX


class RemoveRequest(BaseModel):
    doc_id: str
    requested_by_user_id: str   # the uploader or a system admin (same rule as deleting in the Copilot)


@router.post("/internal/index", status_code=202)
def index_document(body: IndexRequest, x_copilot_service_key: str | None = Header(default=None)):
    """Called by the website backend right after it stored a PDF in S3. Returns at once; indexing runs in the
    background. The document is searchable when its status is "ready"."""
    _require_service(x_copilot_service_key)
    import copilot_docs
    return copilot_docs.index_from_s3(
        doc_id=body.doc_id, owner_id=body.owner_user_id, filename=body.filename, region=body.region,
        bucket=os.getenv("WEBSITE_DOCS_BUCKET", ""), key=body.s3_key,
        allowed_prefix=os.getenv("WEBSITE_DOCS_PREFIX", ""))


@router.post("/internal/remove")
def remove_document(body: RemoveRequest, x_copilot_service_key: str | None = Header(default=None)):
    """Called by the website backend when a document is deleted there. Removes it from search.
    The PDF itself stays in the website's S3 bucket: the website owns the file."""
    _require_service(x_copilot_service_key)
    import copilot_docs
    return copilot_docs.remove_indexed(doc_id=body.doc_id, user_id=body.requested_by_user_id)
