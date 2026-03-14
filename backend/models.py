"""
models.py — Canonical Python data models for Arivu.

These dataclasses mirror the DB schema and are the single source of truth
for data shapes passed between backend modules. Import from here; never
redefine these shapes elsewhere.
"""
from dataclasses import dataclass, field
from typing import Optional


# ---- Constants --------------------------------------------------------------

# All 7 mutation types used in EdgeAnalysis.mutation_type.
# Never use a string not in this tuple.
MUTATION_TYPES = (
    "adoption",        # Direct use of technique/method
    "generalization",  # Extended to broader application
    "specialization",  # Narrowed to specific domain
    "hybridization",   # Combined with another concept
    "contradiction",   # Explicitly challenges the cited work
    "revival",         # Brings back a previously dormant idea
    "incidental",      # Cited in passing; not central to the work
)

# All 7 citation intent types used in EdgeAnalysis.citation_intent.
CITATION_INTENTS = (
    "methodological_adoption",
    "theoretical_foundation",
    "empirical_baseline",
    "conceptual_inspiration",
    "direct_contradiction",
    "incidental_mention",
    "negative_citation",
)

# Confidence tier labels. confidence_tier is ALWAYS a string — never an int.
CONFIDENCE_TIERS = ("HIGH", "MEDIUM", "LOW", "SPECULATIVE")


def get_confidence_tier(confidence: float) -> str:
    """
    Convert a 0.0-1.0 float confidence score to a string tier label.

    Thresholds (spec §8.4):
        HIGH        >= 0.75
        MEDIUM      >= 0.55
        LOW         >= 0.35
        SPECULATIVE  < 0.35

    Returns one of the CONFIDENCE_TIERS strings. Never returns an integer.
    """
    if confidence >= 0.75:
        return "HIGH"
    elif confidence >= 0.55:
        return "MEDIUM"
    elif confidence >= 0.35:
        return "LOW"
    else:
        return "SPECULATIVE"


# ---- Paper ------------------------------------------------------------------

@dataclass
class Paper:
    """
    Canonical paper record. All data sources (S2, OpenAlex, CrossRef, etc.)
    are merged into a single Paper instance before any downstream processing.

    paper_id is the Semantic Scholar corpus ID (40-char lowercase hex).
    This is the canonical primary key used in the DB, graph edges, and cache keys.
    """
    paper_id: str                            # 40-char S2 corpus ID — canonical PK
    title: str
    abstract: Optional[str] = None
    year: Optional[int] = None
    citation_count: int = 0
    fields_of_study: list[str] = field(default_factory=list)
    authors: list[str] = field(default_factory=list)
    doi: Optional[str] = None
    url: str = ""
    text_tier: int = 4          # 1=full text+methods  2=intro  3=abstract  4=title only
    is_retracted: bool = False
    language: str = "en"
    canonical_id: Optional[str] = None       # deduplicated canonical paper_id
    source_ids: dict = field(default_factory=dict)  # {"s2": "...", "openalex": "...", "doi": "..."}
    venue: Optional[str] = None

    @classmethod
    def from_db_row(cls, row: dict) -> "Paper":
        """Construct a Paper from a psycopg2 RealDictCursor row."""
        return cls(
            paper_id=row["paper_id"],
            title=row["title"],
            abstract=row.get("abstract"),
            year=row.get("year"),
            citation_count=row.get("citation_count", 0),
            fields_of_study=row.get("fields_of_study") or [],
            authors=row.get("authors") or [],
            doi=row.get("doi"),
            url=row.get("url") or "",
            text_tier=row.get("text_tier", 4),
            is_retracted=row.get("is_retracted", False),
            language=row.get("language", "en"),
            canonical_id=row.get("canonical_id"),
            source_ids=row.get("source_ids") or {},
            venue=row.get("venue"),
        )


# ---- EdgeAnalysis -----------------------------------------------------------

@dataclass
class EdgeAnalysis:
    """
    NLP pipeline output for one citation edge.
    Persisted to the edge_analysis table after computation.

    edge_id format is ALWAYS: f"{citing_paper_id}:{cited_paper_id}"
    Do not deviate — this format is the DB primary key.
    """
    edge_id: str                 # ALWAYS: f"{citing_paper_id}:{cited_paper_id}"
    citing_paper_id: str
    cited_paper_id: str
    similarity_score: float
    citing_sentence: Optional[str]
    cited_sentence: Optional[str]
    citing_text_source: str      # "methods" | "abstract" | "none"
    cited_text_source: str       # "methods" | "abstract" | "none"
    comparable: bool
    mutation_type: str           # one of MUTATION_TYPES
    mutation_confidence: float   # 0.0-1.0
    mutation_evidence: str
    citation_intent: str         # one of CITATION_INTENTS
    base_confidence: float       # raw confidence before structural validation
    signals_used: list[str]      # which of the 5 confidence signals contributed
    llm_classified: bool         # False if auto-classified incidental (no LLM call)
    flagged_by_users: int = 0
    model_version: str = "1.0.0"

    @property
    def confidence_tier(self) -> str:
        """Derived string tier. Always use this; never expose raw float."""
        return get_confidence_tier(self.mutation_confidence)
