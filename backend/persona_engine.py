"""
backend/persona_engine.py — PersonaEngine (F5.2)

Adjusts AI responses based on the user's chosen persona mode:
- explorer: balanced, curious, highlights connections
- critic: adversarial, finds weaknesses
- innovator: looks for gaps, opportunities, cross-domain links
- historian: traces intellectual lineage, emphasizes context

Written from scratch (v1 missing). Modifies system prompts for LLM calls.
"""
import logging

logger = logging.getLogger(__name__)

PERSONAS = {
    "explorer": {
        "name": "Explorer",
        "icon": "🔭",
        "description": "Balanced and curious — highlights connections between ideas.",
        "system_modifier": (
            "You are a curious research explorer. Highlight interesting connections "
            "between papers, surprising relationships, and how ideas build on each other. "
            "Be enthusiastic but accurate."
        ),
        "insight_focus": ["connections", "patterns", "building_blocks"],
    },
    "critic": {
        "name": "Critic",
        "icon": "🔍",
        "description": "Adversarial — finds weaknesses, gaps, and questionable claims.",
        "system_modifier": (
            "You are a tough peer reviewer. Focus on weaknesses in methodology, "
            "unsupported claims, missing citations, and potential flaws. Be constructive "
            "but unflinching in your analysis."
        ),
        "insight_focus": ["weaknesses", "gaps", "missing_citations"],
    },
    "innovator": {
        "name": "Innovator",
        "icon": "💡",
        "description": "Looks for gaps, opportunities, and cross-domain applications.",
        "system_modifier": (
            "You are a creative research strategist. Focus on research gaps, "
            "unexplored combinations of ideas, cross-domain applications, and "
            "opportunities for novel contributions. Think outside established paths."
        ),
        "insight_focus": ["opportunities", "cross_domain", "novel_combinations"],
    },
    "historian": {
        "name": "Historian",
        "icon": "📜",
        "description": "Traces intellectual lineage and emphasizes historical context.",
        "system_modifier": (
            "You are a science historian. Trace the intellectual lineage of ideas, "
            "emphasize how concepts evolved over time, note paradigm shifts, and "
            "place current work in deep historical context."
        ),
        "insight_focus": ["lineage", "evolution", "paradigm_shifts"],
    },
}


class PersonaEngine:
    """Modifies system prompts based on selected persona."""

    def get_persona(self, persona_mode: str) -> dict:
        """Get persona configuration. Falls back to explorer if unknown."""
        return PERSONAS.get(persona_mode, PERSONAS["explorer"])

    def modify_system_prompt(self, base_prompt: str, persona_mode: str) -> str:
        """Prepend persona modifier to a base system prompt."""
        persona = self.get_persona(persona_mode)
        modifier = persona["system_modifier"]
        return f"{modifier}\n\n{base_prompt}"

    def get_insight_focus(self, persona_mode: str) -> list:
        """Get the types of insights this persona prioritizes."""
        persona = self.get_persona(persona_mode)
        return persona.get("insight_focus", [])

    def list_personas(self) -> list:
        """Return all available personas for UI rendering."""
        return [
            {
                "mode": key,
                "name": p["name"],
                "icon": p["icon"],
                "description": p["description"],
            }
            for key, p in PERSONAS.items()
        ]

    def set_session_persona(self, session_id: str, persona_mode: str) -> bool:
        """Persist persona choice to session."""
        if persona_mode not in PERSONAS:
            return False
        try:
            import backend.db as db
            db.execute(
                "UPDATE sessions SET persona_mode = %s WHERE session_id = %s",
                (persona_mode, session_id),
            )
            return True
        except Exception as exc:
            logger.warning(f"Failed to set persona: {exc}")
            return False

    def set_user_default_persona(self, user_id: str, persona_mode: str) -> bool:
        """Set user's default persona preference."""
        if persona_mode not in PERSONAS:
            return False
        try:
            import backend.db as db
            db.execute(
                "UPDATE users SET default_persona = %s WHERE user_id = %s::uuid",
                (persona_mode, user_id),
            )
            return True
        except Exception as exc:
            logger.warning(f"Failed to set default persona: {exc}")
            return False

    def get_config(self, persona_mode: str) -> "PersonaConfig":
        """Get persona config as a serializable object. Used by /api/persona route."""
        persona = self.get_persona(persona_mode)
        return PersonaConfig(
            mode=persona_mode,
            name=persona["name"],
            icon=persona["icon"],
            description=persona["description"],
        )

    def filter_insights_for_mode(self, insights: list, mode: str) -> list:
        """Filter/reorder insight dicts by persona focus areas."""
        focus = self.get_insight_focus(mode)
        if not focus:
            return insights
        category_to_focus = {
            "bottleneck": "connections", "gap": "opportunities",
            "orphan": "gaps", "shadow": "weaknesses",
            "trend": "patterns", "opportunity": "novel_combinations",
        }
        boosted, rest = [], []
        for ins in insights:
            if category_to_focus.get(ins.get("category", ""), "") in focus:
                boosted.append(ins)
            else:
                rest.append(ins)
        return boosted + rest


class PersonaConfig:
    """Thin wrapper returned by PersonaEngine.get_config()."""
    def __init__(self, mode: str, name: str, icon: str, description: str):
        self.mode = mode
        self.name = name
        self.icon = icon
        self.description = description

    def to_dict(self) -> dict:
        return {
            "mode": self.mode,
            "name": self.name,
            "icon": self.icon,
            "description": self.description,
        }
