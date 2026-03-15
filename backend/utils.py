"""
utils.py — Shared utility functions used across the backend.
"""
import asyncio
import json
import logging
from pathlib import Path
from typing import Any, Coroutine, Optional, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")

# Phase 5: gallery_index.json lives at data/gallery_index.json (not data/precomputed/)
# Pre-computed individual graph JSONs remain in data/precomputed/<slug>.json
GALLERY_DIR        = Path(__file__).parent.parent / "data" / "precomputed"
GALLERY_INDEX_PATH = Path(__file__).parent.parent / "data" / "gallery_index.json"


def await_sync(coro: Coroutine[Any, Any, T]) -> T:
    """
    Run an async coroutine from a synchronous Flask route handler.

    Strategy:
    - If an event loop is already running in this thread (e.g. during async
      tests), schedule on that loop via run_coroutine_threadsafe().
    - Otherwise create a fresh event loop with asyncio.run().

    NOTE: asyncio.run_coroutine_threadsafe() returns a concurrent.futures.Future
    that correctly propagates exceptions raised inside the coroutine. Calling
    .result(timeout=120) on it will re-raise any such exception. Do NOT replace
    this with a manually constructed concurrent.futures.Future — that pattern
    can block indefinitely if the coroutine raises before setting the result.
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        future = asyncio.run_coroutine_threadsafe(coro, loop)
        return future.result(timeout=120)

    return asyncio.run(coro)


def load_gallery_index() -> list[dict]:
    """Load gallery entry list. Returns [] if file doesn't exist yet."""
    if not GALLERY_INDEX_PATH.exists():
        return []
    with open(GALLERY_INDEX_PATH) as f:
        return json.load(f)


def load_precomputed_graph(slug: str) -> Optional[dict]:
    """Load a precomputed graph JSON by slug (e.g. 'attention'). Returns None if missing."""
    path = GALLERY_DIR / f"{slug}.json"
    if not path.exists():
        return None
    with open(path) as f:
        return json.load(f)


def log_action(session_id: str, action_type: str, action_data: dict) -> None:
    """
    Insert a record into action_log.
    Silently swallows all errors — logging failures must never break requests.
    """
    from backend.db import execute
    try:
        execute(
            "INSERT INTO action_log (session_id, action_type, action_data) "
            "VALUES (%s, %s, %s)",
            (session_id, action_type, json.dumps(action_data)),
        )
    except Exception as exc:
        logger.debug(f"log_action silently failed: {exc}")


def update_graph_memory(session_id: str, updates: dict) -> None:
    """Merge updates dict into the session's graph_memory JSONB column."""
    from backend.db import execute
    execute(
        "UPDATE sessions SET graph_memory = graph_memory || %s::jsonb "
        "WHERE session_id = %s",
        (json.dumps(updates), session_id),
    )


def get_graph_summary_for_chat(graph: dict) -> dict:
    """
    Compact LLM-safe graph summary. Never passes raw abstracts to the LLM.
    Keeps output under ~1500 tokens.
    """
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])
    meta  = graph.get("metadata", {})

    top_nodes   = sorted(nodes, key=lambda n: n.get("citation_count", 0), reverse=True)[:15]
    bottlenecks = [n for n in nodes if n.get("is_bottleneck")][:5]
    top_edges   = sorted(
        edges,
        key=lambda e: e.get("inherited_idea", {}).get("similarity", 0),
        reverse=True,
    )[:20]

    return {
        "seed_paper_id": meta.get("seed_paper_id"),
        "total_nodes":   meta.get("total_nodes"),
        "total_edges":   meta.get("total_edges"),
        "top_papers": [
            {
                "id":             n["id"],
                "title":          n.get("title", ""),
                "year":           n.get("year"),
                "citations":      n.get("citation_count"),
                "fields":         n.get("fields_of_study", []),
                "pruning_impact": n.get("pruning_impact", 0),
            }
            for n in top_nodes
        ],
        "bottleneck_papers": [
            {"id": n["id"], "title": n.get("title", ""), "pruning_impact": n.get("pruning_impact", 0)}
            for n in bottlenecks
        ],
        "edge_sample": [
            {
                "source":        e["source"],
                "target":        e["target"],
                "similarity":    e.get("inherited_idea", {}).get("similarity", 0),
                "mutation_type": e.get("inherited_idea", {}).get("mutation_type", "unknown"),
            }
            for e in top_edges
        ],
    }
