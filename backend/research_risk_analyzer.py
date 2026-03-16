"""
backend/research_risk_analyzer.py — ResearchRiskAnalyzer (F4.8)

Analyzes research risks in a citation graph: methodology concentration,
single-source dependencies, and replication concerns.
"""
import logging
from collections import defaultdict
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class RiskFactor:
    risk_type:   str
    severity:    str  # "high" | "medium" | "low"
    description: str
    affected_papers: list
    mitigation: str

    def to_dict(self) -> dict:
        return {
            "risk_type":       self.risk_type,
            "severity":        self.severity,
            "description":     self.description,
            "affected_papers": self.affected_papers[:5],
            "mitigation":      self.mitigation,
        }


class ResearchRiskAnalyzer:
    """Stateless — instantiate fresh per request."""

    def analyze(self, graph_json: dict, research_direction: str = "") -> dict:
        nodes = graph_json.get("nodes", [])
        edges = graph_json.get("edges", [])

        if len(nodes) < 3:
            return {"risks": [], "overall_risk": "low", "summary": "Graph too small for risk analysis."}

        risks = []
        node_by_id = {n["id"]: n for n in nodes}

        # Risk 1: Single-source dependency
        cited_counts: dict = defaultdict(int)
        for e in edges:
            tgt = e.get("target") or e.get("cited_paper_id", "")
            cited_counts[tgt] += 1

        total_edges = max(len(edges), 1)
        for pid, count in cited_counts.items():
            ratio = count / total_edges
            if ratio > 0.3:
                node = node_by_id.get(pid, {})
                risks.append(RiskFactor(
                    risk_type="single_source_dependency",
                    severity="high",
                    description=f"Paper '{node.get('title', '')[:60]}' is cited by {ratio:.0%} of all edges. "
                               f"If retracted, the entire lineage is at risk.",
                    affected_papers=[{"paper_id": pid, "title": node.get("title", "")}],
                    mitigation="Identify alternative foundational works that could replace this dependency.",
                ))

        # Risk 2: Methodology concentration
        mutation_counts: dict = defaultdict(int)
        for e in edges:
            mt = e.get("mutation_type", "unknown")
            mutation_counts[mt] += 1

        if mutation_counts.get("adoption", 0) > total_edges * 0.6:
            risks.append(RiskFactor(
                risk_type="methodology_concentration",
                severity="medium",
                description=f"{mutation_counts['adoption']} of {total_edges} edges are pure adoption. "
                           f"The field may be over-reliant on a single methodological approach.",
                affected_papers=[],
                mitigation="Look for papers that generalize or hybridize the dominant method.",
            ))

        # Risk 3: Temporal gap (no recent papers)
        years = [n.get("year") for n in nodes if n.get("year")]
        if years:
            max_year = max(years)
            if max_year < 2020:
                risks.append(RiskFactor(
                    risk_type="temporal_gap",
                    severity="medium",
                    description=f"Most recent paper in lineage is from {max_year}. "
                               f"This research direction may be stagnant.",
                    affected_papers=[],
                    mitigation="Search for recent publications that may continue this line of work.",
                ))

        # Risk 4: Retracted papers in the lineage
        retracted = [n for n in nodes if n.get("is_retracted")]
        if retracted:
            risks.append(RiskFactor(
                risk_type="retraction_in_lineage",
                severity="high",
                description=f"{len(retracted)} retracted paper(s) found in the intellectual ancestry.",
                affected_papers=[{"paper_id": n["id"], "title": n.get("title", "")} for n in retracted[:3]],
                mitigation="Verify which downstream findings depend on the retracted work.",
            ))

        # Overall risk
        high_count = sum(1 for r in risks if r.severity == "high")
        overall = "high" if high_count >= 2 else "medium" if high_count >= 1 or len(risks) >= 3 else "low"

        return {
            "risks":        [r.to_dict() for r in risks],
            "overall_risk": overall,
            "summary":      f"Found {len(risks)} risk factor(s). Overall risk level: {overall}.",
        }
