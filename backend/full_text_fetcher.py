"""
backend/full_text_fetcher.py

Fetches full text for academic papers from multiple open-access sources.
Source priority: arXiv > Europe PMC > CORE > Unpaywall (PDF download).
Never requires authentication. All sources are free and open.

Architecture: all fetch methods are async and use httpx.
Main entry point: get_full_text(paper, rate_limiter) → PaperFullText | None
"""
import asyncio
import logging
import os
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

import httpx

logger = logging.getLogger(__name__)


@dataclass
class PaperFullText:
    """
    Structured full text for a paper, split into sections.
    text_tier mirrors the tier system in the complete spec §8.3.
    """
    abstract: str | None = None
    introduction: str | None = None
    related_work: str | None = None
    methods: str | None = None       # Primary for inheritance detection
    results: str | None = None
    discussion: str | None = None
    conclusion: str | None = None
    acknowledgments: str | None = None
    full_text_raw: str | None = None  # Concatenation of all sections
    source: str = "unknown"           # "arxiv" | "europepmc" | "core" | "unpaywall"
    extraction_confidence: float = 0.0  # 0-1
    text_tier: int = 3               # 1=full_with_sections, 2=abstract+intro, 3=abstract, 4=title

    @property
    def best_for_nlp(self) -> str | None:
        """Return best available text for NLP purposes (inheritance detection)."""
        if self.methods:
            return self.methods
        if self.introduction:
            return self.introduction
        if self.abstract:
            return self.abstract
        return None


async def get_full_text(paper, rate_limiter) -> "PaperFullText | None":
    """
    Try all full-text sources in priority order.
    Returns PaperFullText on first success, None if all fail.
    paper: backend.models.Paper instance
    rate_limiter: CoordinatedRateLimiter instance
    """
    # Source 1: arXiv (best for CS/ML/physics — LaTeX/PDF available)
    arxiv_id = _get_arxiv_id(paper)
    if arxiv_id:
        result = await _fetch_arxiv(arxiv_id, rate_limiter)
        if result:
            return result

    # Source 2: Europe PMC (biomedical open access — structured XML)
    identifier = getattr(paper, "doi", None) or _get_pubmed_id(paper)
    if identifier:
        result = await _fetch_europepmc(identifier, rate_limiter)
        if result:
            return result

    # Source 3: CORE (cross-domain institutional repos)
    if getattr(paper, "doi", None):
        result = await _fetch_core(paper.doi, rate_limiter)
        if result:
            return result

    # Source 4: Unpaywall (find a legal open access PDF for any DOI)
    if getattr(paper, "doi", None):
        result = await _fetch_via_unpaywall(paper.doi, rate_limiter)
        if result:
            return result

    return None


def _get_arxiv_id(paper) -> str | None:
    """Extract arXiv ID from paper source_ids or URL."""
    source_ids = getattr(paper, "source_ids", {}) or {}
    if "arxiv" in source_ids:
        return source_ids["arxiv"]
    url = getattr(paper, "url", "") or ""
    match = re.search(r"arxiv\.org/(?:abs|pdf)/(\d+\.\d+)", url)
    if match:
        return match.group(1)
    return None


def _get_pubmed_id(paper) -> str | None:
    """Extract PubMed ID from paper source_ids."""
    source_ids = getattr(paper, "source_ids", {}) or {}
    return source_ids.get("pubmed")


# ─── arXiv ─────────────────────────────────────────────────────────────────────

async def _fetch_arxiv(arxiv_id: str, rate_limiter) -> "PaperFullText | None":
    """
    Download arXiv PDF and extract text.
    arXiv ID formats: "1706.03762" or "cs/0409015" or "arXiv:1706.03762"
    """
    clean_id = re.sub(r'^arXiv:', '', arxiv_id, flags=re.IGNORECASE).strip()
    pdf_url = f"https://arxiv.org/pdf/{clean_id}.pdf"

    try:
        await rate_limiter.acquire("arxiv")
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            resp = await client.get(pdf_url, headers={"User-Agent": "Arivu/1.0 (academic research tool)"})
            if resp.status_code != 200:
                return None
            pdf_bytes = resp.content

        return _extract_from_pdf(pdf_bytes, source="arxiv")

    except Exception as exc:
        logger.debug(f"arXiv fetch failed for {arxiv_id}: {exc}")
        return None


# ─── Europe PMC ────────────────────────────────────────────────────────────────

async def _fetch_europepmc(identifier: str, rate_limiter) -> "PaperFullText | None":
    """
    Fetch structured full text from Europe PMC REST API.
    Identifier: DOI or PubMed ID.
    """
    base = "https://www.ebi.ac.uk/europepmc/webservices/rest"
    prefix = "DOI:" if "/" in str(identifier) else "EXT_ID:"
    query_url = f"{base}/search?query={prefix}{identifier}&resultType=core&format=json"

    try:
        await rate_limiter.acquire("europepmc")
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(query_url)
            if resp.status_code != 200:
                return None
            data = resp.json()

        results = data.get("resultList", {}).get("result", [])
        if not results:
            return None

        hit = results[0]
        pmcid = hit.get("pmcid")
        if not pmcid:
            return None

        # Fetch full-text XML
        await rate_limiter.acquire("europepmc")
        async with httpx.AsyncClient(timeout=30.0) as client:
            xml_resp = await client.get(f"{base}/{pmcid}/fullTextXML")
            if xml_resp.status_code != 200:
                return None
            xml_text = xml_resp.text

        return _parse_europepmc_xml(xml_text)

    except Exception as exc:
        logger.debug(f"Europe PMC fetch failed for {identifier}: {exc}")
        return None


def _parse_europepmc_xml(xml_text: str) -> "PaperFullText | None":
    """Parse Europe PMC full-text XML into PaperFullText."""
    try:
        root = ET.fromstring(xml_text)

        def _get_section(tag: str) -> str | None:
            for sec in root.iter("sec"):
                sec_type = sec.get("sec-type", "").lower()
                title_el = sec.find("title")
                title_text = (title_el.text or "").lower() if title_el is not None else ""
                if tag in sec_type or tag in title_text:
                    return " ".join(sec.itertext()).strip()
            return None

        def _all_text() -> str:
            return " ".join(root.itertext()).strip()

        abstract_el = root.find(".//abstract")
        abstract = " ".join(abstract_el.itertext()).strip() if abstract_el is not None else None

        full_raw = _all_text()
        intro = _get_section("intro")
        methods = _get_section("method") or _get_section("material")
        results = _get_section("result")
        discussion = _get_section("discuss")
        conclusion = _get_section("conclu")

        sections_found = sum(1 for x in [intro, methods, results, discussion, conclusion] if x)
        confidence = sections_found / 5.0

        return PaperFullText(
            abstract=abstract,
            introduction=intro,
            methods=methods,
            results=results,
            discussion=discussion,
            conclusion=conclusion,
            full_text_raw=full_raw,
            source="europepmc",
            extraction_confidence=confidence,
            text_tier=1 if methods else (2 if intro else 3),
        )
    except Exception as exc:
        logger.debug(f"Europe PMC XML parse failed: {exc}")
        return None


# ─── CORE API ──────────────────────────────────────────────────────────────────

async def _fetch_core(doi: str, rate_limiter) -> "PaperFullText | None":
    """
    Search CORE API for a paper by DOI and download its PDF if found.
    """
    core_key = os.environ.get("CORE_API_KEY", "")
    if not core_key:
        return None

    search_url = f"https://api.core.ac.uk/v3/search/works?q=doi:{doi}&limit=1"
    headers = {"Authorization": f"Bearer {core_key}"}

    try:
        await rate_limiter.acquire("core")
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(search_url, headers=headers)
            if resp.status_code != 200:
                return None
            data = resp.json()

        results = data.get("results", [])
        if not results:
            return None

        hit = results[0]
        pdf_url = hit.get("downloadUrl") or (hit.get("sourceFulltextUrls") or [None])[0]
        if not pdf_url:
            return None

        await rate_limiter.acquire("core")
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            pdf_resp = await client.get(pdf_url, headers={"User-Agent": "Arivu/1.0"})
            if pdf_resp.status_code != 200 or b"%PDF" not in pdf_resp.content[:10]:
                return None

        return _extract_from_pdf(pdf_resp.content, source="core")

    except Exception as exc:
        logger.debug(f"CORE fetch failed for {doi}: {exc}")
        return None


# ─── Unpaywall ─────────────────────────────────────────────────────────────────

async def _fetch_via_unpaywall(doi: str, rate_limiter) -> "PaperFullText | None":
    """
    Use Unpaywall to find a legal open-access version of any DOI.
    """
    email = os.environ.get("CROSSREF_MAILTO", "")
    if not email:
        return None

    unpaywall_url = f"https://api.unpaywall.org/v2/{doi}?email={email}"

    try:
        await rate_limiter.acquire("unpaywall")
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(unpaywall_url)
            if resp.status_code != 200:
                return None
            data = resp.json()

        best_oa = data.get("best_oa_location")
        if not best_oa:
            return None

        pdf_url = best_oa.get("url_for_pdf") or best_oa.get("url")
        if not pdf_url:
            return None

        await rate_limiter.acquire("unpaywall")
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            pdf_resp = await client.get(pdf_url, headers={"User-Agent": "Arivu/1.0"})
            if pdf_resp.status_code != 200:
                return None
            content = pdf_resp.content

        if b"%PDF" not in content[:10]:
            return None

        return _extract_from_pdf(content, source="unpaywall")

    except Exception as exc:
        logger.debug(f"Unpaywall fetch failed for {doi}: {exc}")
        return None


# ─── PDF Extraction ────────────────────────────────────────────────────────────

def _extract_from_pdf(pdf_bytes: bytes, source: str) -> "PaperFullText | None":
    """
    Extract text from PDF bytes using PyMuPDF (fitz).
    Returns PaperFullText with sections detected by header patterns.
    """
    try:
        import fitz  # PyMuPDF — correct import name
    except ImportError:
        logger.warning("PyMuPDF not installed — PDF extraction unavailable. Run: pip install PyMuPDF")
        return None

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        pages_text = []
        for page in doc:
            pages_text.append(page.get_text())
        full_text = "\n".join(pages_text)
        doc.close()
    except Exception as exc:
        logger.debug(f"PDF extraction failed: {exc}")
        return None

    if not full_text.strip():
        return None

    # Delegate to section parser
    from backend.section_parser import extract_sections
    sections = extract_sections(full_text)

    sections_found = sum(1 for v in [
        sections.get("methods"), sections.get("introduction"),
        sections.get("results"), sections.get("conclusion")
    ] if v)
    confidence = min(1.0, sections_found / 3.0)

    text_tier = 3  # default: abstract only
    if sections.get("methods"):
        text_tier = 1
    elif sections.get("introduction"):
        text_tier = 2

    return PaperFullText(
        abstract=sections.get("abstract"),
        introduction=sections.get("introduction"),
        related_work=sections.get("related_work"),
        methods=sections.get("methods"),
        results=sections.get("results"),
        discussion=sections.get("discussion"),
        conclusion=sections.get("conclusion"),
        acknowledgments=sections.get("acknowledgments"),
        full_text_raw=full_text,
        source=source,
        extraction_confidence=confidence,
        text_tier=text_tier,
    )
