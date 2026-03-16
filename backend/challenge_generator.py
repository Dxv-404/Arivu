"""
backend/challenge_generator.py — ChallengeGenerator (F11.5)

Generates research challenges based on graph analysis:
gaps, contradictions, and under-explored connections.
"""
import logging
from dataclasses import dataclass
from typing import Optional

from backend.llm_client import get_llm_client

logger = logging.getLogger(__name__)


@dataclass
class Challenge:
    challenge_id:   str
    title:          str
    description:    str
    difficulty:     str  # "beginner" | "intermediate" | "advanced"
    related_papers: list
    challenge_type: str  # "gap" | "contradiction" | "extension" | "replication"

    def to_dict(self) -> dict:
        return {
            "challenge_id":   self.challenge_id,
            "title":          self.title,
            "description":    self.description,
            "difficulty":     self.difficulty,
            "related_papers": self.related_papers,
            "challenge_type": self.challenge_type,
        }


class ChallengeGenerator:
    """Stateless — instantiate fresh per request."""

    def generate(self, graph_json: dict, paper_id: str = None) -> dict:
        nodes = graph_json.get("nodes", [])
        edges = graph_json.get("edges", [])

        if len(nodes) < 3:
            return {"challenges": [], "summary": "Graph too small for challenge generation."}

        challenges = []

        # Type 1: Gap challenges — papers with few outgoing citations (under-explored)
        node_by_id  = {n["id"]: n for n in nodes}
        citing_counts: dict = {}
        for e in edges:
            src = e.get("source") or e.get("citing_paper_id", "")
            citing_counts[src] = citing_counts.get(src, 0) + 1

        leaf_nodes = [n for n in nodes if citing_counts.get(n["id"], 0) == 0 and not n.get("is_seed")]
        for i, leaf in enumerate(leaf_nodes[:3]):
            challenges.append(Challenge(
                challenge_id=f"gap_{i}",
                title=f"Extend: {leaf.get('title', 'Unknown')[:60]}",
                description=f"This paper has no downstream citations in this graph. "
                           f"What research could build on its contributions?",
                difficulty="intermediate",
                related_papers=[{"paper_id": leaf["id"], "title": leaf.get("title", "")}],
                challenge_type="gap",
            ))

        # Type 2: Contradiction challenges
        for e in edges:
            if e.get("mutation_type") == "contradiction":
                src_id = e.get("source") or e.get("citing_paper_id", "")
                tgt_id = e.get("target") or e.get("cited_paper_id", "")
                src = node_by_id.get(src_id, {})
                tgt = node_by_id.get(tgt_id, {})
                challenges.append(Challenge(
                    challenge_id=f"contradiction_{len(challenges)}",
                    title=f"Resolve: {src.get('title', '')[:40]} vs {tgt.get('title', '')[:40]}",
                    description="These papers present contradictory findings. Design an experiment to resolve the disagreement.",
                    difficulty="advanced",
                    related_papers=[
                        {"paper_id": src_id, "title": src.get("title", "")},
                        {"paper_id": tgt_id, "title": tgt.get("title", "")},
                    ],
                    challenge_type="contradiction",
                ))
                if len(challenges) >= 8:
                    break

        # Type 3: Replication challenge for highly-cited root papers
        cited_counts: dict = {}
        for e in edges:
            tgt = e.get("target") or e.get("cited_paper_id", "")
            cited_counts[tgt] = cited_counts.get(tgt, 0) + 1

        top_cited = sorted(nodes, key=lambda n: cited_counts.get(n["id"], 0), reverse=True)
        for n in top_cited[:2]:
            if cited_counts.get(n["id"], 0) >= 3:
                challenges.append(Challenge(
                    challenge_id=f"replication_{len(challenges)}",
                    title=f"Replicate: {n.get('title', '')[:60]}",
                    description=f"This highly-cited paper ({cited_counts[n['id']]} citations in graph) "
                               f"would benefit from independent replication.",
                    difficulty="beginner",
                    related_papers=[{"paper_id": n["id"], "title": n.get("title", "")}],
                    challenge_type="replication",
                ))

        return {
            "challenges": [c.to_dict() for c in challenges[:10]],
            "summary":    f"Generated {len(challenges)} research challenges from this graph.",
        }
