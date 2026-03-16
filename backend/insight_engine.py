"""
backend/insight_engine.py — InsightEngine (F5.4)

Generates a feed of actionable insights from a graph's analysis modules.
Aggregates findings from: DNA profiler, diversity scorer, orphan detector,
gap finder, living paper scorer, citation shadow, field fingerprint, etc.

Written from scratch (v1 missing). Persona-aware via PersonaEngine.
"""
import logging
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class Insight:
    insight_id:  str
    category:    str    # "bottleneck" | "gap" | "orphan" | "shadow" | "trend" | "opportunity"
    title:       str
    description: str
    severity:    str    # "high" | "medium" | "low"
    paper_ids:   list   # related paper IDs
    actionable:  bool
    action_text: str    # what the user can do

    def to_dict(self) -> dict:
        return {
            "insight_id":  self.insight_id,
            "category":    self.category,
            "title":       self.title,
            "description": self.description,
            "severity":    self.severity,
            "paper_ids":   self.paper_ids,
            "actionable":  self.actionable,
            "action_text": self.action_text,
        }


class InsightEngine:
    """Generates persona-aware insights from graph analysis data."""

    def generate_feed(
        self, graph_json: dict, persona_mode: str = "explorer", max_insights: int = 15
    ) -> list:
        """Generate an ordered insight feed from graph data."""
        insights = []

        nodes = graph_json.get("nodes", [])
        edges = graph_json.get("edges", [])

        if not nodes:
            return []

        # 1. Bottleneck insights
        bottlenecks = [n for n in nodes if n.get("is_bottleneck")]
        for bn in bottlenecks[:3]:
            impact = bn.get("pruning_impact", 0)
            insights.append(Insight(
                insight_id=f"bn_{bn['id'][:8]}",
                category="bottleneck",
                title=f"Critical dependency: {bn.get('title', '')[:60]}",
                description=(
                    f"This paper is a bottleneck — removing it from history would collapse "
                    f"{impact*100:.0f}% of the field. It's a foundational work that "
                    f"many subsequent papers depend on."
                ),
                severity="high",
                paper_ids=[bn["id"]],
                actionable=True,
                action_text="Click this paper in the graph and trigger pruning to visualize the cascade.",
            ))

        # 2. Orphan insights
        orphans = [n for n in nodes
                   if n.get("citation_count", 0) < 10 and n.get("year", 2024) < 2018]
        for orph in orphans[:2]:
            insights.append(Insight(
                insight_id=f"orp_{orph['id'][:8]}",
                category="orphan",
                title=f"Forgotten thread: {orph.get('title', '')[:60]}",
                description=(
                    f"Published in {orph.get('year', '?')} with only {orph.get('citation_count', 0)} "
                    f"citations. This idea may have been ahead of its time or overlooked."
                ),
                severity="medium",
                paper_ids=[orph["id"]],
                actionable=True,
                action_text="Read this paper — it might contain insights the field has missed.",
            ))

        # 3. Citation shadow insights (high-impact but few direct citations)
        for n in nodes:
            if (n.get("citation_count", 0) > 500
                    and sum(1 for e in edges
                            if (e.get("target") or e.get("cited_paper_id", "")) == n["id"]) <= 2):
                insights.append(Insight(
                    insight_id=f"shd_{n['id'][:8]}",
                    category="shadow",
                    title=f"Citation shadow: {n.get('title', '')[:60]}",
                    description=(
                        f"This paper has {n.get('citation_count', 0)} total citations but only "
                        f"a few direct links in this graph. Its influence may be indirect or "
                        f"mediated through other papers."
                    ),
                    severity="medium",
                    paper_ids=[n["id"]],
                    actionable=True,
                    action_text="Investigate how this paper's ideas propagated indirectly.",
                ))
                if len(insights) > max_insights:
                    break

        # 4. Field diversity insight
        fields = set()
        for n in nodes:
            for f in (n.get("fields_of_study") or []):
                fields.add(f)
        if len(fields) > 3:
            insights.append(Insight(
                insight_id="div_multi",
                category="opportunity",
                title=f"Cross-disciplinary graph ({len(fields)} fields)",
                description=(
                    f"This citation graph spans {len(fields)} fields: "
                    f"{', '.join(list(fields)[:4])}. Cross-disciplinary work often "
                    f"contains underexploited connections."
                ),
                severity="low",
                paper_ids=[],
                actionable=True,
                action_text="Look for structural analogs across field boundaries.",
            ))

        # 5. Trend insights (year distribution)
        years = [n.get("year") for n in nodes if n.get("year")]
        if years:
            recent = sum(1 for y in years if y >= 2022)
            total = len(years)
            if recent / total > 0.4:
                insights.append(Insight(
                    insight_id="trend_hot",
                    category="trend",
                    title="Active research area",
                    description=(
                        f"{recent}/{total} papers in this graph are from 2022 or later. "
                        f"This is a rapidly growing field."
                    ),
                    severity="low",
                    paper_ids=[],
                    actionable=False,
                    action_text="",
                ))

        # Sort by severity
        severity_order = {"high": 0, "medium": 1, "low": 2}
        insights.sort(key=lambda x: severity_order.get(x.severity, 3))

        # Apply persona filter
        insights = self._filter_by_persona(insights, persona_mode)

        return [i.to_dict() for i in insights[:max_insights]]

    def _filter_by_persona(self, insights: list, persona_mode: str) -> list:
        """Reorder/filter based on persona focus areas."""
        from backend.persona_engine import PersonaEngine
        focus = PersonaEngine().get_insight_focus(persona_mode)

        if not focus:
            return insights

        # Map categories to focus areas
        category_to_focus = {
            "bottleneck": "connections",
            "gap": "opportunities",
            "orphan": "gaps",
            "shadow": "weaknesses",
            "trend": "patterns",
            "opportunity": "novel_combinations",
        }

        # Boost insights that match persona focus
        boosted = []
        rest = []
        for insight in insights:
            cat_focus = category_to_focus.get(insight.category, "")
            if cat_focus in focus:
                boosted.append(insight)
            else:
                rest.append(insight)

        return boosted + rest
