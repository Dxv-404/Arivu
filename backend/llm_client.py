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
        Generate a structured genealogy narrative for a paper's ancestry graph.

        Uses mutation types, bottleneck data, and temporal eras to produce
        a chapter-based narrative with mutation verbs (ADOPTED, GENERALIZED, etc.).

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

        nodes = graph_json.get("nodes", [])
        edges = graph_json.get("edges", [])

        # Extract bottleneck papers (top 5 by pruning_impact)
        bottlenecks = sorted(
            [n for n in nodes if (n.get("pruning_impact") or 0) > 0],
            key=lambda n: n.get("pruning_impact", 0), reverse=True
        )[:5]
        bottleneck_summary = "\n".join([
            f"- \"{n.get('title', '?')}\" ({n.get('year', '?')}) — "
            f"{n.get('pruning_impact', 0)} papers depend on it [BOTTLENECK]"
            for n in bottlenecks
        ]) if bottlenecks else "No bottlenecks detected."

        # Count mutation types
        mutation_counts = {}
        for e in edges:
            mt = e.get("mutation_type", "unknown")
            mutation_counts[mt] = mutation_counts.get(mt, 0) + 1
        total_edges = len(edges) or 1
        mutation_summary = "\n".join([
            f"- {mt}: {count} edges ({round(count/total_edges*100)}%)"
            for mt, count in sorted(mutation_counts.items(), key=lambda x: -x[1])[:6]
        ])

        # Group key papers by era
        nodes_with_year = sorted(
            [n for n in nodes if n.get("year")],
            key=lambda n: n["year"]
        )
        oldest = nodes_with_year[0] if nodes_with_year else None
        newest = nodes_with_year[-1] if nodes_with_year else None
        min_year = oldest["year"] if oldest else "?"
        max_year = newest["year"] if newest else "?"

        # Top cited papers per era
        era_papers = {}
        for n in nodes_with_year[:50]:  # limit to keep prompt small
            decade = (n["year"] // 10) * 10
            era_key = f"{decade}s"
            if era_key not in era_papers:
                era_papers[era_key] = []
            if len(era_papers[era_key]) < 3:
                era_papers[era_key].append(
                    f"\"{n.get('title', '?')}\" ({n.get('year', '?')}, "
                    f"{n.get('citation_count', 0)} citations)"
                )
        era_summary = "\n".join([
            f"{era}: {'; '.join(papers)}"
            for era, papers in sorted(era_papers.items())
        ])

        # Find contradiction edges
        contradictions = [e for e in edges if e.get("mutation_type") == "contradiction"]
        contradiction_summary = ""
        if contradictions:
            for c in contradictions[:3]:
                src_id = c.get("source") if isinstance(c.get("source"), str) else c.get("source", {}).get("id", "?")
                tgt_id = c.get("target") if isinstance(c.get("target"), str) else c.get("target", {}).get("id", "?")
                src_node = next((n for n in nodes if n.get("id") == src_id), {})
                tgt_node = next((n for n in nodes if n.get("id") == tgt_id), {})
                contradiction_summary += (
                    f"- \"{src_node.get('title', '?')}\" CONTRADICTED BY "
                    f"\"{tgt_node.get('title', '?')}\"\n"
                )

        system_prompt = (
            "You are a science historian writing a structured genealogy narrative "
            "for researchers. Write in ERA CHAPTERS with uppercase headings.\n\n"
            "RULES:\n"
            "- Use era chapter headings in ALL CAPS with year ranges, e.g.:\n"
            "  THE FOUNDATIONS (1990-2005)\n"
            "  THE BREAKTHROUGH (2015-2016)\n"
            "- Use mutation verbs in CAPS when describing how ideas flow between papers:\n"
            "  ADOPTED (direct method reuse), GENERALIZED (extended scope),\n"
            "  SPECIALIZED (narrowed focus), CONTRADICTED (challenged assumptions),\n"
            "  EXTENDED (built upon), HYBRIDIZED (combined approaches), REVIVED (brought back)\n"
            "- Reference paper titles in quotes with year\n"
            "- Mention specific numbers (citation counts, descendant counts)\n"
            "- For bottleneck papers, mention how many papers depend on them\n"
            "- NO filler phrases. BANNED phrases: 'rich and complex', 'testament to',\n"
            "  'it is worth noting', 'gain a deeper understanding', 'expected to further evolve',\n"
            "  'new innovations and applications', 'continue to build upon', 'in the coming years',\n"
            "  'this lineage demonstrates', 'the field is expected'\n"
            "- Each era chapter: 2-4 sentences maximum\n"
            "- Total: 3-5 era chapters\n"
            "- End with a 1-sentence SPECIFIC statement about an unresolved question or\n"
            "  unexplored direction in this lineage. NOT a generic 'the field will evolve' sentence.\n"
            "  Example: 'The absence of neuroscience methods in this lineage leaves open the\n"
            "  question of whether biologically-inspired architectures could outperform ResNet.'\n"
            "- Each chapter heading MUST be on its own line, separated by blank lines\n"
            "- Separate chapters with TWO blank lines\n"
        )
        user_prompt = (
            f"Paper: \"{seed_title}\"\n"
            f"Total ancestry: {total_nodes} papers, spanning {min_year} to {max_year}\n\n"
            f"BOTTLENECK PAPERS (structurally critical):\n{bottleneck_summary}\n\n"
            f"MUTATION TYPES (how ideas flow):\n{mutation_summary}\n\n"
            f"KEY PAPERS BY ERA:\n{era_summary}\n\n"
        )
        if contradiction_summary:
            user_prompt += f"CONTRADICTIONS IN THE LINEAGE:\n{contradiction_summary}\n\n"
        user_prompt += "Write the genealogy story in era chapters with mutation verbs."

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
                temperature=0.6,
                max_tokens=1500,
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

    def generate_literature_review(self, graph_data: dict) -> str:
        """
        Generate a structured Markdown literature review for the graph.
        Grounded: only uses facts from the graph — does not add training knowledge.
        Returns Markdown string. Returns "" if LLM unavailable.
        """
        if not self.available:
            return ""

        nodes      = graph_data.get("nodes", [])
        meta       = graph_data.get("metadata", {})
        seed_title = meta.get("seed_paper_title", "the seed paper")

        sorted_nodes = sorted(nodes, key=lambda n: n.get("year") or 9999)
        papers_list  = "\n".join(
            f"- {n.get('year', 'n.d.')} | {n.get('title', 'Untitled')} | "
            f"{', '.join((n.get('authors') or ['Unknown'])[:2])}"
            for n in sorted_nodes[:30]
        )

        model = config.GROQ_SMART_MODEL
        system_prompt = "You are writing a structured academic literature review."
        user_prompt = f"""CRITICAL RULES:
1. Only use the paper information listed below — do NOT add knowledge from your training
2. Do not invent claims, dates, or relationships not present in the data
3. Write in Markdown format with clear section headings

GRAPH DATA:
Seed paper: {seed_title}
Total papers: {len(nodes)}

PAPERS IN GRAPH (chronological):
{papers_list}

TASK: Write a 400-600 word structured literature review covering:
1. ## Overview — what this graph represents
2. ## Foundational Work — the earliest/most cited papers
3. ## Development — how ideas evolved over time
4. ## Current State — most recent papers in the graph

Use only the papers listed above. Format as Markdown."""

        key = _cache_key(model, system_prompt, user_prompt)
        cached = self._check_cache(key)
        if cached:
            return cached

        try:
            client = self._get_client()
            if not client:
                return ""

            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.5,
                max_tokens=1500,
            )
            text = response.choices[0].message.content.strip()
            self._store_cache(key, _cache_key("", "", user_prompt), text, model)
            return text

        except Exception as exc:
            logger.warning(f"generate_literature_review failed: {exc}")
            return ""

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
