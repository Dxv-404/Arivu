"""
backend/field_fingerprint.py — FieldFingerprintAnalyzer
Five-dimension structural profile of a research field. All scores 0-1 for radar chart.
"""
import logging
from dataclasses import dataclass
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


@dataclass
class FieldFingerprint:
    seed_paper_id:            str
    bottleneck_concentration: float
    cross_domain_rate:        float
    idea_velocity:            float
    paradigm_fragility:       float
    temporal_depth:           float
    summary:                  str

    def to_dict(self) -> dict:
        return {
            "seed_paper_id": self.seed_paper_id,
            "dimensions": {
                "bottleneck_concentration": round(self.bottleneck_concentration, 3),
                "cross_domain_rate":        round(self.cross_domain_rate, 3),
                "idea_velocity":            round(self.idea_velocity, 3),
                "paradigm_fragility":       round(self.paradigm_fragility, 3),
                "temporal_depth":           round(self.temporal_depth, 3),
            },
            "radar_labels": [
                "Bottleneck Concentration", "Cross-Domain Influx",
                "Idea Velocity", "Paradigm Fragility", "Temporal Depth",
            ],
            "summary": self.summary,
        }


class FieldFingerprintAnalyzer:
    def analyze(self, graph_json: dict) -> FieldFingerprint:
        nodes   = graph_json.get("nodes", [])
        edges   = graph_json.get("edges", [])
        seed_id = graph_json.get("metadata", {}).get("seed_paper_id", "unknown")

        if not nodes:
            return FieldFingerprint(
                seed_paper_id=seed_id,
                bottleneck_concentration=0.0, cross_domain_rate=0.0,
                idea_velocity=0.0, paradigm_fragility=0.0, temporal_depth=0.0,
                summary="Graph is empty — no fingerprint available.",
            )

        node_by_id = {n["id"]: n for n in nodes}

        bottleneck_count         = sum(1 for n in nodes if n.get("is_bottleneck"))
        bottleneck_concentration = min(1.0, (bottleneck_count / max(len(nodes), 1)) / 0.2)

        cross_domain = sum(
            1 for edge in edges
            if (set(node_by_id.get(edge.get("source", ""), {}).get("fields_of_study", [])) and
                set(node_by_id.get(edge.get("target", ""), {}).get("fields_of_study", [])) and
                not set(node_by_id.get(edge.get("source", ""), {}).get("fields_of_study", [])).intersection(
                    set(node_by_id.get(edge.get("target", ""), {}).get("fields_of_study", []))
                ))
        )
        cross_domain_rate = cross_domain / max(len(edges), 1)

        current_year = datetime.now(timezone.utc).year
        velocities   = []
        for node in nodes:
            year = node.get("year")
            cit  = node.get("citation_count", 0) or 0
            if year and year > 1990 and cit > 0:
                velocities.append(cit / max(1, current_year - year))
        idea_velocity = min(1.0, (sum(velocities) / len(velocities)) / 100.0) if velocities else 0.0

        impacts           = [n.get("pruning_impact", 0) or 0 for n in nodes]
        paradigm_fragility = min(1.0, max(impacts) / 0.40) if impacts else 0.0

        years = [n.get("year") for n in nodes if n.get("year")]
        temporal_depth = min(1.0, (current_year - min(years)) / 50.0) if len(years) >= 2 else 0.0

        parts = []
        if bottleneck_concentration > 0.6:
            parts.append("Cathedral-like structure with strong bottleneck nodes")
        elif bottleneck_concentration < 0.2:
            parts.append("Bazaar-like structure with distributed intellectual foundations")
        if cross_domain_rate > 0.3:
            parts.append(f"highly interdisciplinary ({cross_domain_rate:.0%} cross-domain citations)")
        elif cross_domain_rate < 0.1:
            parts.append("insular field (low cross-domain citation rate)")
        if idea_velocity > 0.6:
            parts.append("fast-moving research area")
        elif idea_velocity < 0.2:
            parts.append("slow-accumulation field")
        summary = (". ".join(parts).capitalize() + "." if parts else
                   "Moderate structural profile — no extreme characteristics detected.")

        return FieldFingerprint(
            seed_paper_id=seed_id,
            bottleneck_concentration=bottleneck_concentration,
            cross_domain_rate=cross_domain_rate,
            idea_velocity=idea_velocity,
            paradigm_fragility=paradigm_fragility,
            temporal_depth=temporal_depth,
            summary=summary,
        )
