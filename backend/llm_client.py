"""
backend/llm_client.py

ArivuLLMClient: Groq wrapper + DB cache.
All LLM calls go through this client. Cache key = SHA256(model + ":" +
system_prompt + ":" + user_prompt). TTL = 30 days.

Always check cache before calling Groq. Always store immediately after success.

Implemented in Phase 3.
"""
import hashlib
import json
import logging

from backend.config import config
from backend.db import fetchone, execute

logger = logging.getLogger(__name__)


def _cache_key(model: str, system_prompt: str, user_prompt: str) -> str:
    """Generate cache key: SHA256(model + ":" + system_prompt + ":" + user_prompt)."""
    raw = f"{model}:{system_prompt}:{user_prompt}"
    return hashlib.sha256(raw.encode()).hexdigest()


class ArivuLLMClient:
    """Groq LLM client with DB caching."""

    def __init__(self):
        self._client = None

    @property
    def available(self) -> bool:
        """True if Groq API key is configured."""
        return bool(getattr(config, "GROQ_API_KEY", ""))

    def _get_client(self):
        """Lazy-init Groq client."""
        if self._client is None and self.available:
            try:
                from groq import Groq
                self._client = Groq(api_key=config.GROQ_API_KEY)
            except Exception as e:
                logger.warning(f"Failed to initialize Groq client: {e}")
        return self._client

    def _check_cache(self, key: str) -> str | None:
        """Check LLM cache for a cached response."""
        try:
            row = fetchone(
                "SELECT response FROM llm_cache WHERE cache_key = %s "
                "AND created_at > NOW() - INTERVAL '30 days'",
                (key,),
            )
            if row:
                return row["response"]
        except Exception:
            pass
        return None

    def _store_cache(self, key: str, prompt_hash: str,
                     response: str, model: str) -> None:
        """Store response in LLM cache."""
        try:
            execute(
                """
                INSERT INTO llm_cache (cache_key, prompt_hash, response, model, created_at)
                VALUES (%s, %s, %s, %s, NOW())
                ON CONFLICT (cache_key) DO UPDATE SET
                    response = EXCLUDED.response,
                    created_at = NOW()
                """,
                (key, prompt_hash, response, model),
            )
        except Exception as e:
            logger.debug(f"Cache store failed: {e}")

    def generate_genealogy_story(self, graph_json: dict) -> dict:
        """
        Generate a genealogy narrative for a paper's ancestry graph.

        Args:
            graph_json: full graph JSON from export_to_json()

        Returns:
            {"narrative": str | None, "error": str | None}
        """
        if not self.available:
            return {"narrative": None, "error": "LLM not configured"}

        model = config.GROQ_SMART_MODEL
        metadata = graph_json.get("metadata", {})
        seed_title = metadata.get("seed_paper_title", "Unknown paper")
        total_nodes = metadata.get("total_nodes", 0)

        # Build compact summary for prompt
        nodes = graph_json.get("nodes", [])[:20]
        node_summary = "\n".join([
            f"- {n.get('title', 'Unknown')} ({n.get('year', '?')})"
            for n in nodes
        ])

        system_prompt = (
            "You are a science historian writing for researchers. "
            "Write a compelling 2-3 paragraph narrative about the intellectual "
            "ancestry of an academic paper. Focus on the key ideas that flowed "
            "between papers, how concepts evolved, and what makes this lineage "
            "significant. Be specific and cite paper titles."
        )
        user_prompt = (
            f"Paper: {seed_title}\n"
            f"Total ancestry papers: {total_nodes}\n"
            f"Key papers in ancestry:\n{node_summary}\n\n"
            f"Write the genealogy story."
        )

        key = _cache_key(model, system_prompt, user_prompt)

        # Check cache
        cached = self._check_cache(key)
        if cached:
            return {"narrative": cached, "error": None}

        # Call Groq
        try:
            client = self._get_client()
            if not client:
                return {"narrative": None, "error": "LLM client unavailable"}

            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.7,
                max_tokens=1000,
            )
            narrative = response.choices[0].message.content.strip()

            # Store in cache
            self._store_cache(key, _cache_key("", "", user_prompt), narrative, model)

            return {"narrative": narrative, "error": None}

        except Exception as e:
            logger.warning(f"Genealogy story generation failed: {e}")
            return {"narrative": None, "error": str(e)}

    def generate_cluster_label(self, paper_titles: list,
                                graph_context: str = "") -> str:
        """
        Generate a descriptive label for a DNA cluster.

        Args:
            paper_titles: list of paper titles in the cluster
            graph_context: optional context about the full graph

        Returns:
            str: cluster label (short phrase)
        """
        if not self.available:
            return f"Research cluster ({len(paper_titles)} papers)"

        model = config.GROQ_FAST_MODEL

        system_prompt = (
            "You are an academic research classifier. Given a list of paper titles "
            "from a cluster, generate a SHORT (3-6 word) descriptive label for the "
            "research theme they share. Return ONLY the label, nothing else."
        )
        titles_text = "\n".join(paper_titles[:10])
        user_prompt = f"Papers:\n{titles_text}\n\nLabel:"

        key = _cache_key(model, system_prompt, user_prompt)
        cached = self._check_cache(key)
        if cached:
            return cached

        try:
            client = self._get_client()
            if not client:
                return f"Research cluster ({len(paper_titles)} papers)"

            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.3,
                max_tokens=30,
            )
            label = response.choices[0].message.content.strip()
            self._store_cache(key, _cache_key("", "", user_prompt), label, model)
            return label

        except Exception as e:
            logger.debug(f"Cluster label generation failed: {e}")
            return f"Research cluster ({len(paper_titles)} papers)"

    def generate_chat_response(self, system_prompt: str, user_prompt: str,
                                 history: list = None) -> str | None:
        """
        Generate a chat response for the AI guide.

        Args:
            system_prompt: system context
            user_prompt: user message
            history: list of {"role": str, "content": str} dicts

        Returns:
            str response or None on failure
        """
        if not self.available:
            return None

        model = config.GROQ_FAST_MODEL
        key = _cache_key(model, system_prompt, user_prompt)
        cached = self._check_cache(key)
        if cached:
            return cached

        try:
            client = self._get_client()
            if not client:
                return None

            messages = [{"role": "system", "content": system_prompt}]
            if history:
                messages.extend(history[-6:])  # Last 3 turns
            messages.append({"role": "user", "content": user_prompt})

            response = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.5,
                max_tokens=500,
            )
            text = response.choices[0].message.content.strip()
            self._store_cache(key, _cache_key("", "", user_prompt), text, model)
            return text

        except Exception as e:
            logger.warning(f"Chat response generation failed: {e}")
            return None


# Module-level singleton
_llm_client = None


def get_llm_client() -> ArivuLLMClient:
    """Get or create the global LLM client singleton."""
    global _llm_client
    if _llm_client is None:
        _llm_client = ArivuLLMClient()
    return _llm_client
