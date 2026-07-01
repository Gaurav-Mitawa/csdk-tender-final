"""Display-title cleanup.

TenderKart sometimes returns the tender's *reference / bid code* in the `title`
field (e.g. "WBPWD/SGE/LOK/NIeQ-01/26-27", "SNB/Laptop/26-27/02") instead of a
readable name. This module detects those code-like titles and swaps in the real
"Name of Work" that the extractor pulled FROM the tender document itself
(document-extracted, never LLM-invented). Order of preference for the replacement:
the extracted tender_title / name_of_work → the scope summary → the original code.
"""
from __future__ import annotations

import re

_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_WS = re.compile(r"\s+")


def _norm(s: str | None) -> str:
    """Lowercase, strip everything non-alphanumeric — for stable equality/identity."""
    return _NON_ALNUM.sub("", str(s or "").lower())


def is_code_like(title: str | None, reference: str | None = None) -> bool:
    """True when `title` looks like a bid/reference code rather than a work name.

    Signals: it equals the reference number; or it is a short, slash-delimited,
    digit-bearing token with very few real words (the shape of "ABC/123/26-27").
    """
    t = (title or "").strip()
    if not t:
        return True
    if reference and _norm(t) == _norm(reference):
        return True
    words = [w for w in _WS.split(t) if w]
    letters = sum(c.isalpha() for c in t)
    has_slash_digit = "/" in t and any(c.isdigit() for c in t)
    # "SNB/Laptop/26-27/02", "11014/9255/28 Sect/31 COB/Engr/2026/03", "Andole / 2nd call"
    if has_slash_digit and len(words) <= 6 and letters < 28:
        return True
    # A short mostly-non-alphabetic string with digits (dense code, no descriptive prose).
    if len(t) <= 60 and any(c.isdigit() for c in t) and letters < max(6, int(len(t) * 0.4)):
        return True
    return False


def _first_clause(text: str | None, limit: int = 110) -> str | None:
    """First readable clause of the scope summary, trimmed at a word boundary."""
    s = _WS.sub(" ", str(text or "")).strip()
    if not s:
        return None
    # Cut at the first sentence end within the limit, else at a word boundary.
    cut = s[:limit]
    for sep in (". ", "; ", " — ", " - "):
        i = cut.find(sep)
        if 20 <= i:
            return cut[:i].strip()
    if len(s) > limit:
        cut = cut.rsplit(" ", 1)[0]
        return cut.strip() + "…"
    return s


def clean_display_title(
    raw_title: str | None,
    reference: str | None = None,
    extracted_title: str | None = None,
    scope_summary: str | None = None,
) -> str:
    """Return the best human-readable title.

    If the raw title is a real name, keep it. If it's a reference/bid code, prefer
    the title the extractor read out of the document (extracted_title), then the
    scope summary, and only fall back to the raw code if nothing better exists.
    """
    raw = (raw_title or "").strip()
    if not is_code_like(raw, reference):
        return raw
    for cand in (extracted_title, _first_clause(scope_summary)):
        c = (cand or "").strip()
        if c and not is_code_like(c, reference) and len(c) >= 8:
            return c
    return raw or "(untitled)"
