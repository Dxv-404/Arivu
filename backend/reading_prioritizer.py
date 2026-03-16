"""
backend/reading_prioritizer.py — ReadingPrioritizer (F4.6)

Generates a prioritized reading list from a citation graph based on:
- Structural importance (PageRank)
- Bottleneck status
- Year distribution (coverage)
- Estimated reading time

Written from scratch (v1 missing).
"""
import logging
from dataclasses import dataclass

import networkx as nx

logger = logging.getLogger(__name__)


@dataclass
class ReadingItem:
    paper_id:    str
    title:       str
    year:        int
    priority:    float  # 0-1, higher = more important to read
    reason:      str
    est_minutes: int    # estimated reading time
    category:    str    # "foundational" | "methodological" | "recent" | "bridging"

    def to_dict(self) -> dict:
        return {
            "paper_id":    self.paper_id,
            "title":       self.title,
            "year":        self.year,
            "priority":    round(self.priority, 3),
            "reason":      self.reason,
            "est_minutes": self.est_minutes,
            "category":    self.category,
        }


class ReadingPrioritizer:
    """Stateless — instantiate fresh per request."""

    def prioritize(self, graph_json: dict, max_items: int = 20) -> list:
        nodes = graph_json.get("nodes", [])
        edges = graph_json.get("edges", [])

        if not nodes:
            return []

        node_map = {n["id"]: n for n in nodes}

        # Build NetworkX graph for PageRank
        G = nx.DiGraph()
        for n in nodes:
            G.add_node(n["id"])
        for e in edges:
            src = e.get("source") or e.get("citing_paper_id", "")
            tgt = e.get("target") or e.get("cited_paper_id", "")
            if src and tgt and src in G and tgt in G:
                G.add_edge(src, tgt)

        # PageRank
        try:
            pr = nx.pagerank(G, alpha=0.85)
        except Exception:
            pr = {n: 1.0 / len(nodes) for n in G.nodes()}

        max_pr = max(pr.values()) if pr else 1.0

        items = []
        for node in nodes:
            pid = node["id"]
            year = node.get("year") or 2000
            citations = node.get("citation_count", 0)
            is_bottleneck = node.get("is_bottleneck", False)
            title = node.get("title", pid)

            # Compute priority score
            pagerank_score = pr.get(pid, 0) / max_pr if max_pr > 0 else 0
            citation_score = min(citations / 1000, 1.0) if citations else 0

            # Determine category
            if is_bottleneck:
                category = "foundational"
                priority = 0.9 + pagerank_score * 0.1
                reason = "Bottleneck paper — removing it collapses many descendants."
            elif year >= 2022:
                category = "recent"
                priority = 0.3 + citation_score * 0.3 + pagerank_score * 0.3
                reason = "Recent work — stay current with the latest developments."
            elif pagerank_score > 0.5:
                category = "methodological"
                priority = 0.5 + pagerank_score * 0.3 + citation_score * 0.2
                reason = f"High structural importance (PageRank: {pagerank_score:.2f})."
            else:
                category = "bridging"
                priority = 0.2 + pagerank_score * 0.3 + citation_score * 0.2
                reason = "Bridges between research clusters."

            # Estimate reading time (rough: based on text_tier)
            text_tier = node.get("text_tier", 4)
            est_minutes = {1: 45, 2: 30, 3: 15, 4: 10}.get(text_tier, 15)

            items.append(ReadingItem(
                paper_id=pid,
                title=title,
                year=year,
                priority=min(priority, 1.0),
                reason=reason,
                est_minutes=est_minutes,
                category=category,
            ))

        # Sort by priority descending
        items.sort(key=lambda x: x.priority, reverse=True)

        return [item.to_dict() for item in items[:max_items]]
