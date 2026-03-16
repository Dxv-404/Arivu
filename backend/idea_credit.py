"""
backend/idea_credit.py — IdeaCreditSystem (F11.7)

Tracks how ideas propagate through citation chains and assigns
credit to originating papers for their intellectual contributions.
"""
import logging
from collections import defaultdict
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class IdeaCredit:
    paper_id:        str
    title:           str
    credit_score:    float
    adoption_count:  int
    mutation_spread: dict  # {mutation_type: count}
    influence_reach: int

    def to_dict(self) -> dict:
        return {
            "paper_id":        self.paper_id,
            "title":           self.title,
            "credit_score":    round(self.credit_score, 3),
            "adoption_count":  self.adoption_count,
            "mutation_spread": self.mutation_spread,
            "influence_reach": self.influence_reach,
        }


class IdeaCreditSystem:
    """Stateless — instantiate fresh per request."""

    def compute_graph_credits(self, graph_json: dict) -> list:
        """Route-facing method: returns list of credit profile dicts."""
        result = self.analyze(graph_json)
        return result.get("credits", [])

    def analyze(self, graph_json: dict) -> dict:
        nodes = graph_json.get("nodes", [])
        edges = graph_json.get("edges", [])
        node_by_id = {n["id"]: n for n in nodes}

        if not edges:
            return {"credits": [], "summary": "No edges to analyze."}

        # Count how many times each paper is cited and by what mutation type
        citation_counts: dict = defaultdict(int)
        mutation_spread: dict = defaultdict(lambda: defaultdict(int))
        for e in edges:
            tgt = e.get("target") or e.get("cited_paper_id", "")
            mt  = e.get("mutation_type", "unknown")
            citation_counts[tgt] += 1
            mutation_spread[tgt][mt] += 1

        # Build descendant reach for each paper
        cited_by: dict = defaultdict(set)
        for e in edges:
            src = e.get("source") or e.get("citing_paper_id", "")
            tgt = e.get("target") or e.get("cited_paper_id", "")
            cited_by[tgt].add(src)

        def get_reach(paper_id: str, visited: set = None) -> int:
            if visited is None:
                visited = set()
            visited.add(paper_id)
            reach = 0
            for citing in cited_by.get(paper_id, []):
                if citing not in visited:
                    reach += 1 + get_reach(citing, visited)
            return reach

        credits = []
        for paper_id in citation_counts:
            node = node_by_id.get(paper_id, {})
            if not node:
                continue
            reach = get_reach(paper_id, set())
            adoption_count = citation_counts[paper_id]
            # Credit score: weighted by adoption type
            weights = {
                "adoption": 1.0, "generalization": 0.9, "specialization": 0.8,
                "hybridization": 0.7, "revival": 0.6, "contradiction": 0.3,
                "incidental": 0.1,
            }
            score = sum(
                weights.get(mt, 0.5) * count
                for mt, count in mutation_spread[paper_id].items()
            )
            credits.append(IdeaCredit(
                paper_id=paper_id,
                title=node.get("title", ""),
                credit_score=score,
                adoption_count=adoption_count,
                mutation_spread=dict(mutation_spread[paper_id]),
                influence_reach=reach,
            ))

        credits.sort(key=lambda c: c.credit_score, reverse=True)
        return {
            "credits":  [c.to_dict() for c in credits[:20]],
            "summary":  f"Analyzed {len(credits)} papers. Top contributor: {credits[0].title[:60] if credits else 'N/A'}.",
        }
