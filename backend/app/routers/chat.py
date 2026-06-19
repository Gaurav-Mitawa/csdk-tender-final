"""Per-user chat sessions — account-based, cross-device. Stored in Supabase, scoped by
the authenticated user. Writes use the service key; EVERY query is filtered by user_id so
one user can never see another's chats. (xyz@xyz sees their chats from any device; abc@abc
cannot.)"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from ..auth import current_user
from ..supabase_client import service_client

router = APIRouter(prefix="/chat", tags=["chat"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid(user) -> str:
    uid = getattr(user, "id", None)
    if not uid:
        raise HTTPException(status_code=401, detail="no user")
    return uid


def _own_session(sid: str, uid: str) -> dict:
    res = (service_client().table("chat_sessions").select("*")
           .eq("id", sid).eq("user_id", uid).limit(1).execute())
    if not res.data:
        raise HTTPException(status_code=404, detail="session not found")
    return res.data[0]


@router.get("/sessions")
def list_sessions(user=Depends(current_user)):
    uid = _uid(user)
    res = (service_client().table("chat_sessions").select("id,title,created_at,updated_at")
           .eq("user_id", uid).order("updated_at", desc=True).limit(200).execute())
    return {"sessions": res.data or []}


@router.post("/sessions")
def create_session(body: dict | None = None, user=Depends(current_user)):
    uid = _uid(user)
    title = ((body or {}).get("title") or "New chat").strip()[:120] or "New chat"
    row = {"user_id": uid, "title": title, "created_at": _now(), "updated_at": _now()}
    res = service_client().table("chat_sessions").insert(row).execute()
    return res.data[0] if res.data else row


@router.get("/sessions/{sid}")
def get_session(sid: str, user=Depends(current_user)):
    uid = _uid(user)
    s = _own_session(sid, uid)
    msgs = (service_client().table("chat_messages").select("*")
            .eq("session_id", sid).order("created_at").limit(1000).execute())
    return {"session": s, "messages": msgs.data or []}


@router.put("/sessions/{sid}")
def rename_session(sid: str, body: dict, user=Depends(current_user)):
    uid = _uid(user)
    _own_session(sid, uid)
    patch = {"updated_at": _now()}
    title = (body.get("title") or "").strip()[:120]
    if title:
        patch["title"] = title
    service_client().table("chat_sessions").update(patch).eq("id", sid).execute()
    return {"ok": True}


@router.delete("/sessions/{sid}")
def delete_session(sid: str, user=Depends(current_user)):
    uid = _uid(user)
    _own_session(sid, uid)
    service_client().table("chat_sessions").delete().eq("id", sid).execute()
    return {"ok": True}


@router.post("/sessions/{sid}/messages")
def add_message(sid: str, body: dict, user=Depends(current_user)):
    uid = _uid(user)
    s = _own_session(sid, uid)
    cycle_id = body.get("cycle_id")
    if cycle_id:
        # Dedup: the same run event must not be saved twice (e.g. two devices open at once).
        ex = (service_client().table("chat_messages").select("id")
              .eq("session_id", sid).eq("cycle_id", cycle_id).limit(1).execute())
        if ex.data:
            return {"ok": True, "deduped": True}
    role = body.get("role") or "user"
    row = {
        "session_id": sid,
        "role": role,
        "content": body.get("content") or "",
        "type": body.get("type") or "text",
        "meta": body.get("meta"),
        "cycle_id": cycle_id,
    }
    res = service_client().table("chat_messages").insert(row).execute()
    # Bump updated_at; auto-title the session from its first user message.
    patch = {"updated_at": _now()}
    if role == "user" and (s.get("title") or "") in ("", "New chat"):
        patch["title"] = ((row["content"] or "New chat").strip()[:60]) or "New chat"
    service_client().table("chat_sessions").update(patch).eq("id", sid).execute()
    return {"ok": True, "message": (res.data[0] if res.data else row)}
