"""
backend/intellectual_debt.py — IntellectualDebtTracker (F11.4)

Identifies "intellectual debt" in a research lineage: foundational assumptions
that downstream papers rely on but never verified independently.
"""
import logging
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class DebtItem:
    paper_id:         str
    title:            str
    assumption:       str
    dependent_count:  int
    verification_gap: str
    severity:         str  # "critical" | "moderate" | "minor"

    def to_dict(self) -> dict:
        return {
            "paper_id":         self.paper_id,
            "title":            self.title,
            "assumption":       self.assumption,
            "dependent_count":  self.dependent_count,
            "verification_gap": self.verification_gap,
            "severity":         self.severity,
        }


class IntellectualDebtTracker:
    """Stateless — instantiate fresh per request."""

    def analyze(self, graph_json: dict) -> dict:
        nodes = graph_json.get("nodes", [])
        edges = graph_json.get("edges", [])

        if not nodes:
            return {"debts": [], "summary": "Empty graph.", "total_debt_score": 0}

        node_by_id = {n["id"]: n for n in nodes}

        # Build citation counts per cited paper
        cited_counts: dict = {}
        for e in edges:
            tgt = e.get("target") or e.get("cited_paper_id", "")
            cited_counts[tgt] = cited_counts.get(tgt, 0) + 1

        # Find root papers (no outgoing citations) — these are foundational
        citing_set = {e.get("source") or e.get("citing_paper_id", "") for e in edges}
        cited_set  = {e.get("target") or e.get("cited_paper_id", "") for e in edges}
        roots      = cited_set - citing_set

        debts = []
        for root_id in roots:
            node = node_by_id.get(root_id, {})
            if not node:
                continue
            dep_count = cited_counts.get(root_id, 0)
            if dep_count < 2:
                continue

            year = node.get("year") or 0
            age  = 2026 - year if year else 0

            severity = "minor"
            if dep_count >= 10 and age >= 20:
                severity = "critical"
            elif dep_count >= 5 or age >= 15:
                severity = "moderate"

            debts.append(DebtItem(
                paper_id=root_id,
                title=node.get("title", ""),
                assumption=f"Foundational paper cited by {dep_count} descendants without independent replication.",
                dependent_count=dep_count,
                verification_gap=f"Published {age} years ago with {dep_count} dependent papers.",
                severity=severity,
            ))

        debts.sort(key=lambda d: d.dependent_count, reverse=True)
        total_score = sum(
            {"critical": 3, "moderate": 2, "minor": 1}.get(d.severity, 0)
            for d in debts
        )

        return {
            "debts":            [d.to_dict() for d in debts[:15]],
            "total_debt_score": total_score,
            "summary":          self._summary(debts),
        }

    def _summary(self, debts: list) -> str:
        if not debts:
            return "No significant intellectual debt detected."
        critical = sum(1 for d in debts if d.severity == "critical")
        return (
            f"Found {len(debts)} intellectual debt item(s). "
            f"{critical} critical — foundational assumptions that need independent verification."
        )
