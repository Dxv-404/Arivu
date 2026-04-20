"""
backend/gemini_client.py

Gemini Flash 2.0 client for Athena quality assurance and multimodal processing.
Per ATHENA_CLAUDE.md Section 2.6.

Project name: arivu-chat
Model: gemini-2.0-flash

Gemini is NEVER the primary text generator (too slow for streaming feel).
It is used for:
  1. Async quality checks (PASS / CORRECT / ENRICH) after Groq responds
  2. Multimodal image processing (only model that can see images)

The quality check runs in a background thread, never blocking the SSE stream.
"""

import json
import logging

from backend.config import config

logger = logging.getLogger(__name__)

# Quality check prompt per ATHENA_CLAUDE.md Section 2.6
GEMINI_QUALITY_PROMPT = """You are a quality assurance system for a research intelligence
chat called Athena. Check the AI's response for accuracy and completeness.

FULL CONVERSATION HISTORY:
{conversation}

GRAPH DATA SUMMARY (top papers with metrics):
{graph_summary}

THE USER ASKED:
"{question}"

ATHENA RESPONDED WITH:
{response}

QUALITY CHECKS:
1. FACTUAL: Does the response cite numbers that match the graph data?
2. CONSISTENCY: Does it contradict anything said earlier in the conversation?
3. HALLUCINATION: Does it claim things NOT supported by the graph data?
4. COMPLETENESS: Did it address the user's actual question fully?
5. MISSED INSIGHT: Is there an important insight from the graph data that
   the response overlooked?

RESPOND WITH EXACTLY ONE JSON OBJECT:
- If ALL checks pass: {{"action": "pass"}}
- If a fact is wrong: {{"action": "correct", "original": "...", "corrected": "...", "reason": "..."}}
- If an important insight was missed: {{"action": "enrich", "addition": "...", "reason": "..."}}
"""


class GeminiClient:
    """Async Gemini quality checker. Never blocks the main response.
    Per ATHENA_CLAUDE.md Section 2.6."""

    def __init__(self):
        self._model = None
        self._initialized = False

    def _get_model(self):
        if self._model is not None:
            return self._model
        if not config.GEMINI_API_KEY:
            return None
        try:
            import google.generativeai as genai
            genai.configure(api_key=config.GEMINI_API_KEY)
            self._model = genai.GenerativeModel(
                model_name=config.GEMINI_MODEL,
                generation_config={
                    "temperature": 0.1,
                    "max_output_tokens": 500,
                }
            )
            self._initialized = True
            logger.info(f"Gemini client initialized: {config.GEMINI_MODEL}")
            return self._model
        except Exception as e:
            logger.warning(f"Failed to initialize Gemini client: {e}")
            return None

    def generate(self, prompt, max_tokens=800):
        """Generate prose using Gemini. Used as fallback when Groq is rate-limited.
        Returns text string or None."""
        model = self._get_model()
        if not model:
            return None
        try:
            # Use higher max_tokens and temperature for prose generation
            import google.generativeai as genai
            gen_model = genai.GenerativeModel(
                model_name=config.GEMINI_MODEL,
                generation_config={
                    "temperature": 0.7,
                    "max_output_tokens": max_tokens,
                }
            )
            result = gen_model.generate_content(prompt)
            if result and result.text:
                return result.text
            return None
        except Exception as e:
            logger.warning(f"Gemini generate failed: {e}")
            return None

    def quality_check_sync(self, question, response, graph_data, conversation=""):
        """Synchronous quality check. Called from background thread.

        Args:
            question: The user's original question
            response: Groq's generated response text
            graph_data: Graph JSON dict for context
            conversation: Full conversation history string

        Returns:
            dict: {"action": "pass"} or {"action": "correct"/"enrich", ...}
        """
        model = self._get_model()
        if not model:
            return {"action": "pass"}

        try:
            from backend.athena_context import build_graph_summary
            graph_summary = build_graph_summary(graph_data) if graph_data else "No graph loaded"

            prompt = GEMINI_QUALITY_PROMPT.format(
                conversation=conversation[:5000],  # Limit to 5K chars
                graph_summary=graph_summary[:3000],
                question=question[:500],
                response=response[:3000]
            )

            result = model.generate_content(prompt)
            text = result.text.strip()

            # Parse JSON from response
            if text.startswith('{'):
                return json.loads(text)
            # Try to extract JSON from markdown code block
            if '```' in text:
                json_match = text.split('```')[1]
                if json_match.startswith('json'):
                    json_match = json_match[4:]
                return json.loads(json_match.strip())

            return {"action": "pass"}

        except Exception as e:
            logger.warning(f"Gemini quality check failed: {e}")
            return {"action": "pass"}

    def process_image_sync(self, image_bytes, question, graph_summary=""):
        """Process uploaded image. Gemini-only capability.
        Per ATHENA_CLAUDE.md Section 2.6.

        Args:
            image_bytes: Raw image bytes
            question: User's question about the image
            graph_summary: Graph context string

        Returns:
            dict: {"analysis": "..."} or {"error": "..."}
        """
        model = self._get_model()
        if not model:
            return {"error": "Image processing requires Gemini API key"}

        try:
            import PIL.Image
            import io
            img = PIL.Image.open(io.BytesIO(image_bytes))

            prompt = f"""Analyze this image in the context of a research citation lineage.
Graph context: {graph_summary[:2000]}
User question: {question}
Describe what you see and how it relates to the research being analyzed.
Do not use emojis. Do not use em dashes."""

            result = model.generate_content([prompt, img])
            return {"analysis": result.text}

        except Exception as e:
            logger.warning(f"Gemini image processing failed: {e}")
            return {"error": str(e)}
