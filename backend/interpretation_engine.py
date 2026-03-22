"""
backend/interpretation_engine.py
InterpretationEngine — Extracts statistics from graph data and generates
AI interpretations using Groq. Pre-computes numerical insights (Layer 1)
and constructs structured prompts for the LLM (Layer 2).

All statistical computation is done in Python (no LLM needed).
The LLM is only called for narrative interpretation of the statistics.
"""

import hashlib
import json
import logging
from collections import Counter

logger = logging.getLogger(__name__)


class InterpretationEngine:
    """Generates AI interpretations for graph containers."""

    # Category labels the LLM can use
    CATEGORIES = [
        "DOMINANT LINEAGE", "CROSS-POLLINATION", "SHALLOW ROOTS",
        "BOTTLENECK", "ORPHANED IDEA", "CONTRADICTION", "PARADIGM BRIDGE",
        "TEMPORAL GAP", "METHODOLOGY CLUSTER", "BLIND SPOT", "STRENGTH",
        "RISK", "OPPORTUNITY", "CONFIDENCE", "GAP", "FRAGILITY", "SCALE",
    ]

    def __init__(self, graph_data):
        """
        Args:
            graph_data: The full graph JSON dict (nodes, edges, metadata, etc.)
        """
        self.graph_data = graph_data
        self.nodes = graph_data.get("nodes", [])
        self.edges = graph_data.get("edges", [])
        self.metadata = graph_data.get("metadata", {})
        self.dna_profile = graph_data.get("dna_profile")
        self.diversity_score = graph_data.get("diversity_score")
        self.leaderboard = graph_data.get("leaderboard", [])

        # Derive seed_paper_year from nodes (not in metadata)
        seed_node = next((n for n in self.nodes if n.get("is_seed")), None)
        self.seed_paper_year = seed_node.get("year", "?") if seed_node else "?"

    # ═══════ STATISTICS EXTRACTION (Layer 1 — no LLM) ═══════

    def extract_graph_stats(self):
        """Extract key statistics from graph topology."""
        nodes = self.nodes
        total = len(nodes)
        if total == 0:
            return {}

        seed = next((n for n in nodes if n.get("is_seed")), None)
        bottlenecks = [n for n in nodes if n.get("is_bottleneck")]

        # Field distribution
        fields = Counter()
        for n in nodes:
            f = (n.get("fields_of_study") or ["Other"])[0]
            fields[f] += 1

        field_dist = [
            {"name": name, "count": count, "pct": round(count / total * 100, 1)}
            for name, count in fields.most_common()
        ]

        # Year distribution
        years = [n.get("year") for n in nodes if n.get("year")]
        year_buckets = Counter()
        for y in years:
            decade = f"{(y // 10) * 10}s"
            year_buckets[decade] += 1

        temporal_dist = []
        for decade in sorted(year_buckets.keys()):
            count = year_buckets[decade]
            temporal_dist.append({
                "label": decade,
                "count": count,
                "pct": round(count / total * 100, 1),
            })

        min_year = min(years) if years else None
        max_year = max(years) if years else None
        median_year = sorted(years)[len(years) // 2] if years else None

        # Citation stats
        citations = [n.get("citation_count", 0) for n in nodes]
        max_citations = max(citations) if citations else 0
        most_cited = next((n for n in nodes if n.get("citation_count") == max_citations), None)

        # Contradiction edges
        contradictions = [
            e for e in self.edges
            if e.get("mutation_type") == "contradiction"
        ]

        # Top bottleneck
        top_bottleneck = None
        if bottlenecks:
            top_bottleneck = max(bottlenecks, key=lambda n: n.get("pruning_impact", 0))

        return {
            "total_nodes": total,
            "total_edges": len(self.edges),
            "seed_title": seed.get("title") if seed else None,
            "seed_year": seed.get("year") if seed else None,
            "bottleneck_count": len(bottlenecks),
            "top_bottleneck": {
                "title": top_bottleneck.get("title"),
                "impact": top_bottleneck.get("pruning_impact", 0),
            } if top_bottleneck else None,
            "field_distribution": field_dist,
            "temporal_distribution": temporal_dist,
            "year_range": {"min": min_year, "max": max_year, "median": median_year},
            "most_cited": {
                "title": most_cited.get("title"),
                "citations": max_citations,
            } if most_cited else None,
            "contradiction_count": len(contradictions),
            "contradictions": [
                {
                    "source": self._find_node_title(e.get("source")),
                    "target": self._find_node_title(e.get("target")),
                }
                for e in contradictions[:3]  # Limit to top 3
            ],
        }

    def extract_dna_stats(self):
        """Extract DNA profile statistics."""
        dna = self.dna_profile
        if not dna or not dna.get("clusters"):
            return {}

        clusters = dna["clusters"]
        total_papers = sum(c.get("size", 0) for c in clusters)

        return {
            "clusters": [
                {
                    "name": c.get("name", "Unknown"),
                    "percentage": c.get("percentage", 0),
                    "size": c.get("size", 0),
                }
                for c in clusters
            ],
            "total_clusters": len(clusters),
            "concentration": sum(c.get("percentage", 0) for c in clusters[:3]),
        }

    def extract_diversity_stats(self):
        """Extract diversity score statistics."""
        div = self.diversity_score
        if not div:
            return {}

        scores = {
            "field_diversity": div.get("field_diversity", 0),
            "temporal_span": div.get("temporal_span", 0),
            "concept_diversity": div.get("concept_diversity", 0),
            "citation_entropy": div.get("citation_entropy", 0),
            "overall": div.get("overall", 0),
        }

        best = max(scores.items(), key=lambda x: x[1] if x[0] != "overall" else 0)
        worst = min(scores.items(), key=lambda x: x[1] if x[0] != "overall" else 100)

        return {
            "scores": scores,
            "best": {"name": best[0].replace("_", " ").title(), "value": best[1]},
            "worst": {"name": worst[0].replace("_", " ").title(), "value": worst[1]},
        }

    # ═══════ PROMPT CONSTRUCTION (Layer 2 — for LLM) ═══════

    def build_short_prompt(self, container_type):
        """Build a Groq prompt for short (3-finding) interpretation."""
        stats = self._get_stats_for_container(container_type)
        if not stats:
            return None

        container_roles = {
            "graph": "a network analyst studying citation graph topology",
            "dna": "an intellectual historian analyzing research ancestry composition",
            "diversity": "a research strategist evaluating intellectual breadth",
            "orphans": "an opportunity spotter identifying abandoned research ideas",
            "coverage": "a confidence auditor assessing data quality",
        }

        role = container_roles.get(container_type, "a research analyst")

        prompt = f"""You are {role}.

PAPER: "{self.metadata.get('seed_paper_title', 'Unknown')}" ({self.seed_paper_year})

DATA:
{json.dumps(stats, indent=2, default=str)}

Write exactly 3 findings as JSON. Each finding has:
- "category": one of {self.CATEGORIES}
- "text": one sentence with a specific number
- "ref": chart element this refers to (e.g. "cs_segment", "temporal_axis")
- "comparison": optional {{"thisValue": number, "avgValue": number, "thisLabel": "This paper", "avgLabel": "Field avg", "note": "Nx above/below average"}} — include ONLY for the most striking finding

Rules:
- No em dashes
- Reference specific paper names when available
- State findings as direct claims, no hedging
- Each finding must include a specific number or percentage

Return JSON only: {{"findings": [...]}}"""

        return prompt

    def build_detailed_prompt(self, container_type):
        """Build a Groq prompt for detailed interpretation."""
        stats = self._get_stats_for_container(container_type)
        if not stats:
            return None

        prompt = f"""You are a senior research analyst writing a detailed briefing.

PAPER: "{self.metadata.get('seed_paper_title', 'Unknown')}" ({self.seed_paper_year})

DATA:
{json.dumps(stats, indent=2, default=str)}

Write a detailed analysis as JSON with these sections:
- "key_takeaway": ONE sentence. The single most important finding.
- "findings": Array of 3-5 findings, each with:
  - "category": one of {self.CATEGORIES}
  - "confidence": float 0-1 (based on data coverage and certainty)
  - "text": 2-3 sentences with specific paper names and numbers
  - "ref": chart element reference
  - "comparison": optional {{"thisValue": number, "avgValue": number, "thisLabel": "This paper", "avgLabel": "Field avg", "note": "explanation"}}
- "unseen_connections": Array of 1-2 surprising patterns (strings)
- "opportunities": Array of 1-2 actionable research suggestions (strings)
- "temporal_distribution": Array of {{"label": "decade", "pct": number}} (compute from provided data)
- "contradictions": Array of {{"paper_a": "title", "year_a": year, "paper_b": "title", "year_b": year, "context": "explanation"}} (if any exist in the data)

Rules:
- No em dashes
- Reference specific paper names with (Author Year) format when available
- State findings as direct claims, never hedge
- Each finding must include specific numbers
- "unseen_connections" should be genuinely surprising, not obvious observations
- "opportunities" should be actionable research directions

Return JSON only."""

        return prompt

    def build_pruning_prompt(self, prune_data, level="short"):
        """Build a Groq prompt for pruning interpretation."""
        prompt = f"""You are a counterfactual historian. A researcher removed a paper from history.

PAPER REMOVED: "{prune_data.get('removed_title', 'Unknown')}" ({prune_data.get('removed_year', '?')})
RESULT:
- {prune_data.get('collapsed_count', 0)} papers collapsed ({prune_data.get('impact_percentage', 0):.1f}% of graph)
- {prune_data.get('survived_count', 0)} papers survived
- Total graph size: {prune_data.get('total_nodes', 0)} papers"""

        if level == "short":
            prompt += """

Write a single paragraph (3-4 sentences) explaining what this removal reveals.
Be specific. No em dashes. State claims directly.

Return JSON: {"short_text": "..."}"""
        else:
            prompt += """

Write a detailed counterfactual analysis as JSON:
- "key_takeaway": ONE sentence summary
- "findings": 3-4 findings with "category", "confidence", "text"
- "unseen_connections": 1-2 surprising patterns
- "opportunities": 1-2 research suggestions

Rules: No em dashes. Reference the specific paper removed. Be direct.

Return JSON only."""

        return prompt

    # ═══════ CACHE KEY GENERATION ═══════

    def cache_key(self, container_type, level):
        """Generate a cache key for the interpretation."""
        graph_id = self.metadata.get("graph_id", "unknown")
        raw = f"{graph_id}:{container_type}:{level}"
        return hashlib.sha256(raw.encode()).hexdigest()

    @staticmethod
    def prune_cache_key(graph_id, pruned_paper_ids, level="short"):
        """Generate a cache key for a pruning interpretation."""
        sorted_ids = sorted(pruned_paper_ids)
        raw = f"{graph_id}:prune:{','.join(sorted_ids)}:{level}"
        return hashlib.sha256(raw.encode()).hexdigest()

    # ═══════ HELPERS ═══════

    def _get_stats_for_container(self, container_type):
        """Get the right statistics for a container type."""
        if container_type == "graph":
            return self.extract_graph_stats()
        elif container_type == "dna":
            return self.extract_dna_stats()
        elif container_type == "diversity":
            return self.extract_diversity_stats()
        elif container_type in ("orphans", "coverage"):
            return self.extract_graph_stats()  # Use graph stats as context
        return None

    def _find_node_title(self, node_id_or_obj):
        """Find a node's title from its ID or object reference."""
        if isinstance(node_id_or_obj, dict):
            return node_id_or_obj.get("title", "Unknown")
        # It's a string ID
        for n in self.nodes:
            if n.get("id") == node_id_or_obj:
                return n.get("title", "Unknown")
        return "Unknown"
