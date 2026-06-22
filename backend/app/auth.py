"""Supabase-backed auth: login/signup + a Bearer-token dependency.

The frontend stores the returned `access_token` in an httpOnly cookie and sends
it back as `Authorization: Bearer <token>` on every proxied call. We validate it
against Supabase on each request (stateless).
"""
import logging
import time

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .supabase_client import new_auth_client

log = logging.getLogger("auth")
_bearer = HTTPBearer(auto_error=True)


def login(email: str, password: str) -> dict:
    client = new_auth_client()
    try:
        res = client.auth.sign_in_with_password({"email": email, "password": password})
    except Exception:
        raise HTTPException(status_code=401, detail={"error": "invalid_credentials"})
    session = getattr(res, "session", None)
    if not session or not session.access_token:
        raise HTTPException(status_code=401, detail={"error": "invalid_credentials"})
    return {
        "access_token": session.access_token,
        "refresh_token": session.refresh_token,
        "expires_in": session.expires_in,
        "token_type": "bearer",
        "user": {"id": res.user.id, "email": res.user.email} if res.user else None,
    }


def signup(email: str, password: str) -> dict:
    client = new_auth_client()
    try:
        res = client.auth.sign_up({"email": email, "password": password})
    except Exception as exc:  # surfaced as detail to the signup form
        raise HTTPException(status_code=400, detail={"error": "signup_failed", "detail": str(exc)})
    session = getattr(res, "session", None)
    if session and session.access_token:
        return {
            "access_token": session.access_token,
            "refresh_token": session.refresh_token,
            "expires_in": session.expires_in,
            "token_type": "bearer",
            "user": {"id": res.user.id, "email": res.user.email} if res.user else None,
        }
    # No session => email confirmation is enabled on the project.
    return {"detail": "Account created. Email confirmation is required before sign in."}


def refresh(refresh_token: str) -> dict:
    """Exchange a refresh token for a fresh access token (Supabase rotates both)."""
    client = new_auth_client()
    try:
        res = client.auth.refresh_session(refresh_token)
    except Exception:
        raise HTTPException(status_code=401, detail={"error": "refresh_failed"})
    session = getattr(res, "session", None)
    if not session or not session.access_token:
        raise HTTPException(status_code=401, detail={"error": "refresh_failed"})
    return {
        "access_token": session.access_token,
        "refresh_token": session.refresh_token,
        "expires_in": session.expires_in,
        "token_type": "bearer",
        "user": {"id": res.user.id, "email": res.user.email} if getattr(res, "user", None) else None,
    }


def _token_rejected(exc: Exception) -> bool:
    """True only when Supabase POSITIVELY rejected the token (expired / malformed) — a
    real logout. Transport failures (timeout, connection reset, rate-limit, 5xx) must
    NOT log the user out: while a scan pins the CPU these calls fail transiently, and
    turning that into a 401 is exactly what knocks every signed-in user offline."""
    sc = getattr(exc, "status", None)
    if not isinstance(sc, int):
        sc = getattr(exc, "code", None)
    if isinstance(sc, int):
        # 4xx (except 429 rate-limit) = token genuinely bad; 429/5xx = transient.
        return 400 <= sc < 500 and sc != 429
    msg = str(exc).lower()
    if any(k in msg for k in ("timeout", "timed out", "connection", "connect", "network",
                              "temporarily", "read error", "reset", "429", "too many")):
        return False
    return any(k in msg for k in ("expired", "invalid", "bad_jwt", "jwt", "not authenticated",
                                  "unauthorized", "no user", "missing"))


def current_user(creds: HTTPAuthorizationCredentials = Depends(_bearer)):
    """FastAPI dependency: validates the bearer JWT and returns the Supabase user.

    Distinguishes a genuinely invalid token (401 → client logs out) from a transient
    validation failure (503 → client keeps the session and retries). Retries transient
    failures a couple of times so a momentary CPU spike during a scan doesn't surface
    as a spurious logout.
    """
    token = creds.credentials
    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            res = new_auth_client().auth.get_user(token)
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if _token_rejected(exc):
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token")
            time.sleep(0.25 * (attempt + 1))  # transient — brief backoff, then retry
            continue
        user = getattr(res, "user", None)
        if user:
            return user
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token")
    # Exhausted retries on transient errors — auth backend is unreachable, NOT a bad token.
    log.warning("auth validation temporarily unavailable: %s", last_exc)
    raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="auth temporarily unavailable")
