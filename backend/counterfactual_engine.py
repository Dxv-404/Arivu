"""
backend/counterfactual_engine.py — CounterfactualEngine (F2.2/F2.3)

Computes what-if scenarios: "What would the field look like if paper X never existed?"
Text analysis only in Phase 7 — D3 animated rendering is Phase 8+.

Written from scratch (v1 missing). Uses graph structure + LLM for narrative.
"""
import json
import logging
from dataclasses import dataclass, field
from typing import Optional

import networkx as nx
import backend.db as db
from backend.config import Config

logger = logging.getLogger(__name__)


@dataclass
class CounterfactualResult:
    removed_paper_id:      str
    removed_paper_title:   str
    total_nodes:           int
    collapsed_count:       int
    survived_count:        int
    impact_percentage:     float
    orphaned_ideas:        list
    delayed_discoveries:   list
    alternative_paths:     list
    contingency_score:     float
    narrative:             str

    def to_dict(self) -> dict:
        return {
            "removed_paper":       {"id": self.removed_paper_id, "title": self.removed_paper_title},
            "total_nodes":         self.total_nodes,
            "collapsed_count":     self.collapsed_count,
            "survived_count":      self.survived_count,
            "impact_percentage":   round(self.impact_percentage, 1),
            "orphaned_ideas":      self.orphaned_ideas,
            "delayed_discoveries": self.delayed_discoveries,
            "alternative_paths":   self.alternative_paths,
            "contingency_score":   round(self.contingency_score, 3),
            "narrative":           self.narrative,
        }


class CounterfactualEngine:
    """Stateless — instantiate fresh per request."""

    def analyze(self, graph_json: dict, paper_id: str) -> dict:
        """
        Run counterfactual analysis for removing paper_id from the graph.
        Checks counterfactual_cache first (7-day TTL).
        """
        graph_id = graph_json.get("metadata", {}).get("graph_id", "")

        # Check cache
        if graph_id:
            cached = db.fetchone(
                "SELECT result_json FROM counterfactual_cache "
                "WHERE graph_id = %s AND paper_id = %s "
                "AND computed_at > NOW() - INTERVAL '7 days'",
                (graph_id, paper_id),
            )
            if cached:
                return cached["result_json"]

        result = self._compute(graph_json, paper_id)

        # Write to cache
        if graph_id:
            try:
                db.execute(
                    """
                    INSERT INTO counterfactual_cache (graph_id, paper_id, result_json)
                    VALUES (%s, %s, %s::jsonb)
                    ON CONFLICT (graph_id, paper_id) DO UPDATE
                    SET result_json=EXCLUDED.result_json, computed_at=NOW()
                    """,
                    (graph_id, paper_id, json.dumps(result, default=str)),
                )
            except Exception as exc:
                logger.warning(f"Failed to cache counterfactual result: {exc}")

        return result

    def _compute(self, graph_json: dict, paper_id: str) -> dict:
        nodes = graph_json.get("nodes", [])
        edges = graph_json.get("edges", [])
        node_map = {n["id"]: n for n in nodes}

        if paper_id not in node_map:
            return {"error": "paper_not_in_graph", "paper_id": paper_id}

        removed_paper = node_map[paper_id]

        # Build NetworkX graph
        G = nx.DiGraph()
        for n in nodes:
            G.add_node(n["id"])
        for e in edges:
            src = e.get("source") or e.get("citing_paper_id", "")
            tgt = e.get("target") or e.get("cited_paper_id", "")
            if src and tgt:
                G.add_edge(src, tgt)

        # Find all descendants (papers that depend on this one)
        try:
            descendants = nx.descendants(G, paper_id)
        except nx.NetworkXError:
            descendants = set()

        # Check which descendants would collapse (no alternative path to a root)
        G_removed = G.copy()
        G_removed.remove_node(paper_id)

        # Find root nodes (papers with no outgoing citations — oldest ancestors)
        roots = [n for n in G_removed.nodes() if G_removed.out_degree(n) == 0]

        collapsed = set()
        survived = set()
        alternative_paths = []

        for desc in descendants:
            if desc not in G_removed:
                collapsed.add(desc)
                continue

            # Check if descendant can reach any root without the removed paper
            has_path = False
            for root in roots:
                try:
                    if nx.has_path(G_removed, desc, root):
                        has_path = True
                        path = nx.shortest_path(G_removed, desc, root)
                        if len(alternative_paths) < 5:
                            alternative_paths.append({
                                "paper_id": desc,
                                "title": node_map.get(desc, {}).get("title", ""),
                                "path_via": [node_map.get(p, {}).get("title", p) for p in path[:4]],
                            })
                        break
                except (nx.NetworkXError, nx.NodeNotFound):
                    continue

            if has_path:
                survived.add(desc)
            else:
                collapsed.add(desc)

        total = len(nodes)
        collapsed_count = len(collapsed) + 1  # +1 for the removed paper itself
        survived_count = total - collapsed_count
        impact = (collapsed_count / total * 100) if total > 0 else 0

        # Orphaned ideas: collapsed papers with high citation count
        orphaned = []
        for pid in collapsed:
            paper = node_map.get(pid, {})
            if paper.get("citation_count", 0) > 50:
                orphaned.append({
                    "paper_id": pid,
                    "title": paper.get("title", ""),
                    "citation_count": paper.get("citation_count", 0),
                })
        orphaned = sorted(orphaned, key=lambda x: x["citation_count"], reverse=True)[:10]

        # Delayed discoveries: survived papers that lost their most direct path
        delayed = []
        for pid in survived:
            paper = node_map.get(pid, {})
            # Check if original shortest path went through removed paper
            try:
                if nx.has_path(G, pid, paper_id):
                    delayed.append({
                        "paper_id": pid,
                        "title": paper.get("title", ""),
                        "year": paper.get("year"),
                    })
            except nx.NetworkXError:
                pass
        delayed = delayed[:10]

        # Contingency score: how replaceable is this paper?
        contingency = len(survived) / max(len(descendants), 1) if descendants else 1.0

        # Generate narrative via LLM
        narrative = self._generate_narrative(
            removed_paper, collapsed_count, total, orphaned, delayed, impact
        )

        result = CounterfactualResult(
            removed_paper_id=paper_id,
            removed_paper_title=removed_paper.get("title", ""),
            total_nodes=total,
            collapsed_count=collapsed_count,
            survived_count=survived_count,
            impact_percentage=impact,
            orphaned_ideas=orphaned,
            delayed_discoveries=delayed,
            alternative_paths=alternative_paths,
            contingency_score=contingency,
            narrative=narrative,
        )
        return result.to_dict()

    def _generate_narrative(self, paper, collapsed, total, orphaned, delayed, impact):
        try:
            from backend.llm_client import get_llm_client
            llm = get_llm_client()
            system = (
                "You are a science historian. Given counterfactual analysis data, "
                "write a 2-3 sentence narrative about what would happen if this paper "
                "never existed. Be specific and vivid."
            )
            user = (
                f"Paper: {paper.get('title', 'Unknown')}\n"
                f"Impact: removing it collapses {collapsed} of {total} papers ({impact:.1f}%).\n"
                f"Orphaned high-impact ideas: {len(orphaned)}\n"
                f"Delayed discoveries: {len(delayed)}\n"
                f"Write the narrative."
            )
            return llm.generate_chat_response(system, user) or ""
        except Exception as exc:
            logger.warning(f"Counterfactual narrative generation failed: {exc}")
            title = paper.get("title", "this paper")
            return (
                f"If '{title}' had never been published, approximately {impact:.0f}% of "
                f"the papers in this lineage would not exist in their current form."
            )
