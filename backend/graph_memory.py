"""
backend/graph_memory.py — GraphMemoryManager (F5.5)

Uses graph_memory_state table (Phase 8), NOT the legacy graph_memory table (Phase 6).
Navigation path stored as ordered JSONB array to preserve visit order (GAP-P8-34).
"""
import json
import logging
from datetime import datetime, timezone
from typing import Optional

import backend.db as db

logger = logging.getLogger(__name__)


class GraphMemoryManager:

    def get_memory(self, user_id: str, graph_id: str) -> dict:
        row = db.fetchone(
            "SELECT seen_paper_ids, flagged_edges, expanded_edges, "
            "pruning_history, navigation_path, time_machine_position "
            "FROM graph_memory_state WHERE user_id=%s::uuid AND graph_id=%s",
            (user_id, graph_id),
        )
        if not row:
            return {
                "seen_paper_ids": [], "flagged_edges": [], "expanded_edges": [],
                "pruning_history": [], "navigation_path": [], "time_machine_position": None,
            }
        return {
            "seen_paper_ids":         list(row["seen_paper_ids"] or []),
            "flagged_edges":          list(row["flagged_edges"] or []),
            "expanded_edges":         list(row["expanded_edges"] or []),
            "pruning_history":        row["pruning_history"] or [],
            "navigation_path":        row["navigation_path"] or [],
            "time_machine_position":  row["time_machine_position"],
        }

    def mark_papers_seen(self, user_id: str, graph_id: str, paper_ids: list):
        self._ensure_row(user_id, graph_id)
        db.execute(
            """
            UPDATE graph_memory_state
            SET seen_paper_ids = (
                SELECT ARRAY(SELECT DISTINCT unnest(seen_paper_ids || %s::text[]))
            ),
            last_updated = NOW()
            WHERE user_id=%s::uuid AND graph_id=%s
            """,
            (paper_ids, user_id, graph_id),
        )

    def mark_edge_flagged(self, user_id: str, graph_id: str, edge_id: str):
        self._ensure_row(user_id, graph_id)
        db.execute(
            """
            UPDATE graph_memory_state
            SET flagged_edges = (
                SELECT ARRAY(SELECT DISTINCT unnest(flagged_edges || ARRAY[%s::text]))
            ),
            last_updated = NOW()
            WHERE user_id=%s::uuid AND graph_id=%s
            """,
            (edge_id, user_id, graph_id),
        )

    def record_edge_expansion(self, user_id: str, graph_id: str, edge_id: str):
        self._ensure_row(user_id, graph_id)
        db.execute(
            """
            UPDATE graph_memory_state
            SET expanded_edges = (
                SELECT ARRAY(SELECT DISTINCT unnest(expanded_edges || ARRAY[%s::text]))
            ),
            last_updated = NOW()
            WHERE user_id=%s::uuid AND graph_id=%s
            """,
            (edge_id, user_id, graph_id),
        )

    def record_pruning(self, user_id: str, graph_id: str, pruned_ids: list, result_summary: dict):
        self._ensure_row(user_id, graph_id)
        entry = json.dumps({
            "paper_ids": pruned_ids,
            "result":    result_summary,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        db.execute(
            """
            UPDATE graph_memory_state
            SET pruning_history = pruning_history || %s::jsonb,
            last_updated = NOW()
            WHERE user_id=%s::uuid AND graph_id=%s
            """,
            (entry, user_id, graph_id),
        )

    def update_navigation(self, user_id: str, graph_id: str, paper_id: str):
        self._ensure_row(user_id, graph_id)
        entry = json.dumps({
            "paper_id":   paper_id,
            "visited_at": datetime.now(timezone.utc).isoformat(),
        })
        db.execute(
            """
            UPDATE graph_memory_state
            SET navigation_path = CASE
                WHEN navigation_path @> %s::jsonb THEN navigation_path
                ELSE navigation_path || %s::jsonb
            END,
            last_updated = NOW()
            WHERE user_id=%s::uuid AND graph_id=%s
            """,
            (
                json.dumps([{"paper_id": paper_id}]),
                json.dumps([{"paper_id": paper_id, "visited_at": datetime.now(timezone.utc).isoformat()}]),
                user_id,
                graph_id,
            ),
        )

    def update_time_machine_position(self, user_id: str, graph_id: str, year: int):
        self._ensure_row(user_id, graph_id)
        db.execute(
            "UPDATE graph_memory_state SET time_machine_position=%s, last_updated=NOW() "
            "WHERE user_id=%s::uuid AND graph_id=%s",
            (year, user_id, graph_id),
        )

    def _ensure_row(self, user_id: str, graph_id: str):
        db.execute(
            """
            INSERT INTO graph_memory_state (user_id, graph_id)
            VALUES (%s::uuid, %s)
            ON CONFLICT (user_id, graph_id) DO NOTHING
            """,
            (user_id, graph_id),
        )
