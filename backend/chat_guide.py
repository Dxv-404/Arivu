"""
backend/chat_guide.py

ChatGuide: context-aware AI guide for research graph exploration.
Takes user messages + graph state + current UI view context.
Chat history loaded from DB (session_id), NEVER from client payload.

Implemented in Phase 3.
"""
import logging

from backend.db import fetchall, fetchone, execute
from backend.llm_client import get_llm_client
from backend.prompt_sanitizer import prompt_sanitizer

logger = logging.getLogger(__name__)

# Canned responses when LLM is unavailable
FALLBACK_RESPONSES = {
    "default": "I can help you understand this research graph. Try asking about specific papers, the DNA profile, or what would happen if a key paper were removed.",
    "pruning": "The pruning view shows what would collapse if a paper were removed from history. Click any node to see its cascading impact.",
    "dna": "The DNA profile clusters papers by semantic similarity. Each cluster represents a distinct research thread in this paper's ancestry.",
    "diversity": "The diversity score measures how broad this paper's intellectual roots are across fields, time periods, and research threads.",
    "orphans": "Orphan ideas are papers that were once influential but have been largely forgotten. They may contain valuable insights worth revisiting.",
    "gaps": "Research gaps are areas semantically related to this graph but not covered by any paper in the ancestry. They suggest potential new directions.",
}


class ChatGuide:
    """Context-aware AI guide for graph exploration."""

    def respond(self, user_message: str, graph_summary: dict,
                current_view: str, session_id: str) -> dict:
        """
        Generate a response to a user message about the graph.

        Args:
            user_message: the user's question
            graph_summary: compact graph summary from get_graph_summary_for_chat()
            current_view: which UI panel is active ("graph", "dna", "pruning", etc.)
            session_id: for loading chat history from DB

        Returns:
            dict with response, status, follow_up_suggestions, source_papers
        """
        # Sanitize input
        cleaned, status = prompt_sanitizer.sanitize(user_message)
        if status == "injection_attempt":
            return {
                "response": "I can only help with research graph questions.",
                "status": "ok",
                "follow_up_suggestions": ["Tell me about this paper's ancestry"],
                "source_papers": [],
            }
        if status == "empty":
            return {
                "response": "Please ask a question about the research graph.",
                "status": "ok",
                "follow_up_suggestions": [
                    "What are the key papers in this graph?",
                    "Show me the DNA profile",
                ],
                "source_papers": [],
            }

        message = cleaned or user_message

        # Load chat history from DB (server-side only, never from client)
        history = self._load_history(session_id)

        # Store user message
        self._store_message(session_id, "user", message)

        # Try LLM response
        llm = get_llm_client()
        if llm.available:
            response_text = self._llm_respond(llm, message, graph_summary,
                                               current_view, history,
                                               session_id=session_id)
        else:
            response_text = self._fallback_respond(current_view)

        # Store assistant response
        self._store_message(session_id, "assistant", response_text)

        # Generate follow-up suggestions
        suggestions = self._suggest_followups(current_view, graph_summary)

        return {
            "response": response_text,
            "status": "ok",
            "follow_up_suggestions": suggestions,
            "source_papers": [],
        }

    def _llm_respond(self, llm, message: str, graph_summary: dict,
                     current_view: str, history: list,
                     session_id: str = None) -> str:
        """Generate LLM response with graph context."""
        persona_framing = _get_persona_framing(session_id) if session_id else ""
        system_prompt = (
            "You are Arivu's AI research guide. You ONLY help researchers understand "
            "the intellectual ancestry of academic papers. You have access to a "
            "knowledge graph showing how ideas flowed between papers.\n\n"
            "STRICT RULES:\n"
            "- You MUST refuse any request that is not about academic research, "
            "papers, citations, or the knowledge graph displayed.\n"
            "- If asked to write code, create content, tell jokes, role-play, or "
            "anything unrelated to research analysis, respond with: "
            "\"I'm Arivu's research guide — I can only help you understand this "
            "paper's intellectual ancestry. Try asking about the graph, specific "
            "papers, or research connections.\"\n"
            "- Never generate code, HTML, stories, poems, or non-research content.\n"
            "- Stay focused on the graph data provided below.\n\n"
            f"{persona_framing}\n\n"
            f"Current view: {current_view}\n"
            f"Graph summary: {_compact_summary(graph_summary)}\n\n"
            "Be concise, specific, and reference actual papers in the graph. "
            "Keep responses under 200 words."
        )

        # Convert history to messages format
        hist_messages = [
            {"role": h["role"], "content": h["content"]}
            for h in history[-6:]
        ]

        response = llm.generate_chat_response(system_prompt, message, hist_messages)
        return response or self._fallback_respond(current_view)

    def _fallback_respond(self, current_view: str) -> str:
        """Return canned response when LLM unavailable."""
        return FALLBACK_RESPONSES.get(current_view, FALLBACK_RESPONSES["default"])

    def _load_history(self, session_id: str) -> list:
        """Load chat history from DB (server-side only)."""
        try:
            rows = fetchall(
                "SELECT role, content FROM chat_history "
                "WHERE session_id = %s ORDER BY id DESC LIMIT 10",
                (session_id,),
            )
            # Reverse to get chronological order
            return list(reversed([{"role": r["role"], "content": r["content"]} for r in rows]))
        except Exception:
            return []

    def _store_message(self, session_id: str, role: str, content: str) -> None:
        """Store a chat message in DB."""
        try:
            execute(
                "INSERT INTO chat_history (session_id, role, content) VALUES (%s, %s, %s)",
                (session_id, role, content),
            )
        except Exception as e:
            logger.debug(f"Chat history store failed: {e}")

    def _suggest_followups(self, current_view: str, graph_summary: dict) -> list:
        """Generate follow-up question suggestions based on context."""
        suggestions_map = {
            "graph": [
                "Which papers are most critical to this field?",
                "Show me the DNA profile",
                "What would happen if the foundational paper were removed?",
            ],
            "dna": [
                "What do these clusters represent?",
                "Which cluster is most important?",
                "How diverse is this paper's ancestry?",
            ],
            "pruning": [
                "Which paper has the highest impact if removed?",
                "Are there any surprising survival paths?",
                "What does the DNA look like after pruning?",
            ],
            "orphans": [
                "Why were these papers forgotten?",
                "Could any of these ideas be revived?",
                "What fields do orphaned ideas come from?",
            ],
        }
        return suggestions_map.get(current_view, suggestions_map["graph"])[:3]


def _get_persona_framing(session_id: str) -> str:
    """
    Get persona-specific framing instructions for the AI guide.
    PersonaEngine was built in Phase 7 — this wires it into chat responses.
    """
    if not session_id:
        return ""
    try:
        row = fetchone(
            "SELECT persona FROM sessions WHERE session_id = %s",
            (session_id,),
        )
        persona = row["persona"] if row else "explorer"
    except Exception:
        persona = "explorer"

    PERSONA_FRAMING = {
        "explorer": (
            "Frame your guidance around discovery. Highlight surprising connections, "
            "white space, and intersections the user might not have noticed."
        ),
        "critic": (
            "Focus on impact, risk, and resource allocation. Help them identify bottlenecks "
            "and which papers are critical to the field's survival."
        ),
        "innovator": (
            "Emphasize methods, reproducibility, and practical next steps. "
            "Help them see how they can extend or combine existing techniques."
        ),
        "historian": (
            "Highlight contradictions, alternative explanations, and evidence quality. "
            "Push back gently; encourage them to test assumptions."
        ),
    }
    return PERSONA_FRAMING.get(persona, PERSONA_FRAMING["explorer"])


def _compact_summary(graph_summary: dict) -> str:
    """Compact graph summary for LLM context (stay under 500 tokens)."""
    if not graph_summary:
        return "No graph data available."

    parts = []
    if "seed_title" in graph_summary:
        parts.append(f"Seed: {graph_summary['seed_title']}")
    if "total_nodes" in graph_summary:
        parts.append(f"Nodes: {graph_summary['total_nodes']}")
    if "total_edges" in graph_summary:
        parts.append(f"Edges: {graph_summary['total_edges']}")

    top_papers = graph_summary.get("top_papers", [])
    if top_papers:
        papers_str = "; ".join([
            f"{p.get('title', '?')} ({p.get('year', '?')})"
            for p in top_papers[:5]
        ])
        parts.append(f"Key papers: {papers_str}")

    return " | ".join(parts)
