"""
backend/citation_shadow.py — CitationShadowDetector
Shadow score = indirect_descendants / (direct_citations + 1)
High score = foundational but under-recognized in direct citations.
"""
import logging
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)
MIN_DIRECT_CITATIONS = 1
MIN_SHADOW_SCORE     = 2.0
MAX_RESULTS          = 15


@dataclass
class ShadowPaper:
    paper_id:             str
    title:                str
    year:                 Optional[int]
    direct_citations:     int
    indirect_descendants: int
    shadow_score:         float
    citation_count:       int

    def to_dict(self) -> dict:
        return {
            "paper_id":             self.paper_id,
            "title":                self.title,
            "year":                 self.year,
            "direct_citations":     self.direct_citations,
            "indirect_descendants": self.indirect_descendants,
            "shadow_score":         round(self.shadow_score, 2),
            "citation_count":       self.citation_count,
        }


class CitationShadowDetector:
    def detect_shadows(self, graph_json: dict) -> list[ShadowPaper]:
        try:
            import networkx as nx
        except ImportError:
            logger.error("networkx not installed")
            return []

        nodes = graph_json.get("nodes", [])
        edges = graph_json.get("edges", [])
        if len(nodes) < 3:
            return []

        node_by_id = {n["id"]: n for n in nodes}
        G = nx.DiGraph()
        for node in nodes:
            G.add_node(node["id"])
        for edge in edges:
            src = edge.get("source") or edge.get("citing_paper_id", "")
            tgt = edge.get("target") or edge.get("cited_paper_id", "")
            if src and tgt and src in G and tgt in G:
                G.add_edge(src, tgt)

        results: list[ShadowPaper] = []
        for node_id in G.nodes():
            direct = G.in_degree(node_id)
            if direct < MIN_DIRECT_CITATIONS:
                continue
            try:
                descendants = len(nx.ancestors(G, node_id))
            except Exception:
                descendants = 0
            indirect = max(0, descendants - direct)
            shadow   = indirect / (direct + 1)
            if shadow < MIN_SHADOW_SCORE:
                continue
            node = node_by_id.get(node_id, {})
            results.append(ShadowPaper(
                paper_id=node_id, title=node.get("title", "Unknown"),
                year=node.get("year"), direct_citations=direct,
                indirect_descendants=indirect, shadow_score=shadow,
                citation_count=node.get("citation_count", 0) or 0,
            ))

        results.sort(key=lambda p: p.shadow_score, reverse=True)
        return results[:MAX_RESULTS]
