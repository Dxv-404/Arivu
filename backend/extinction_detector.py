"""
backend/extinction_detector.py — ExtinctionEventDetector (F1.6)

Research threads that died from paradigm shift or abandonment.
Does NOT call NLP worker — uses graph structure + year data only.
"""
import logging
from dataclasses import dataclass
from collections import defaultdict

logger = logging.getLogger(__name__)

MINIMUM_CLUSTER_SIZE = 3
EXTINCTION_WINDOW    = 5
NEAR_ZERO_THRESHOLD  = 0.1


@dataclass
class ExtinctionEvent:
    cluster_papers:     list
    cluster_label:      str
    peak_year:          int
    end_year:           int
    peak_citation_rate: float
    cause:              str
    notes:              str

    def to_dict(self) -> dict:
        return {
            "cluster_papers":     self.cluster_papers,
            "cluster_label":      self.cluster_label,
            "peak_year":          self.peak_year,
            "end_year":           self.end_year,
            "peak_citation_rate": round(self.peak_citation_rate, 2),
            "cause":              self.cause,
            "notes":              self.notes,
        }


class ExtinctionEventDetector:

    def detect(self, graph_json: dict) -> list:
        nodes = graph_json.get("nodes", [])
        edges = graph_json.get("edges", [])

        if len(nodes) < MINIMUM_CLUSTER_SIZE * 2:
            return []

        clusters: dict = defaultdict(list)
        node_by_id     = {n["id"]: n for n in nodes}

        for node in nodes:
            fields  = node.get("fields_of_study") or ["unknown"]
            primary = fields[0] if fields else "unknown"
            clusters[primary].append(node)

        results = []
        for cluster_label, cluster_nodes in clusters.items():
            if len(cluster_nodes) < MINIMUM_CLUSTER_SIZE:
                continue

            years = sorted({n.get("year") for n in cluster_nodes if n.get("year")})
            if len(years) < 3:
                continue

            paper_ids_in_cluster = {n["id"] for n in cluster_nodes}
            citing_by_year: dict = defaultdict(int)

            for edge in edges:
                src = edge.get("source") or edge.get("citing_paper_id", "")
                tgt = edge.get("target") or edge.get("cited_paper_id", "")
                if tgt in paper_ids_in_cluster and src not in paper_ids_in_cluster:
                    src_year = node_by_id.get(src, {}).get("year")
                    if src_year:
                        citing_by_year[src_year] += 1

            if not citing_by_year:
                continue

            all_cite_years = sorted(citing_by_year.keys())
            if len(all_cite_years) < 3:
                continue

            peak_rate = max(citing_by_year.values())
            peak_year = max(citing_by_year, key=citing_by_year.get)
            post_peak = [y for y in all_cite_years if y > peak_year]
            if len(post_peak) < EXTINCTION_WINDOW:
                continue

            window_rates = [citing_by_year.get(y, 0) for y in post_peak[:EXTINCTION_WINDOW]]
            if max(window_rates) > NEAR_ZERO_THRESHOLD * peak_rate:
                continue

            paradigm_events = graph_json.get("paradigm_data", {}).get("shift_events", [])
            cause = "unknown"
            for pe in paradigm_events:
                if abs(pe.get("year", 0) - peak_year) <= 3:
                    cause = "paradigm_shift"
                    break
            if cause == "unknown":
                cause = "abandoned"

            end_year = post_peak[0]
            results.append(ExtinctionEvent(
                cluster_papers=list(paper_ids_in_cluster),
                cluster_label=cluster_label,
                peak_year=peak_year,
                end_year=end_year,
                peak_citation_rate=peak_rate,
                cause=cause,
                notes=(
                    f"The {cluster_label} cluster peaked around {peak_year} "
                    f"with {peak_rate:.0f} incoming citations, then fell to near-zero "
                    f"by {end_year}. Likely cause: {cause.replace('_', ' ')}."
                ),
            ).to_dict())

        return sorted(results, key=lambda x: x["peak_year"])
