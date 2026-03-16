"""
backend/time_machine.py — TimeMachineEngine (F2.1)

Computes temporal slices of a citation graph for the Time Machine visualization.
Results cached in time_machine_cache table (7-day TTL).

FIX (GAP-P7-N6): ExtinctionEventDetector.detect() called ONCE, not O(N_years) times.
FIX (GAP-P7-N5): vocabulary_snapshots table is used as a read/write cache.
"""
import json
import logging
from dataclasses import dataclass, field
from typing import Optional

import backend.db as db

logger = logging.getLogger(__name__)


@dataclass
class TemporalSlice:
    year:            int
    nodes:           list
    edges:           list
    added_nodes:     list
    added_edges:     list
    node_weights:    dict
    paradigm_events: list
    extinction_events: list

    def to_dict(self) -> dict:
        return {
            "year":              self.year,
            "nodes":             self.nodes,
            "edges":             self.edges,
            "added_nodes":       self.added_nodes,
            "added_edges":       self.added_edges,
            "node_weights":      self.node_weights,
            "paradigm_events":   self.paradigm_events,
            "extinction_events": self.extinction_events,
        }


class TimeMachineEngine:
    """Stateless — instantiate fresh per request."""

    def build_timeline(self, graph_json: dict) -> dict:
        """
        Build the complete temporal dataset for the Time Machine.
        Checks time_machine_cache first (7-day TTL).
        Writes result to cache on miss.
        """
        graph_id = graph_json.get("metadata", {}).get("graph_id", "")

        # Check full result cache first
        if graph_id:
            cached = db.fetchone(
                "SELECT result_json FROM time_machine_cache "
                "WHERE graph_id = %s AND computed_at > NOW() - INTERVAL '7 days'",
                (graph_id,),
            )
            if cached:
                return cached["result_json"]

        result = self._compute_timeline(graph_json)

        # Write to cache
        if graph_id:
            db.execute(
                """
                INSERT INTO time_machine_cache (graph_id, result_json)
                VALUES (%s, %s::jsonb)
                ON CONFLICT (graph_id) DO UPDATE
                SET result_json=EXCLUDED.result_json, computed_at=NOW()
                """,
                (graph_id, json.dumps(result, default=str)),
            )

        return result

    def _compute_timeline(self, graph_json: dict) -> dict:
        nodes = graph_json.get("nodes", [])
        edges = graph_json.get("edges", [])

        if not nodes:
            return {"min_year": 0, "max_year": 0, "slices": {},
                    "vocabulary_heatmap": {}, "extinction_events": [], "paradigm_events": []}

        years = [n.get("year") for n in nodes if n.get("year")]
        if not years:
            return {"min_year": 0, "max_year": 0, "slices": {},
                    "vocabulary_heatmap": {}, "extinction_events": [], "paradigm_events": []}

        min_year = min(years)
        max_year = max(years)

        # FIX (GAP-P7-N6): Call detect() ONCE before the loop, not inside it.
        from backend.extinction_detector import ExtinctionEventDetector
        all_extinction_events = ExtinctionEventDetector().detect(graph_json)
        all_paradigm_events   = graph_json.get("paradigm_data", {}).get("shift_events", [])

        # Index events by year for O(1) per-year lookup inside loop
        extinction_by_year: dict = {}
        for e in all_extinction_events:
            for yr in [e.get("peak_year"), e.get("end_year")]:
                if yr:
                    extinction_by_year.setdefault(yr, []).append(e)

        paradigm_by_year: dict = {}
        for pe in all_paradigm_events:
            yr = pe.get("year")
            if yr:
                paradigm_by_year.setdefault(yr, []).append(pe)

        slices:          dict = {}
        prev_node_ids:   set  = set()
        prev_edge_keys:  set  = set()

        for year in range(min_year, max_year + 1):
            year_nodes    = [n for n in nodes if n.get("year") and n["year"] <= year]
            year_node_ids = {n["id"] for n in year_nodes}

            year_edges = [
                e for e in edges
                if (e.get("source") or e.get("citing_paper_id", "")) in year_node_ids
                and (e.get("target") or e.get("cited_paper_id", "")) in year_node_ids
            ]

            node_weights: dict = {}
            for node_id in year_node_ids:
                node_weights[node_id] = sum(
                    1 for e in year_edges
                    if (e.get("target") or e.get("cited_paper_id", "")) == node_id
                )

            added_nodes = [n for n in year_nodes if n["id"] not in prev_node_ids]
            edge_keys   = {(e.get("source",""), e.get("target","")) for e in year_edges}
            added_edges = [e for e in year_edges
                           if (e.get("source",""), e.get("target","")) not in prev_edge_keys]

            slices[year] = TemporalSlice(
                year=year,
                nodes=year_nodes,
                edges=year_edges,
                added_nodes=added_nodes,
                added_edges=added_edges,
                node_weights=node_weights,
                paradigm_events=paradigm_by_year.get(year, []),
                extinction_events=extinction_by_year.get(year, []),
            ).to_dict()

            prev_node_ids  = year_node_ids
            prev_edge_keys = edge_keys

        # Build vocabulary heatmap with caching via vocabulary_snapshots
        from backend.vocabulary_tracker import VocabularyEvolutionTracker
        vocab             = VocabularyEvolutionTracker()
        graph_id          = graph_json.get("metadata", {}).get("graph_id", "")
        vocabulary_heatmap = vocab.build_heatmap_cached(graph_json, min_year, max_year, graph_id)

        return {
            "min_year":           min_year,
            "max_year":           max_year,
            "slices":             slices,
            "vocabulary_heatmap": vocabulary_heatmap,
            "extinction_events":  all_extinction_events,
            "paradigm_events":    all_paradigm_events,
        }
