"""Tender search (issue 9) — find stored tenders by name / reference / authority and
return each one's report-PDF link so the dashboard can open the generated report."""
from fastapi import APIRouter, Depends, Query

from ..auth import current_user
from ..pipeline import store

router = APIRouter(prefix="/tenders", tags=["tenders"])


@router.get("/search")
def search(q: str = Query(..., min_length=1, max_length=120), user=Depends(current_user)):
    """Search by tender name/reference/authority. Returns up to 20 matches, each with the
    URL of the report that tender appeared in (report_url may be null)."""
    return {"results": store.search_tenders(q, limit=20)}
