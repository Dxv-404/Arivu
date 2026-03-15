"""
backend/paradigm_detector.py

ParadigmShiftDetector: identifies structural signals of intellectual revolution
in a research graph.

Signals (from spec F1.13):
  1. CONTRADICTION_SURGE    — rising rate of papers contradicting bottleneck nodes
  2. CROSS_DOMAIN_INFLUX    — accelerating cross-field citation activity
  3. VOCABULARY_FRAGMENTATION — new mutation types appearing at cluster edges
  4. CLUSTER_FRAGMENTATION  — DNA clusters splitting (diversity increasing rapidly)

Paradigm stability score 0-100. Alert (score < 30) when multiple signals present.

Does NOT call NLP worker. Uses graph JSON structure + mutation_type edge metadata.
Requires coverage_score >= 0.65 for reliable results.
"""
import logging
import math
from dataclasses import dataclass
from typing import Optional
from collections import Counter, defaultdict

logger = logging.getLogger(__name__)

COVERAGE_THRESHOLD  = 0.65
ALERT_THRESHOLD     = 30
CONTRADICTION_ALERT = 0.15


@dataclass
class ParadigmShiftSignal:
    signal_type: str
    strength:    float
    description: str
    confidence:  str
    evidence:    dict

    def to_dict(self) -> dict:
        return {
            "signal_type": self.signal_type,
            "strength":    round(self.strength, 3),
            "description": self.description,
            "confidence":  self.confidence,
            "evidence":    self.evidence,
        }


@dataclass
class ParadigmAnalysis:
    seed_paper_id:   str
    stability_score: float
    alert:           bool
    signals:         list
    coverage_ok:     bool
    summary:         str

    def to_dict(self) -> dict:
        return {
            "seed_paper_id":   self.seed_paper_id,
            "stability_score": round(self.stability_score, 1),
            "alert":           self.alert,
            "signals":         [s.to_dict() for s in self.signals],
            "coverage_ok":     self.coverage_ok,
            "summary":         self.summary,
        }


class ParadigmShiftDetector:
    """Stateless detector — instantiate fresh per call."""

    def detect(self, graph_json: dict, coverage_score: float = 0.0) -> ParadigmAnalysis:
        seed_id     = graph_json.get("metadata", {}).get("seed_paper_id", "unknown")
        nodes       = graph_json.get("nodes", [])
        edges       = graph_json.get("edges", [])
        coverage_ok = coverage_score >= COVERAGE_THRESHOLD

        if not edges or len(nodes) < 10:
            return ParadigmAnalysis(
                seed_paper_id=seed_id, stability_score=100.0, alert=False,
                signals=[], coverage_ok=coverage_ok,
                summary="Graph too small for paradigm analysis (requires >= 10 nodes).",
            )

        signals     = []
        nodes_by_id = {n["id"]: n for n in nodes}
        total_edges = len(edges)

        # -- Signal 1: Contradiction Surge --
        contradiction_edges = [e for e in edges if e.get("mutation_type") == "contradiction"]
        contradiction_rate  = len(contradiction_edges) / max(total_edges, 1)
        if contradiction_rate >= CONTRADICTION_ALERT:
            strength = min(1.0, contradiction_rate / 0.3)
            signals.append(ParadigmShiftSignal(
                signal_type="CONTRADICTION_SURGE",
                strength=strength,
                description=(
                    f"{len(contradiction_edges)} edges ({contradiction_rate:.0%}) "
                    f"represent papers contradicting their ancestors."
                ),
                confidence="high" if coverage_ok else "medium",
                evidence={
                    "contradiction_edges": len(contradiction_edges),
                    "total_edges": total_edges,
                    "rate": round(contradiction_rate, 3),
                },
            ))

        # -- Signal 2: Cross-Domain Influx --
        cross_domain = 0
        for edge in edges:
            src_fields = set(nodes_by_id.get(edge.get("source", ""), {}).get("fields_of_study", []))
            tgt_fields = set(nodes_by_id.get(edge.get("target", ""), {}).get("fields_of_study", []))
            if src_fields and tgt_fields and not src_fields.intersection(tgt_fields):
                cross_domain += 1
        cross_rate = cross_domain / max(total_edges, 1)
        if cross_rate >= 0.20:
            strength = min(1.0, cross_rate / 0.40)
            signals.append(ParadigmShiftSignal(
                signal_type="CROSS_DOMAIN_INFLUX",
                strength=strength,
                description=(
                    f"{cross_domain} cross-domain citations ({cross_rate:.0%} of edges). "
                    f"Ideas are flowing in from outside the field."
                ),
                confidence="medium",
                evidence={"cross_domain_edges": cross_domain, "total_edges": total_edges, "rate": round(cross_rate, 3)},
            ))

        # -- Signal 3: Vocabulary Fragmentation --
        years = [n.get("year") for n in nodes if n.get("year")]
        if years:
            median_year    = sorted(years)[len(years) // 2]
            recent_node_ids = {n["id"] for n in nodes if (n.get("year") or 0) >= median_year}
            recent_edges   = [e for e in edges if (e.get("source", "") in recent_node_ids or e.get("target", "") in recent_node_ids)]
            old_edges      = [e for e in edges if e not in recent_edges]

            def entropy(edges_list):
                counts = Counter(e.get("mutation_type", "unknown") for e in edges_list)
                total  = sum(counts.values())
                if total == 0:
                    return 0.0
                return -sum((c / total) * math.log2(c / total) for c in counts.values() if c > 0)

            fragmentation = entropy(recent_edges) - entropy(old_edges)
            if fragmentation >= 0.5:
                strength = min(1.0, fragmentation / 1.5)
                signals.append(ParadigmShiftSignal(
                    signal_type="VOCABULARY_FRAGMENTATION",
                    strength=strength,
                    description=(
                        f"Recent papers show more diverse mutation types (entropy +{fragmentation:.2f}). "
                        f"The field's conceptual vocabulary is fragmenting."
                    ),
                    confidence="medium" if coverage_ok else "low",
                    evidence={"delta": round(fragmentation, 3)},
                ))

        # -- Signal 4: Cluster Fragmentation --
        dna = graph_json.get("dna_profile")
        if dna and isinstance(dna, dict):
            clusters  = dna.get("clusters", [])
            n_clusters = len(clusters)
            if n_clusters >= 5:
                sizes    = [len(c.get("papers", [])) for c in clusters]
                max_size = max(sizes) if sizes else 0
                avg_size = sum(sizes) / len(sizes) if sizes else 0
                if max_size > 0:
                    concentration = avg_size / max_size
                    if concentration >= 0.5:
                        signals.append(ParadigmShiftSignal(
                            signal_type="CLUSTER_FRAGMENTATION",
                            strength=min(1.0, concentration),
                            description=(
                                f"{n_clusters} concept clusters with no dominant theme "
                                f"(avg/max ratio: {concentration:.2f})."
                            ),
                            confidence="medium",
                            evidence={"n_clusters": n_clusters, "concentration": round(concentration, 3)},
                        ))

        # -- Composite stability score --
        if not signals:
            stability = 100.0
        else:
            total_strength = sum(s.strength for s in signals)
            instability    = (total_strength / len(signals)) * 70
            stability      = max(0.0, 100.0 - instability)

        if stability >= 70:
            summary = "Field appears structurally stable. No significant paradigm shift signals."
        elif stability >= 40:
            n = len(signals)
            summary = f"{n} signal{'s' if n > 1 else ''} detected. Field shows signs of intellectual tension."
        else:
            summary = (
                f"ALERT: stability score {stability:.0f} — multiple paradigm shift signals. "
                f"This field may be undergoing structural intellectual change."
            )

        return ParadigmAnalysis(
            seed_paper_id=seed_id,
            stability_score=round(stability, 1),
            alert=stability < ALERT_THRESHOLD,
            signals=signals,
            coverage_ok=coverage_ok,
            summary=summary,
        )
