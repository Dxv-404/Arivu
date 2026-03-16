"""
backend/error_propagation.py — ErrorPropagationTracker (F1.15)

Requires papers.pubpeer_flags JSONB column — added in Phase 8 migration.
"""
import logging
from dataclasses import dataclass
from typing import Optional

import backend.db as db

logger = logging.getLogger(__name__)


@dataclass
class RetractedFoundation:
    paper_id:       str
    title:          str
    issue_type:     str
    issue_detail:   str
    affected_count: int
    affected_ids:   list

    def to_dict(self) -> dict:
        return {
            "paper_id":       self.paper_id,
            "title":          self.title,
            "issue_type":     self.issue_type,
            "issue_detail":   self.issue_detail,
            "affected_count": self.affected_count,
            "affected_ids":   self.affected_ids[:10],
        }


@dataclass
class ErrorExposure:
    paper_id:          str
    title:             str
    exposure_score:    float
    exposure_tier:     str
    flagged_ancestors: list

    def to_dict(self) -> dict:
        return {
            "paper_id":          self.paper_id,
            "title":             self.title,
            "exposure_score":    round(self.exposure_score, 3),
            "exposure_tier":     self.exposure_tier,
            "flagged_ancestors": self.flagged_ancestors,
        }


class ErrorPropagationTracker:
    """Stateless — instantiate fresh per request."""

    def analyze(self, graph_json: dict) -> dict:
        nodes      = graph_json.get("nodes", [])
        edges      = graph_json.get("edges", [])
        node_by_id = {n["id"]: n for n in nodes}
        all_ids    = [n["id"] for n in nodes]

        if not all_ids:
            return {"flagged_papers": [], "exposure_scores": [], "clean": True, "summary": "Empty graph."}

        flagged_rows = db.fetchall(
            """
            SELECT p.paper_id, p.title, p.is_retracted, p.retraction_reason,
                   p.pubpeer_flags, r.reason AS rw_reason, r.retraction_date
            FROM papers p
            LEFT JOIN retraction_watch r ON r.doi = p.doi
            WHERE p.paper_id = ANY(%s)
              AND (p.is_retracted = TRUE OR p.pubpeer_flags IS NOT NULL)
            """,
            (all_ids,),
        )

        flagged:     list = []
        flagged_ids: set  = set()
        descendants       = self._build_descendants(edges, all_ids)

        for row in flagged_rows:
            pid        = row["paper_id"]
            flagged_ids.add(pid)
            issue_type = "retracted" if row.get("is_retracted") else "pubpeer_concern"
            pf         = row.get("pubpeer_flags")
            pf_summary = ""
            if isinstance(pf, dict):
                pf_summary = pf.get("summary", "Post-publication concerns flagged")
            issue_detail = (row.get("rw_reason") or pf_summary or "No detail available")[:300]
            affected     = [d for d in descendants.get(pid, []) if d in node_by_id]

            flagged.append(RetractedFoundation(
                paper_id=pid, title=row.get("title", ""),
                issue_type=issue_type, issue_detail=issue_detail,
                affected_count=len(affected), affected_ids=affected[:10],
            ).to_dict())

        exposures: list = []
        for node in nodes:
            nid       = node["id"]
            ancestors = self._get_ancestors(nid, edges)
            if not ancestors:
                continue
            n_flagged = len(ancestors & flagged_ids)
            score     = n_flagged / max(len(ancestors), 1)
            tier      = "clean"
            if score > 0.3:
                tier = "high"
            elif score > 0.1:
                tier = "medium"
            elif score > 0:
                tier = "low"

            if tier != "clean":
                flagged_anc = [
                    next((f for f in flagged if f["paper_id"] == a), None)
                    for a in ancestors & flagged_ids
                ]
                exposures.append(ErrorExposure(
                    paper_id=nid, title=node.get("title", ""),
                    exposure_score=score, exposure_tier=tier,
                    flagged_ancestors=[f for f in flagged_anc if f],
                ).to_dict())

        exposures.sort(key=lambda x: x["exposure_score"], reverse=True)
        clean   = len(flagged) == 0
        summary = self._build_summary(flagged, exposures)

        return {
            "flagged_papers":  flagged,
            "exposure_scores": exposures[:20],
            "clean":           clean,
            "summary":         summary,
        }

    def _build_descendants(self, edges: list, all_ids: list) -> dict:
        cited_by: dict = {}
        for e in edges:
            src = e.get("source") or e.get("citing_paper_id", "")
            tgt = e.get("target") or e.get("cited_paper_id", "")
            cited_by.setdefault(tgt, set()).add(src)
        descendants: dict = {}
        for node_id in all_ids:
            desc    = set()
            queue   = list(cited_by.get(node_id, []))
            visited = {node_id}
            while queue:
                curr = queue.pop(0)
                if curr in visited:
                    continue
                visited.add(curr)
                desc.add(curr)
                queue.extend(cited_by.get(curr, []))
            descendants[node_id] = desc
        return descendants

    def _get_ancestors(self, paper_id: str, edges: list) -> set:
        cites: dict = {}
        for e in edges:
            src = e.get("source") or e.get("citing_paper_id", "")
            tgt = e.get("target") or e.get("cited_paper_id", "")
            cites.setdefault(src, set()).add(tgt)
        ancestors = set()
        queue     = list(cites.get(paper_id, []))
        visited   = {paper_id}
        while queue:
            curr = queue.pop(0)
            if curr in visited:
                continue
            visited.add(curr)
            ancestors.add(curr)
            queue.extend(cites.get(curr, []))
        return ancestors

    def _build_summary(self, flagged, exposures) -> str:
        if not flagged:
            return "No retracted or flagged papers found in this graph."
        high = sum(1 for e in exposures if e["exposure_tier"] == "high")
        return (
            f"Found {len(flagged)} paper(s) with known issues. "
            f"{high} paper(s) have high exposure (>30% of intellectual foundation on flagged work)."
        )
