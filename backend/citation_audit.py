"""
backend/citation_audit.py — CitationAudit (F4.4)

Audits a paper's citation practices by checking:
- Overcitation (many citations to same group/venue)
- Undercitation (important related work missing)
- Self-citation rate
- Citation recency distribution

Written from scratch (v1 missing). Uses graph structure + DB lookups.
"""
import logging
from collections import Counter, defaultdict
from dataclasses import dataclass

import backend.db as db

logger = logging.getLogger(__name__)


@dataclass
class CitationAuditResult:
    paper_id:            str
    total_citations:     int
    self_citation_rate:  float
    recency_distribution: dict  # {"0-2y": N, "3-5y": N, "6-10y": N, "10+y": N}
    overcitation_flags:  list   # [{group/venue, count, concern}]
    undercitation_flags: list   # [{paper_id, title, why_important}]
    overall_health:      str    # "healthy" | "concerns" | "problematic"
    recommendations:     list   # [str]

    def to_dict(self) -> dict:
        return {
            "paper_id":            self.paper_id,
            "total_citations":     self.total_citations,
            "self_citation_rate":  round(self.self_citation_rate, 3),
            "recency_distribution": self.recency_distribution,
            "overcitation_flags":  self.overcitation_flags,
            "undercitation_flags": self.undercitation_flags,
            "overall_health":      self.overall_health,
            "recommendations":     self.recommendations,
        }


class CitationAudit:
    """Stateless — instantiate fresh per request."""

    def audit(self, paper_id: str, graph_json: dict) -> CitationAuditResult:
        nodes = graph_json.get("nodes", [])
        edges = graph_json.get("edges", [])
        node_map = {n["id"]: n for n in nodes}

        seed = node_map.get(paper_id, {})
        seed_year = seed.get("year") or 2024
        seed_authors = set(a.lower() for a in (seed.get("authors") or []))

        # Find papers this paper cites (outgoing edges from seed)
        cited_ids = []
        for e in edges:
            src = e.get("source") or e.get("citing_paper_id", "")
            tgt = e.get("target") or e.get("cited_paper_id", "")
            if src == paper_id:
                cited_ids.append(tgt)

        total = len(cited_ids)
        if total == 0:
            return CitationAuditResult(
                paper_id=paper_id, total_citations=0,
                self_citation_rate=0, recency_distribution={},
                overcitation_flags=[], undercitation_flags=[],
                overall_health="healthy", recommendations=["No citations found to audit."],
            )

        # Self-citation check
        self_cite_count = 0
        for cid in cited_ids:
            cited = node_map.get(cid, {})
            cited_authors = set(a.lower() for a in (cited.get("authors") or []))
            if seed_authors & cited_authors:
                self_cite_count += 1
        self_cite_rate = self_cite_count / total if total > 0 else 0

        # Recency distribution
        recency = {"0-2y": 0, "3-5y": 0, "6-10y": 0, "10+y": 0}
        for cid in cited_ids:
            cited = node_map.get(cid, {})
            cyear = cited.get("year")
            if cyear:
                age = seed_year - cyear
                if age <= 2:
                    recency["0-2y"] += 1
                elif age <= 5:
                    recency["3-5y"] += 1
                elif age <= 10:
                    recency["6-10y"] += 1
                else:
                    recency["10+y"] += 1

        # Overcitation: check venue concentration
        venue_counts = Counter()
        for cid in cited_ids:
            cited = node_map.get(cid, {})
            venue = cited.get("venue") or "unknown"
            venue_counts[venue] += 1

        overcitation = []
        for venue, count in venue_counts.most_common(5):
            if count >= 5 and count / total > 0.3:
                overcitation.append({
                    "venue": venue,
                    "count": count,
                    "concern": f"{count}/{total} citations from same venue ({count/total:.0%})",
                })

        # Undercitation: find high-impact papers in graph NOT cited by seed
        all_cited_set = set(cited_ids)
        undercitation = []
        for n in nodes:
            if n["id"] == paper_id or n["id"] in all_cited_set:
                continue
            if (n.get("citation_count", 0) > 500
                    and n.get("year", 0) < seed_year):
                undercitation.append({
                    "paper_id": n["id"],
                    "title": n.get("title", ""),
                    "why_important": f"High-impact paper ({n['citation_count']} citations) in the same graph but not cited.",
                })
        undercitation = undercitation[:5]

        # Overall health
        health = "healthy"
        recommendations = []
        if self_cite_rate > 0.3:
            health = "concerns"
            recommendations.append(f"Self-citation rate is {self_cite_rate:.0%} — consider reducing.")
        if overcitation:
            health = "concerns"
            recommendations.append("Citation concentration detected — diversify sources.")
        if undercitation:
            if health == "healthy":
                health = "concerns"
            recommendations.append(f"Consider citing {len(undercitation)} high-impact related papers.")
        if recency.get("0-2y", 0) == 0 and total > 5:
            recommendations.append("No recent citations (0-2 years) — consider adding recent work.")

        if not recommendations:
            recommendations.append("Citation practices look healthy.")

        return CitationAuditResult(
            paper_id=paper_id,
            total_citations=total,
            self_citation_rate=self_cite_rate,
            recency_distribution=recency,
            overcitation_flags=overcitation,
            undercitation_flags=undercitation,
            overall_health=health,
            recommendations=recommendations,
        )
