"""
schemas.py — Pydantic request/response models for all API endpoints.
All input validation lives here — routes stay clean.
"""
import re
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=3, max_length=500)

    @field_validator("query")
    @classmethod
    def sanitize_query(cls, v: str) -> str:
        return re.sub(r"[<>\"'`]", "", v).strip()


class GraphBuildRequest(BaseModel):
    paper_id: str = Field(..., min_length=5, max_length=200)
    max_depth: int = Field(default=2, ge=1, le=2)
    max_refs: int = Field(default=50, ge=10, le=50)

    @field_validator("paper_id")
    @classmethod
    def validate_paper_id(cls, v: str) -> str:
        patterns = [
            r"^[0-9a-f]{40}$",               # S2 corpus ID
            r"^10\.\d{4,9}/\S+$",             # DOI
            r"^\d{4}\.\d{4,5}(v\d+)?$",      # arXiv bare ID
            r"^https?://.*semanticscholar.*",  # S2 URL
        ]
        v = v.strip()
        if not any(re.match(p, v) for p in patterns):
            raise ValueError(
                "paper_id must be a 40-char S2 ID, DOI (10.xxxx/...), "
                "arXiv ID (YYYY.NNNNN), or Semantic Scholar URL"
            )
        return v


class PruneRequest(BaseModel):
    paper_ids: list[str] = Field(..., min_length=1, max_length=10)
    seed_paper_id: str

    @field_validator("paper_ids")
    @classmethod
    def validate_ids(cls, v: list[str]) -> list[str]:
        for pid in v:
            if not re.match(r"^[0-9a-f]{40}$", pid):
                raise ValueError(f"Invalid paper_id (must be 40-char hex): {pid}")
        return v


class ChatRequest(BaseModel):
    """
    IMPORTANT: client must NOT send message history.
    Server loads history from chat_history table keyed by session_id.
    This prevents client-side history injection attacks.
    """
    message: str = Field(..., min_length=1, max_length=2000)
    seed_paper_id: Optional[str] = None

    @field_validator("message")
    @classmethod
    def sanitize_message(cls, v: str) -> str:
        return re.sub(r"[<>\"'`]", "", v).strip()


class ExportRequest(BaseModel):
    format: str = Field(..., pattern="^(json|csv|pdf|markdown)$")
    seed_paper_id: str


class FlagRequest(BaseModel):
    source_id: str
    target_id: str
    seed_paper_id: str
    reason: str = Field(..., max_length=500)


class HealthResponse(BaseModel):
    """
    Shape of the /health response.
    /health returns jsonify(dict) directly. This model documents the shape
    and is available for typed test assertions.
    """
    status: str        # "ok" | "degraded"
    db: bool
    nlp_worker: bool
    version: str = "1.0.0"
