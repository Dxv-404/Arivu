"""
normalizer.py — Input normalization for paper identifiers.

Any reasonable way a user might paste a paper reference is handled here.
Returns (canonical_id, id_type) where id_type drives the resolver strategy.

Also exports split_into_sentences() used by the NLP pipeline.
"""
import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ─── ID type constants ────────────────────────────────────────────────────────
ID_TYPE_DOI      = "doi"
ID_TYPE_ARXIV    = "arxiv"
ID_TYPE_S2       = "s2"
ID_TYPE_PUBMED   = "pubmed"
ID_TYPE_OPENALEX = "openalex"
ID_TYPE_TITLE    = "title"


def normalize_user_input(user_input: str) -> tuple[str, str]:
    """
    Parse any paper identifier the user might provide.

    Supported formats:
        DOI:       10.1234/example  |  https://doi.org/10.1234/example  |  doi:10.1234/example
        arXiv:     1706.03762  |  2303.08774v2  |  https://arxiv.org/abs/1706.03762
        S2:        https://www.semanticscholar.org/paper/Title/abc123def456...
        PubMed:    https://pubmed.ncbi.nlm.nih.gov/12345678/  |  bare 7-9 digit number
        OpenAlex:  W2741809807
        Title:     Anything else (free text title search)

    Returns:
        (canonical_id, id_type)
        canonical_id is stripped, lowercased where appropriate, and prefix-free.
    """
    text = user_input.strip()
    if not text:
        return "", ID_TYPE_TITLE

    # ── arXiv URL formats ────────────────────────────────────────────────────
    for pattern in [
        r"arxiv\.org/abs/(\d{4}\.\d{4,5}(?:v\d+)?)",
        r"arxiv\.org/pdf/(\d{4}\.\d{4,5}(?:v\d+)?)",
    ]:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            return _clean_arxiv(m.group(1)), ID_TYPE_ARXIV

    # ── Bare arXiv ID (YYMM.NNNNN or YYMM.NNNNNvN) ──────────────────────────
    m = re.match(r"^(\d{4}\.\d{4,5}(?:v\d+)?)$", text)
    if m:
        return _clean_arxiv(m.group(1)), ID_TYPE_ARXIV

    # ── Semantic Scholar URL ─────────────────────────────────────────────────
    m = re.search(r"semanticscholar\.org/paper/[^/]+/([a-f0-9]{40})", text, re.IGNORECASE)
    if m:
        return m.group(1).lower(), ID_TYPE_S2

    # ── Bare S2 corpus ID (40-char hex) ──────────────────────────────────────
    if re.match(r"^[0-9a-f]{40}$", text, re.IGNORECASE):
        return text.lower(), ID_TYPE_S2

    # ── DOI — various prefix forms ────────────────────────────────────────────
    for prefix in [
        "https://doi.org/",
        "http://doi.org/",
        "https://dx.doi.org/",
        "http://dx.doi.org/",
        "doi:",
        "DOI:",
        "DOI: ",
    ]:
        if text.lower().startswith(prefix.lower()):
            stripped = text[len(prefix):].strip()
            # arXiv DOIs via doi.org URL → convert to arXiv ID
            m = re.match(r"^10\.48550/arXiv\.(\d{4}\.\d{4,5}(?:v\d+)?)$", stripped, re.IGNORECASE)
            if m:
                return _clean_arxiv(m.group(1)), ID_TYPE_ARXIV
            return stripped, ID_TYPE_DOI

    # ── arXiv DOI (10.48550/arXiv.YYMM.NNNNN) → treat as arXiv ID ──────────
    # S2 doesn't resolve arXiv DOIs via DOI: prefix; convert to ARXIV: format.
    m = re.match(r"^10\.48550/arXiv\.(\d{4}\.\d{4,5}(?:v\d+)?)$", text, re.IGNORECASE)
    if m:
        return _clean_arxiv(m.group(1)), ID_TYPE_ARXIV

    # ── Bare DOI (always starts with 10.) ────────────────────────────────────
    if re.match(r"^10\.\d{4,9}/\S+$", text):
        return text, ID_TYPE_DOI

    # ── PubMed URL ───────────────────────────────────────────────────────────
    m = re.search(r"pubmed\.ncbi\.nlm\.nih\.gov/(\d{6,9})", text, re.IGNORECASE)
    if m:
        return m.group(1), ID_TYPE_PUBMED

    # ── Bare PubMed ID (7-9 digits) ──────────────────────────────────────────
    if re.match(r"^\d{7,9}$", text):
        return text, ID_TYPE_PUBMED

    # ── OpenAlex Work ID ─────────────────────────────────────────────────────
    if re.match(r"^W\d{6,}$", text):
        return text, ID_TYPE_OPENALEX

    # ── Fallback: title search ────────────────────────────────────────────────
    return text, ID_TYPE_TITLE


def _clean_arxiv(raw: str) -> str:
    """
    Normalize an arXiv ID. Strip version suffix (vN) for canonical lookup.
    The resolver queries by base ID; S2 handles version disambiguation.
    """
    base = raw.split("v")[0]   # "2303.08774v2" -> "2303.08774"
    return base


# ─── Text splitting ───────────────────────────────────────────────────────────

# Sentence boundary patterns for academic text
_SENTENCE_END = re.compile(
    r'(?<=[.!?])\s+'           # Standard sentence boundary
    r'(?=[A-Z])',               # Followed by capital letter
)

# Section header patterns (don't split on these)
_SECTION_HEADER = re.compile(
    r'^\s*(abstract|introduction|related\s+work|background|methods?|'
    r'approach|model|architecture|results?|experiments?|evaluation|'
    r'discussion|conclusion|acknowledgments?)\s*$',
    re.IGNORECASE | re.MULTILINE,
)


def split_into_sentences(text: str, max_sentences: int = 50) -> list[str]:
    """
    Split academic text into sentences, respecting common paper patterns.

    Used by InheritanceDetector to prepare inputs for the /similarity_matrix
    NLP worker endpoint. Capped at max_sentences to prevent oversized calls.

    Returns a list of non-empty sentence strings.
    """
    if not text or not text.strip():
        return []

    # Remove section headers (they pollute similarity scores)
    text = _SECTION_HEADER.sub(" ", text)

    # Split on sentence boundaries
    sentences = _SENTENCE_END.split(text)

    # Clean each sentence
    result = []
    for s in sentences:
        s = s.strip()
        if s and len(s) > 15:   # Ignore very short fragments
            result.append(s)
        if len(result) >= max_sentences:
            break

    return result if result else [text[:500]]   # Fallback: return truncated text
