"""
backend/living_paper_scorer.py

LivingPaperScorer: computes citation velocity and trajectory for each paper
in a graph. Uses the paper's citation_count from the papers table and the
edge structure of the graph to estimate momentum.

Score 0-100:
  - 80-100: Rising fast — heavy recent citation activity
  - 60-79:  Stable — consistent citation activity
  - 40-59:  Declining — was more cited historically
  - 0-39:   Dormant/extinct — minimal recent activity

Trajectory:
  "rising"    — recent citations outpace historical rate
  "stable"    — consistent rate over time
  "declining" — slowing citation rate
  "extinct"   — no meaningful recent citations

Algorithm:
  1. Build per-paper citation timelines from the graph's edge publication years
  2. Split into recent (last 3 years) and historical windows
  3. Score = 50 * (recent_rate / max_rate) + 50 * (recency_weight)
  4. Trajectory from rate of change between windows

Does NOT call the NLP worker — uses only citation_count and year from DB.
"""
import logging
import math
from datetime import datetime, timezone
from dataclasses import dataclass
from typing import Optional
from collections import defaultdict

logger = logging.getLogger(__name__)


def _current_year() -> int:
    """Return the current year dynamically. Never hardcode this value."""
    return datetime.now(timezone.utc).year


@dataclass
class LivingScore:
    paper_id:          str
    score:             float    # 0-100
    trajectory:        str      # "rising" | "stable" | "declining" | "extinct"
    recent_citations:  int      # citations in last 3 years (from graph edges)
    total_citations:   int      # citation_count from DB
    citation_velocity: float    # estimated citations per year (recent window)
    peer_percentile:   float    # 0-1 position within this graph

    def to_dict(self) -> dict:
        return {
            "paper_id":          self.paper_id,
            "score":             round(self.score, 1),
            "trajectory":        self.trajectory,
            "recent_citations":  self.recent_citations,
            "total_citations":   self.total_citations,
            "citation_velocity": round(self.citation_velocity, 2),
            "peer_percentile":   round(self.peer_percentile, 2),
        }


class LivingPaperScorer:
    """
    Compute living scores for all papers in a graph JSON dict.
    Stateless — instantiate fresh per request.
    """

    RECENT_WINDOW_YEARS = 3    # "recent" = last N years
    EXTINCT_THRESHOLD   = 5    # papers older than N years with 0 recent cites = extinct
    RISING_RATIO        = 1.5  # recent_rate / historical_rate to be "rising"
    DECLINING_RATIO     = 0.5  # recent_rate / historical_rate to be "declining"

    def score_graph(self, graph_json: dict) -> dict:
        """
        Compute living scores for all nodes in the graph.

        Args:
            graph_json: graph dict from export_to_json() / R2

        Returns:
            {paper_id: LivingScore} for every node
        """
        nodes = graph_json.get("nodes", [])
        edges = graph_json.get("edges", [])

        if not nodes:
            return {}

        # Build citation timeline from edge structure.
        # An edge source->target means source CITES target.
        # The source paper's year is when the citation occurred.
        cite_years: dict = defaultdict(list)
        for edge in edges:
            cited_id  = edge.get("target") or edge.get("cited_paper_id")
            source_id = edge.get("source") or edge.get("citing_paper_id")
            if cited_id and source_id:
                cite_years[cited_id].append(source_id)

        node_by_id = {n["id"]: n for n in nodes}

        cite_year_ints: dict = defaultdict(list)
        for cited_id, source_ids in cite_years.items():
            for src_id in source_ids:
                src_node = node_by_id.get(src_id)
                if src_node and src_node.get("year"):
                    cite_year_ints[cited_id].append(int(src_node["year"]))

        current_year = _current_year()  # Always dynamic — never hardcoded
        raw_scores: dict   = {}
        recent_counts: dict = {}
        velocities: dict   = {}
        trajectories: dict = {}

        for node in nodes:
            pid       = node["id"]
            year      = node.get("year") or (current_year - 5)
            paper_age = current_year - int(year)

            citation_years = cite_year_ints.get(pid, [])
            cutoff = current_year - self.RECENT_WINDOW_YEARS
            recent     = [y for y in citation_years if y >= cutoff]
            historical = [y for y in citation_years if y < cutoff]

            recent_count    = len(recent)
            historical_count = len(historical)

            velocity = recent_count / max(self.RECENT_WINDOW_YEARS, 1)
            velocities[pid]     = velocity
            recent_counts[pid]  = recent_count

            historical_window = max(paper_age - self.RECENT_WINDOW_YEARS, 1)
            historical_rate   = historical_count / historical_window
            recent_rate       = velocity

            if paper_age <= 2:
                trajectory = "rising" if recent_count > 0 else "stable"
            elif recent_count == 0 and paper_age >= self.EXTINCT_THRESHOLD:
                trajectory = "extinct"
            elif historical_rate == 0:
                trajectory = "rising" if recent_rate > 0 else "stable"
            elif recent_rate / historical_rate >= self.RISING_RATIO:
                trajectory = "rising"
            elif recent_rate / historical_rate <= self.DECLINING_RATIO:
                trajectory = "declining"
            else:
                trajectory = "stable"

            trajectories[pid] = trajectory
            db_citations      = node.get("citation_count", 0) or 0
            recency_bonus     = min(1.0, recent_count / max(paper_age * 0.5, 1))
            raw_scores[pid]   = (velocity * 30) + (recency_bonus * 20) + min(db_citations / 1000.0, 50)

        if not raw_scores:
            return {}

        max_raw = max(raw_scores.values()) or 1.0
        all_scores = list(raw_scores.values())
        all_scores.sort()

        result: dict = {}
        for node in nodes:
            pid          = node["id"]
            raw          = raw_scores.get(pid, 0.0)
            normalized   = (raw / max_raw) * 100.0
            rank         = all_scores.index(raw) if raw in all_scores else 0
            percentile   = rank / max(len(all_scores) - 1, 1)

            result[pid] = LivingScore(
                paper_id          = pid,
                score             = round(min(normalized, 100.0), 1),
                trajectory        = trajectories.get(pid, "stable"),
                recent_citations  = recent_counts.get(pid, 0),
                total_citations   = node.get("citation_count", 0) or 0,
                citation_velocity = round(velocities.get(pid, 0.0), 2),
                peer_percentile   = round(percentile, 2),
            )

        return result

    def score_single(self, paper_id: str, graph_json: dict) -> Optional[LivingScore]:
        """Score a single paper. Returns None if paper_id not in graph."""
        nodes = graph_json.get("nodes", [])
        if not any(n["id"] == paper_id for n in nodes):
            return None
        all_scores = self.score_graph(graph_json)
        return all_scores.get(paper_id)
