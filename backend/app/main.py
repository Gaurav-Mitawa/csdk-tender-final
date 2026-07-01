"""Tender Agent backend (FastAPI).

Drop-in for the Next.js dashboard's BACKEND_API_URL. Endpoints mirror what the
frontend's /api/* routes proxy to. Routers are added as they're built.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from . import scheduler
from .routers import agent, auth, chat, profile, runs, tenders

app = FastAPI(title="Tender Agent Backend", version="0.1.0")


@app.on_event("startup")
def _start_scheduler() -> None:
    # Auto-fires the agent run at the IST time configured in Settings (best-effort;
    # never blocks startup).
    try:
        scheduler.start()
    except Exception:  # noqa: BLE001
        pass

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(runs.router)
app.include_router(profile.router)
app.include_router(agent.router)
app.include_router(chat.router)
app.include_router(tenders.router)
# TODO (next): reports router.


@app.get("/health")
def health():
    return {"ok": True, "service": "tender-agent-backend"}
