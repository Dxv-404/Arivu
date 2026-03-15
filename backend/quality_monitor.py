"""
backend/quality_monitor.py

ProductionQualityMonitor: Computes proxy quality metrics for any graph JSON.
Does NOT require ground truth. Uses structural signals to detect common failures.

Used by:
  - GET /api/quality (per-session quality check)
  - scripts/verify_deployment.py (post-deploy smoke test)
"""
import logging
import math
import time
from collections import Counter

logger = logging.getLogger(__name__)


class ProductionQualityMonitor:
    """Stateless quality analysis — pass graph_json directly to each method."""

    def analyze_graph_quality(self, graph_json: dict) -> dict:
        """
        Compute quality metrics for a graph.

        Returns:
            {
                "quality_score": float,   # 0.0–1.0
                "metrics": dict,
                "issues": list[str],
                "timestamp": float,
            }
        """
        edges = graph_json.get("edges", [])
        nodes = graph_json.get("nodes", [])

        if not edges:
            return {
                "quality_score": 0.0,
                "metrics": {},
                "issues": ["No edges in graph — graph may be empty or failed to build"],
                "timestamp": time.time(),
            }

        issues = []
        metrics = {}

        # ── 1. Similarity score distribution ──────────────────────
        similarities = [e["similarity_score"] for e in edges
                        if e.get("similarity_score") is not None]
        if similarities:
            metrics["similarity_mean"] = round(sum(similarities) / len(similarities), 3)
            variance = sum((x - metrics["similarity_mean"]) ** 2
                          for x in similarities) / len(similarities)
            metrics["similarity_std"] = round(math.sqrt(variance), 3)

            if metrics["similarity_std"] < 0.05:
                issues.append(
                    f"SIMILARITY_LOW_VARIANCE: std={metrics['similarity_std']:.3f} "
                    "— possible model or pipeline issue"
                )
            metrics["similarity_bimodal"] = self._is_bimodal(similarities)

        # ── 2. Mutation type variety ───────────────────────────────
        mutation_types = [e.get("mutation_type", "unknown") for e in edges]
        type_counts = Counter(mutation_types)
        n_types = sum(1 for t, c in type_counts.items() if c > 0 and t != "unknown")
        metrics["mutation_type_variety"] = n_types
        metrics["mutation_type_entropy"] = round(self._entropy(list(type_counts.values())), 3)

        if metrics["mutation_type_entropy"] < 0.8:
            issues.append(
                f"LOW_MUTATION_VARIETY: {n_types} types, "
                f"entropy={metrics['mutation_type_entropy']:.2f}"
            )

        incidental_rate = type_counts.get("incidental", 0) / max(len(mutation_types), 1)
        metrics["incidental_rate"] = round(incidental_rate, 3)
        if incidental_rate > 0.8:
            issues.append(
                f"HIGH_INCIDENTAL_RATE: {incidental_rate:.0%} edges are 'incidental'"
            )

        # ── 3. Confidence score distribution ──────────────────────
        # Field names: export_to_json() uses base_confidence (from EdgeAnalysis dataclass).
        # Also accept mutation_confidence and final_confidence for forward compatibility.
        confidences = [
            e.get("base_confidence")
            or e.get("mutation_confidence")
            or e.get("final_confidence")
            or 0
            for e in edges
        ]
        if confidences:
            low_conf = [c for c in confidences if c < 0.4]
            metrics["low_confidence_rate"] = round(len(low_conf) / len(confidences), 3)
            if metrics["low_confidence_rate"] > 0.6:
                issues.append(
                    f"HIGH_LOW_CONFIDENCE: {metrics['low_confidence_rate']:.0%} "
                    "edges have confidence < 0.4"
                )

        # ── 4. Graph structure sanity ──────────────────────────────
        metrics["node_count"] = len(nodes)
        metrics["edge_count"] = len(edges)
        if nodes:
            edge_density = len(edges) / len(nodes)
            metrics["edge_density"] = round(edge_density, 2)
            if edge_density < 0.5:
                issues.append(f"LOW_EDGE_DENSITY: {edge_density:.1f} edges/node")

        # ── 5. Abstract coverage ───────────────────────────────────
        nodes_with_abstract = sum(
            1 for n in nodes if n.get("abstract") or n.get("text_tier", 4) < 4
        )
        if nodes:
            metrics["abstract_coverage"] = round(nodes_with_abstract / len(nodes), 3)
            if metrics["abstract_coverage"] < 0.6:
                issues.append(
                    f"LOW_ABSTRACT_COVERAGE: {metrics['abstract_coverage']:.0%} "
                    "nodes have abstracts"
                )

        quality_score = max(0.0, 1.0 - len(issues) * 0.2)
        return {
            "quality_score": round(quality_score, 2),
            "metrics":       metrics,
            "issues":        issues,
            "timestamp":     time.time(),
        }

    def check_thresholds(self, result: dict) -> list[str]:
        """Return alertable threshold violations. Empty list = healthy."""
        alerts = []
        m = result.get("metrics", {})
        if m.get("abstract_coverage", 1.0) < 0.5:
            alerts.append(f"abstract_coverage={m['abstract_coverage']:.0%} below 50%")
        if m.get("low_confidence_rate", 0) > 0.7:
            alerts.append(f"low_confidence_rate={m['low_confidence_rate']:.0%} above 70%")
        if m.get("incidental_rate", 0) > 0.85:
            alerts.append(f"incidental_rate={m['incidental_rate']:.0%} above 85%")
        if result.get("quality_score", 1.0) < 0.4:
            alerts.append(f"quality_score={result['quality_score']} below 0.4")
        return alerts

    def _is_bimodal(self, values: list) -> bool:
        if len(values) < 10:
            return False
        low  = sum(v < 0.35 for v in values)
        high = sum(v > 0.65 for v in values)
        mid  = len(values) - low - high
        return (low + high) > mid and low >= 3 and high >= 3

    def _entropy(self, counts: list) -> float:
        total = sum(counts)
        if total == 0:
            return 0.0
        result = 0.0
        for c in counts:
            if c > 0:
                p = c / total
                result -= p * math.log2(p)
        return result
