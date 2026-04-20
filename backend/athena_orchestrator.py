"""
backend/athena_orchestrator.py

The 7-phase Athena Response Orchestrator.
Per ATHENA_CLAUDE.md Part 2 and ATHENA_PHASE_A.md Section 2.1.24.

Phase A implements: Phase 1 (computed blocks), Phase 3 (LLM prose), Phase 6 stub (Gemini).
Phases 2, 4, 5, 7 are stubs filled by later features/phases.

Architecture:
  POST /api/athena/send -> handle_send() -> returns message_id
  GET /api/athena/stream -> generate_response() -> yields SSE events
"""

import json
import re
import uuid
import logging
import threading

from backend.config import Config, config
from backend.db import fetchone, fetchall, execute
from backend.athena_context import (
    assemble_context_stack, INTENT_DECOMPOSER_PROMPT,
    build_graph_summary, estimate_tokens
)
from backend.athena_grounding import verify_grounding
from backend.rate_limiter import ArivuRateLimiter

logger = logging.getLogger(__name__)

# ── Groq Key Rotation ─────────────────────────────────────────────────────
# When one key hits rate limit, automatically rotate to the next.
# Keys loaded from GROQ_API_KEY, GROQ_API_KEY_2, GROQ_API_KEY_3 in .env.
import os as _os
import time as _time_mod

class GroqKeyRotator:
    """Manages multiple Groq API keys with automatic rotation on rate limit."""

    def __init__(self):
        self._keys = []
        self._clients = {}
        self._current_index = 0
        self._blocked_until = {}  # {key_index: timestamp}

        # Load all available keys
        primary = config.GROQ_API_KEY
        if primary:
            self._keys.append(primary)
        for suffix in ('_2', '_3', '_4', '_5'):
            key = _os.environ.get(f'GROQ_API_KEY{suffix}', '')
            if key:
                self._keys.append(key)

        if self._keys:
            logger.info(f"Groq key rotator initialized with {len(self._keys)} keys")

    def get_client(self):
        """Return a working Groq client, rotating past rate-limited keys."""
        if not self._keys:
            return None

        from groq import Groq
        now = _time_mod.time()
        attempts = 0

        while attempts < len(self._keys):
            idx = (self._current_index + attempts) % len(self._keys)

            # Skip keys that are still blocked
            if idx in self._blocked_until and now < self._blocked_until[idx]:
                attempts += 1
                continue

            # Clear expired blocks
            if idx in self._blocked_until and now >= self._blocked_until[idx]:
                del self._blocked_until[idx]

            key = self._keys[idx]
            if key not in self._clients:
                self._clients[key] = Groq(api_key=key)

            self._current_index = idx
            return self._clients[key]

        # All keys blocked
        logger.warning("All Groq API keys are rate-limited")
        return None

    def mark_rate_limited(self, cooldown_seconds=30):
        """Mark the current key as rate-limited. Rotator will skip it."""
        idx = self._current_index
        self._blocked_until[idx] = _time_mod.time() + cooldown_seconds
        logger.info(f"Groq key #{idx + 1} rate-limited, blocked for {cooldown_seconds}s. "
                     f"{len(self._keys) - len(self._blocked_until)} keys remaining.")
        # Advance to next key immediately
        self._current_index = (idx + 1) % len(self._keys)

    @property
    def available_keys(self):
        now = _time_mod.time()
        return sum(1 for i in range(len(self._keys))
                   if i not in self._blocked_until or now >= self._blocked_until[i])

# Module-level singleton
_groq_rotator = GroqKeyRotator()

# In-memory store for active streams (message_id -> context)
# B2-01 fix: entries have 'created_at' timestamp, cleaned every 50 calls
_active_streams = {}
_stream_cleanup_counter = 0

def _cleanup_stale_streams():
    """Remove streams older than 5 minutes to prevent memory leaks."""
    global _stream_cleanup_counter
    _stream_cleanup_counter += 1
    if _stream_cleanup_counter < 50:
        return
    _stream_cleanup_counter = 0
    import time
    cutoff = time.time() - 300  # 5 minutes
    stale = [k for k, v in _active_streams.items() if v.get('created_at', 0) < cutoff]
    for k in stale:
        del _active_streams[k]
    if stale:
        logger.info(f"Cleaned {len(stale)} stale Athena streams")

# Rate limiter instance for Athena endpoints
_athena_limiter = ArivuRateLimiter()


class AthenaOrchestrator:
    """7-phase response orchestrator. See ATHENA_CLAUDE.md Part 2."""

    def __init__(self):
        self._groq_client = None
        self._gemini_client = None
        self._event_counter = 0
        self._current_awareness = {}  # Current awareness state for command resolution
        self._session_command_targets = {}  # {session_id: last_command_target} for pronoun resolution

    def _get_groq(self):
        """Get Groq client via key rotator. Automatically uses non-rate-limited key."""
        return _groq_rotator.get_client()

    def _get_gemini(self):
        """Lazy-init Gemini client."""
        if self._gemini_client is None and Config.gemini_enabled():
            try:
                from backend.gemini_client import GeminiClient
                self._gemini_client = GeminiClient()
            except Exception as e:
                logger.warning(f"Failed to initialize Gemini client: {e}")
        return self._gemini_client

    def _next_event_id(self):
        """Generate incrementing event ID for SSE Last-Event-ID support."""
        self._event_counter += 1
        return f"evt_{self._event_counter:04d}"

    # ── handle_send: POST /api/athena/send ─────────────────────────────────

    def handle_send(self, message, graph_id, thread_id, session_id, awareness=None, mode=None):
        """Called by POST /api/athena/send. Returns message_id.
        Per ATHENA_PHASE_A.md Section 2.1.1 and 2.1.24."""

        # Rate limit check (sync) -- uses "POST /api/chat" bucket
        allowed, headers = _athena_limiter.check_sync(session_id, r"POST /api/chat")
        if not allowed:
            raise ValueError("Rate limit exceeded. Please wait before sending another message.")

        message_id = f"m_{uuid.uuid4().hex[:12]}"

        # Store user message in chat_history immediately
        # Per ATHENA_PHASE_A.md Section 2.1.24: "stores before streaming"
        # Build metadata with graph_id + awareness context for history restoration
        user_meta = {"graph_id": graph_id}
        if awareness:
            # Store a compact version of awareness for context chip restoration
            if awareness.get('clicked_paper'):
                cp = awareness['clicked_paper']
                user_meta['context'] = {
                    'type': 'node',
                    'paper_id': cp.get('paper_id', ''),
                    'title': cp.get('title', ''),
                    'year': cp.get('year'),
                }
            elif awareness.get('clicked_edge'):
                ce = awareness['clicked_edge']
                user_meta['context'] = {
                    'type': 'edge',
                    'citing_paper_id': ce.get('citing_paper_id', ''),
                    'cited_paper_id': ce.get('cited_paper_id', ''),
                    'citing_title': ce.get('citing_title', ''),
                    'cited_title': ce.get('cited_title', ''),
                }
            elif awareness.get('prune_state') and awareness['prune_state'].get('state') == 'complete':
                ps = awareness['prune_state']
                user_meta['context'] = {
                    'type': 'prune',
                    'paper_id': ps.get('removed_paper_id', ''),
                    'title': ps.get('paper_title', ''),
                    'impact': ps.get('impact_percentage'),
                }
        try:
            execute(
                "INSERT INTO chat_history (session_id, thread_id, role, content, metadata) "
                "VALUES (%s, %s, 'user', %s, %s)",
                (session_id, thread_id or 'main', message,
                 json.dumps(user_meta))
            )
        except Exception as e:
            logger.error(f"Failed to store user message: {e}")

        # Cleanup stale streams (B2-01)
        _cleanup_stale_streams()

        # Prepare generation context for the stream endpoint
        import time as _time
        _active_streams[message_id] = {
            "message": message,
            "graph_id": graph_id,
            "thread_id": thread_id or "main",
            "session_id": session_id,
            "status": "pending",
            "full_response": "",
            "blocks": [],
            "awareness": awareness,
            "mode": mode or "default",
            "created_at": _time.time(),
        }

        return message_id

    # ── generate_response: GET /api/athena/stream ──────────────────────────

    def generate_response(self, message_id, session_id):
        """Generator yielding SSE event dicts.
        Per ATHENA_PHASE_A.md Section 2.1.4 Flask SSE Generator Pattern."""
        ctx = _active_streams.get(message_id)
        print(f"[ATHENA STREAM] mid={message_id}, ctx_exists={ctx is not None}, session_match={ctx.get('session_id') == session_id if ctx else 'N/A'}, send_sid={ctx.get('session_id','?')[:20] if ctx else '?'}, stream_sid={session_id[:20] if session_id else '?'}", flush=True)
        if not ctx or ctx["session_id"] != session_id:
            yield {"id": self._next_event_id(), "type": "error",
                   "data": {"message": "Invalid or expired stream", "recoverable": False}}
            return

        ctx["status"] = "generating"

        # Load graph data
        graph_data = self._load_graph(ctx["graph_id"])

        # Load conversation memory (last 10 messages)
        memory = self._load_memory(ctx["session_id"], ctx["thread_id"])

        # Assemble context stack (8 layers)
        context_stack = assemble_context_stack(
            session_id=ctx["session_id"],
            graph_data=graph_data,
            user_message=ctx["message"],
            memory=memory,
            mode=ctx.get("mode", "default"),
            awareness=ctx.get("awareness"),
        )

        # ── PHASE 0.5: Graph Commands (Phase C #005, highest priority) ────
        # Store awareness for command target resolution (pronouns, superlatives)
        awareness = ctx.get("awareness") or {}
        # Inject last_command_target from session storage for pronoun resolution
        last_cmd_target = self._session_command_targets.get(ctx["session_id"])
        if last_cmd_target:
            awareness["last_command_target"] = last_cmd_target
        self._current_awareness = awareness

        intent = self._decompose_intent(ctx["message"], graph_data)
        if intent.get("command_action"):
            cmd = intent["command_action"]
            # Store last command target for pronoun resolution in subsequent messages
            if cmd.get("target"):
                self._session_command_targets[ctx["session_id"]] = cmd["target"]
            # Emit command event for frontend execution
            yield {"id": self._next_event_id(), "type": "command", "data": cmd}

            # If skip_llm, emit a compact confirmation and skip everything else
            if intent.get("skip_llm"):
                action_label = cmd.get("action", "").capitalize()
                target_label = cmd.get("target", "graph")
                yield {"id": self._next_event_id(), "type": "block", "data": {
                    "type": "command_confirm",
                    "provenance": "computed",
                    "data": {
                        "action": action_label,
                        "target": target_label,
                        "status": "executed",
                    }
                }}
                # Emit done immediately — no LLM call, no blocks, no followups
                ctx["full_response"] = f"[Command: {action_label} {target_label}]"
                ctx["status"] = "complete"
                yield {"id": self._next_event_id(), "type": "done",
                       "data": {"total_tokens": 0, "model": "none",
                                "grounding_report": {}, "footnotes": [],
                                "full_text": ctx["full_response"]}}
                return  # Exit generator — no further phases

        # ── PHASE 0.5a: Terminal Suggestion (Phase C #012) ───────────
        if intent.get("intent") == "terminal_suggest" and intent.get("terminal_command"):
            cmd = intent["terminal_command"]
            yield {"id": self._next_event_id(), "type": "block", "data": {
                "type": "terminal_suggest",
                "provenance": "computed",
                "data": {
                    "command": cmd,
                    "message": "I can execute this via the Arivu Terminal:",
                }
            }}
            ctx["full_response"] = f"[Terminal suggestion: {cmd}]"
            ctx["status"] = "complete"
            yield {"id": self._next_event_id(), "type": "done",
                   "data": {"total_tokens": 0, "model": "none",
                            "grounding_report": {}, "footnotes": [],
                            "full_text": ctx["full_response"]}}
            return

        # ── PHASE 0.5b: Pathfinder Handoff (Phase C #008) ────────────
        # Show handoff card. Frontend handles the actual Pathfinder API call.
        if intent.get("intent") == "pathfinder_handoff":
            graph_id = ctx.get("graph_id", "")
            yield {"id": self._next_event_id(), "type": "block", "data": {
                "type": "pathfinder_handoff",
                "provenance": "computed",
                "data": {
                    "message": "This question might be better answered by Pathfinder, which specializes in research positioning and gap analysis.",
                    "graph_id": graph_id,
                    "query": ctx["message"],
                }
            }}
            ctx["full_response"] = "[Pathfinder handoff offered]"
            ctx["status"] = "complete"
            yield {"id": self._next_event_id(), "type": "done",
                   "data": {"total_tokens": 0, "model": "none",
                            "grounding_report": {}, "footnotes": [],
                            "full_text": ctx["full_response"]}}
            return

        # ── PHASE 0.6: Traversal (Phase C #034) ───────────────────────
        if intent.get("intent") == "traversal" and graph_data:
            yield from self._generate_traversal(ctx, intent, graph_data)
            return

        # ── PHASE 0.7: Deep Dive (Phase C #016) ────────────────────────
        _dbg = lambda msg: open('athena_debug.log', 'a').write(f"{msg}\n")
        _dbg(f"[PHASE 0.7] intent={intent.get('intent')!r}, graph_data={'yes' if graph_data else 'no'}")
        if intent.get("intent") == "deep_dive" and graph_data:
            _dbg("[PHASE 0.7] Entering deep dive generator")
            yield from self._generate_deep_dive(ctx, intent, graph_data, context_stack)
            return  # Deep dive handles its own done event

        # ── PHASE 1: Computed Data Blocks (instant, no LLM) ─────────────
        print(f"[ATHENA PHASE 1] graph_loaded={graph_data is not None}, block_plan={intent.get('block_plan')}, entities={len(intent.get('entities',[]))}", flush=True)
        if graph_data and intent.get("block_plan"):
            try:
                from backend.athena_blocks import DataAssemblyEngine
                engine = DataAssemblyEngine(graph_data)
                entity_ids = [e.get('paper_id','')[:20] for e in intent.get('entities',[])]
                node_sample = list(engine.nodes.keys())[:3]
                data_needs = intent.get('data_needs', [])
                print(f"[ATHENA PHASE 1] entity_ids={entity_ids}, node_sample={[k[:20] for k in node_sample]}, nodes_count={len(engine.nodes)}, data_needs={data_needs}", flush=True)
                # Check if entity is in pagerank
                for eid in entity_ids:
                    full_eid = [e.get('paper_id','') for e in intent.get('entities',[]) if e.get('paper_id','')[:20] == eid][0]
                    print(f"[ATHENA PHASE 1] entity {eid} in_pagerank={full_eid in engine.pagerank}, in_nodes={full_eid in engine.nodes}", flush=True)
                # Phase C #107/#020: Inject awareness data into intent for blocks that need it
                awareness_blocks = {'filter_stats', 'citation_evidence'}
                if awareness_blocks & set(intent.get('block_plan', [])) and ctx.get('awareness'):
                    intent['_awareness'] = ctx['awareness']
                blocks = engine.assemble(intent)
                print(f"[ATHENA PHASE 1] Assembled {len(blocks)} blocks", flush=True)
                for block in blocks:
                    ctx["blocks"].append(block)
                    print(f"[ATHENA PHASE 1] Yielding block type={block.get('type')}", flush=True)
                    yield {"id": self._next_event_id(), "type": "block", "data": block}
            except Exception as e:
                logger.error(f"Phase 1 block assembly failed: {e}")
                import traceback; traceback.print_exc()

        # Phase C #026: Adjust model selection based on relationship confidence
        # LOW/SPECULATIVE → use 8b to save quota. HIGH/MEDIUM → use 70b for quality.
        if intent.get('intent') == 'relationship':
            for block in ctx.get("blocks", []):
                if block.get("type") == "relationship_explainer":
                    edge_data = block.get("data", {}).get("edge", {})
                    conf_tier = edge_data.get("confidence_tier", "SPECULATIVE")
                    if conf_tier in ("LOW", "SPECULATIVE"):
                        intent["model_selection"] = "8b"

        # ── PHASE 2: Thinking Steps (Feature #054, stub for now) ────────
        # Added by Feature #054 later in Phase A

        # ── PHASE 3: LLM Prose Generation (streaming) ──────────────────
        # Check cache first
        cached_prose = self._check_prose_cache(ctx["message"], ctx.get("graph_id"))
        if cached_prose:
            full_response = cached_prose
            # Stream cached response in chunks
            for i in range(0, len(cached_prose), 30):
                chunk = cached_prose[i:i+30]
                yield {"id": self._next_event_id(), "type": "prose",
                       "data": {"content": chunk, "provenance": "interpreted"}}
        else:
            groq = self._get_groq()
            full_response = ""

        _dbg = lambda msg: open('athena_debug.log', 'a').write(f"{msg}\n")
        _dbg(f"[PHASE3] cached={bool(cached_prose)}, groq={bool(groq)}, skip_llm={intent.get('skip_llm')}")
        if not cached_prose and groq and not intent.get("skip_llm"):
            model = config.GROQ_SMART_MODEL if intent.get("model_selection") == "70b" else config.GROQ_FAST_MODEL
            _dbg(f"[PHASE3] Calling Groq model={model}, context_msgs={len(context_stack)}")
            try:
                stream = groq.chat.completions.create(
                    model=model,
                    messages=context_stack,
                    max_tokens=2000,
                    temperature=0.7,
                    stream=True,
                )
                batch = ""
                block_buffer = None  # None = not inside a block, str = accumulating block content
                block_tag = None     # The opening tag like "quote:paper_id=1"
                for chunk in stream:
                    token = chunk.choices[0].delta.content or ""
                    full_response += token

                    # If we're inside a [BLOCK:...]...[/BLOCK], accumulate
                    if block_buffer is not None:
                        block_buffer += token
                        if '[/BLOCK]' in block_buffer:
                            # Block complete - extract content and render
                            content = block_buffer.split('[/BLOCK]')[0].strip()
                            remainder = block_buffer.split('[/BLOCK]', 1)[1] if '[/BLOCK]' in block_buffer else ''
                            block_data = self._parse_block_marker(f'[BLOCK:{block_tag}]', graph_data, content=content)
                            if block_data:
                                yield {"id": self._next_event_id(), "type": "block", "data": block_data}
                            block_buffer = None
                            block_tag = None
                            if remainder.strip():
                                batch = remainder
                        continue

                    batch += token
                    # Check for block markers immediately (not just at 20-char threshold)
                    has_block_marker = '[BLOCK:' in batch and ']' in batch[batch.index('[BLOCK:'):]
                    # CRITICAL FIX: If we see [BLOCK: but no closing ], HOLD the batch
                    # Don't flush partial markers as prose - wait for more tokens
                    has_partial_marker = '[BLOCK:' in batch and not has_block_marker
                    # Stream every ~20 chars (~5 tokens) or when a block marker is detected
                    # But NEVER flush if there's a partial [BLOCK: marker waiting for ]
                    if (len(batch) >= 20 or has_block_marker) and not has_partial_marker:
                        # Check for block opening tag
                        if '[BLOCK:' in batch:
                            # Split around block tags
                            block_match = re.search(r'\[BLOCK:([^\]]+)\]', batch)
                            if block_match:
                                pre_text = batch[:block_match.start()]
                                block_tag = block_match.group(1)
                                post_text = batch[block_match.end():]
                                # Send any text before the block
                                if pre_text.strip():
                                    yield {"id": self._next_event_id(), "type": "prose",
                                           "data": {"content": pre_text, "provenance": "interpreted"}}
                                # Check if closing tag is in the same batch
                                if '[/BLOCK]' in post_text:
                                    content = post_text.split('[/BLOCK]')[0].strip()
                                    remainder = post_text.split('[/BLOCK]', 1)[1]
                                    block_data = self._parse_block_marker(f'[BLOCK:{block_tag}]', graph_data, content=content)
                                    if block_data:
                                        yield {"id": self._next_event_id(), "type": "block", "data": block_data}
                                    block_tag = None
                                    batch = remainder
                                else:
                                    # Start accumulating block content
                                    block_buffer = post_text
                                    batch = ""
                            else:
                                yield {"id": self._next_event_id(), "type": "prose",
                                       "data": {"content": batch, "provenance": "interpreted"}}
                                batch = ""
                        else:
                            yield {"id": self._next_event_id(), "type": "prose",
                                   "data": {"content": batch, "provenance": "interpreted"}}
                            batch = ""
                # Flush remaining
                if batch:
                    # FIX #6: Also check final batch for block markers
                    if '[BLOCK:' in batch:
                        parts = re.split(r'(\[BLOCK:[^\]]+\])', batch)
                        for part in parts:
                            if part.startswith('[BLOCK:'):
                                block_data = self._parse_block_marker(part, graph_data)
                                if block_data:
                                    yield {"id": self._next_event_id(), "type": "block", "data": block_data}
                            elif part.strip():
                                yield {"id": self._next_event_id(), "type": "prose",
                                       "data": {"content": part, "provenance": "interpreted"}}
                    else:
                        yield {"id": self._next_event_id(), "type": "prose",
                               "data": {"content": batch, "provenance": "interpreted"}}
            except Exception as e:
                error_name = type(e).__name__
                logger.error(f"Groq streaming failed: {error_name}: {e}")
                _dbg(f"[PHASE3 ERROR] {error_name}: {str(e)[:300]}")
                import traceback; _dbg(traceback.format_exc())
                # Auto-rotate on rate limit
                if 'RateLimit' in error_name or 'rate' in str(e).lower() or '429' in str(e):
                    _groq_rotator.mark_rate_limited(cooldown_seconds=30)
                    # Retry with next key AND fallback to 8b model if 70b is TPD-limited
                    retry_groq = self._get_groq()
                    fallback_model = config.GROQ_FAST_MODEL if model == config.GROQ_SMART_MODEL else model
                    _dbg(f"[PHASE3 RETRY] Trying key rotation + model fallback: {model} -> {fallback_model}")
                    # If rotated key also fails (same org = same daily limit),
                    # directly try the 8b model which has 5x higher token quota
                    _dbg(f"[PHASE3 RETRY] retry_groq exists: {retry_groq is not None}")
                    any_groq = retry_groq or groq  # Use ANY available client
                    if any_groq and fallback_model != model:
                        _dbg(f"[PHASE3 RETRY] Trying {fallback_model} with available client")
                        try:
                            retry_stream = any_groq.chat.completions.create(
                                model=fallback_model, messages=context_stack,
                                max_tokens=2000, temperature=0.7, stream=True,
                            )
                            batch = ""
                            for chunk in retry_stream:
                                token = chunk.choices[0].delta.content or ""
                                batch += token
                                full_response += token
                                if len(batch) >= 20:
                                    yield {"id": self._next_event_id(), "type": "prose",
                                           "data": {"content": batch, "provenance": "interpreted"}}
                                    batch = ""
                            if batch:
                                yield {"id": self._next_event_id(), "type": "prose",
                                       "data": {"content": batch, "provenance": "interpreted"}}
                            _dbg(f"[PHASE3 RETRY] 8b fallback SUCCESS, {len(full_response)} chars")
                        except Exception as retry_e:
                            _dbg(f"[PHASE3 RETRY] 8b fallback FAILED: {type(retry_e).__name__}: {str(retry_e)[:200]}")
                            # Try Gemini as absolute last resort
                            gemini_prose = self._gemini_prose_fallback(context_stack)
                            if gemini_prose:
                                full_response = gemini_prose
                                for i in range(0, len(gemini_prose), 40):
                                    chunk = gemini_prose[i:i+40]
                                    yield {"id": self._next_event_id(), "type": "prose",
                                           "data": {"content": chunk, "provenance": "enriched"}}
                            else:
                                yield {"id": self._next_event_id(), "type": "error",
                                       "data": {"message": "Daily token quota exhausted for all models. Please try again later.",
                                                "recoverable": True}}
                    elif any_groq:
                        # Already on the fast model, just retry with a different key
                        try:
                            retry_stream = any_groq.chat.completions.create(
                                model=model, messages=context_stack,
                                max_tokens=2000, temperature=0.7, stream=True,
                            )
                            batch = ""
                            for chunk in retry_stream:
                                token = chunk.choices[0].delta.content or ""
                                batch += token
                                full_response += token
                                if len(batch) >= 20:
                                    yield {"id": self._next_event_id(), "type": "prose",
                                           "data": {"content": batch, "provenance": "interpreted"}}
                                    batch = ""
                            if batch:
                                yield {"id": self._next_event_id(), "type": "prose",
                                       "data": {"content": batch, "provenance": "interpreted"}}
                        except Exception as retry_e2:
                            _dbg(f"[PHASE3 RETRY] same-model retry FAILED: {retry_e2}")
                            yield {"id": self._next_event_id(), "type": "error",
                                   "data": {"message": "Analysis temporarily unavailable. Please try again shortly.",
                                            "recoverable": True}}
                    else:
                        yield {"id": self._next_event_id(), "type": "error",
                               "data": {"message": "Analysis temporarily unavailable. Please try again shortly.",
                                        "recoverable": True}}
                else:
                    # Non-rate-limit error -> try Gemini
                    gemini_prose = self._gemini_prose_fallback(context_stack)
                    if gemini_prose:
                        full_response = gemini_prose
                        for i in range(0, len(gemini_prose), 40):
                            chunk = gemini_prose[i:i+40]
                            yield {"id": self._next_event_id(), "type": "prose",
                                   "data": {"content": chunk, "provenance": "enriched"}}
                    else:
                        yield {"id": self._next_event_id(), "type": "error",
                               "data": {"message": f"Analysis error ({error_name}). Showing computed data only.",
                                        "recoverable": True}}
        elif not groq:
            # No Groq at all -> use Gemini as primary
            gemini_prose = self._gemini_prose_fallback(context_stack)
            if gemini_prose:
                full_response = gemini_prose
                for i in range(0, len(gemini_prose), 40):
                    chunk = gemini_prose[i:i+40]
                    yield {"id": self._next_event_id(), "type": "prose",
                           "data": {"content": chunk, "provenance": "enriched"}}
            else:
                yield {"id": self._next_event_id(), "type": "prose",
                       "data": {"content": "LLM analysis is currently unavailable. Showing computed data only.",
                                "provenance": "interpreted"}}

        ctx["full_response"] = full_response

        # Cache successful prose response for future reuse
        if full_response and len(full_response) > 50 and not cached_prose:
            self._store_prose_cache(ctx["message"], ctx.get("graph_id"), full_response)

        # ── FIX #7: Grounding Verification ────────────────────────────
        grounding_report = {"grounded": 0, "ungrounded": 0}
        if full_response and ctx.get("blocks"):
            try:
                verified_text, grounding_report = verify_grounding(full_response, ctx["blocks"])
                ctx["full_response"] = verified_text
                full_response = verified_text
            except Exception as e:
                logger.warning(f"Grounding verification failed: {e}")

        # ── PHASE 4: Mode Post-Processing (Phase E, stub) ──────────────

        # ── PHASE 4.5: Citation Processing (B-23, B-24) ─────────────
        footnotes = []
        if full_response and graph_data:
            try:
                processed_text, footnotes = process_citations(full_response, graph_data)
                ctx["full_response"] = processed_text
            except Exception as e:
                logger.warning(f"Citation processing failed: {e}")

        # ── PHASE 5: Follow-up Suggestions (B-29) ───────────────────
        # Pass user message for context-aware followup generation
        intent['_user_message'] = ctx.get('message', '')
        followups = generate_followups(intent, graph_data, ctx["blocks"], memory)
        if followups:
            yield {"id": self._next_event_id(), "type": "followups",
                   "data": {"suggestions": followups}}

        # ── PHASE 5.5: Confidence Score (B-25) ──────────────────────
        if ctx["blocks"]:
            computed_count = sum(1 for b in ctx["blocks"] if b.get("provenance") == "computed")
            total_content = computed_count + (1 if full_response else 0)
            ratio = computed_count / max(total_content, 1)
            if ratio >= 0.75:
                conf_level = "HIGH"
            elif ratio >= 0.5:
                conf_level = "MEDIUM"
            elif ratio >= 0.25:
                conf_level = "LOW"
            else:
                conf_level = "SPECULATIVE"
            yield {"id": self._next_event_id(), "type": "confidence",
                   "data": {"level": conf_level, "score": round(ratio, 2),
                            "label": "Response confidence"}}

        # ── PHASE 6: Gemini Quality Assurance (async, non-blocking) ─────
        gemini = self._get_gemini()
        if gemini and full_response and config.ATHENA_GEMINI_QC:
            threading.Thread(
                target=self._async_gemini_check,
                args=(message_id, session_id, ctx["message"], full_response, graph_data),
                daemon=True
            ).start()

        # ── PHASE 7: Speculative Prefetch (Phase F, stub) ──────────────

        # ── done event (always last in stream) ──────────────────────────
        yield {"id": self._next_event_id(), "type": "done",
               "data": {
                   "total_tokens": estimate_tokens(full_response),
                   "model": config.GROQ_SMART_MODEL if intent.get("model_selection") == "70b" else config.GROQ_FAST_MODEL,
                   "grounding_report": grounding_report,
                   "footnotes": footnotes,
                   "full_text": full_response,  # Phase C fix: authoritative raw text for frontend re-render
               }}

        ctx["status"] = "complete"

        # Track first paper mentioned in LLM response for pronoun resolution
        # ("zoom to that paper" after LLM discusses a specific paper)
        if full_response and graph_data and graph_data.get('nodes'):
            try:
                mentioned_title = self._extract_first_mentioned_paper(full_response, graph_data)
                if mentioned_title:
                    self._session_command_targets[ctx["session_id"]] = mentioned_title
            except Exception:
                pass  # Never break on tracking failures

    # ── finalize_response ──────────────────────────────────────────────────

    def finalize_response(self, message_id, session_id):
        """Store complete assistant message after stream ends.
        Per ATHENA_PHASE_A.md Section 2.1.24."""
        ctx = _active_streams.get(message_id)
        if not ctx:
            return

        _dbg_fn = lambda msg: open('athena_debug.log', 'a').write(f"{msg}\n")
        fr = ctx.get("full_response", "")
        _dbg_fn(f"[FINALIZE] msg_id={message_id}, full_response len={len(fr)}, has_SECTION={'[SECTION:' in fr}")
        if fr:
            _dbg_fn(f"[FINALIZE] first 150: {fr[:150]}")

        try:
            metadata = {
                "graph_id": ctx.get("graph_id"),
                "block_types": [b.get("type") for b in ctx.get("blocks", [])],
                "blocks": ctx.get("blocks", []),
                "model": config.GROQ_SMART_MODEL,
                "total_tokens": estimate_tokens(ctx.get("full_response", "")),
            }
            execute(
                "INSERT INTO chat_history (session_id, thread_id, role, content, metadata) "
                "VALUES (%s, %s, 'assistant', %s, %s)",
                (ctx["session_id"], ctx["thread_id"], ctx.get("full_response", ""),
                 json.dumps(metadata))
            )
        except Exception as e:
            logger.error(f"Failed to store assistant message: {e}")
        finally:
            _active_streams.pop(message_id, None)

    # ── Intent Decomposer ──────────────────────────────────────────────────

    def _decompose_intent(self, message, graph_data):
        """Call Groq 8b for intent classification.
        Per ATHENA_CLAUDE.md Section 2.3.
        Falls back to keyword-based block selection when LLM unavailable."""

        # KEYWORD-BASED BLOCK SELECTION (works without LLM)
        # Maps user query patterns to the correct block types
        msg_lower = message.lower().strip()
        keyword_blocks = self._keyword_block_select(msg_lower, graph_data)

        if graph_data and graph_data.get('nodes'):
            seed_id = graph_data.get('metadata', {}).get('seed_paper_id', '')
            nodes = graph_data.get('nodes', [])

            # Build entity list based on intent
            entities = []
            intent_type = keyword_blocks.get("intent", "question")

            if intent_type == "comparison" and nodes:
                # For comparison: find 2 papers (seed + top cited non-seed)
                if seed_id:
                    entities.append({"paper_id": seed_id, "name": "seed paper"})
                # Find top cited paper that isn't the seed
                sorted_by_cites = sorted(nodes, key=lambda n: int(n.get('citation_count', 0) or 0), reverse=True)
                for n in sorted_by_cites:
                    nid = n.get('paper_id') or n.get('id', '')
                    if nid and nid != seed_id:
                        entities.append({"paper_id": nid, "name": (n.get('title', '') or '')[:40]})
                        break
                # Try to extract paper names from message using title words AND common aliases
                PAPER_ALIASES = {
                    'resnet': 'residual',
                    'vggnet': 'very deep convolutional',
                    'vgg': 'very deep convolutional',
                    'alexnet': 'imagenet classification with deep',
                    'googlenet': 'going deeper with convolutions',
                    'inception': 'going deeper with convolutions',
                    'lstm': 'long short-term memory',
                    'batch norm': 'batch normalization',
                    'batchnorm': 'batch normalization',
                    'faster rcnn': 'faster r-cnn',
                    'rcnn': 'rich feature hierarchies',
                    'r-cnn': 'rich feature hierarchies',
                    'backprop': 'backpropagation',
                    'svm': 'support-vector',
                    'coco': 'microsoft coco',
                }
                # Expand message with alias lookups
                expanded_terms = [msg_lower]
                for alias, expansion in PAPER_ALIASES.items():
                    if alias in msg_lower:
                        expanded_terms.append(expansion)

                existing_ids = set(e.get('paper_id') for e in entities)
                for n in nodes:
                    title = (n.get('title', '') or '').lower()
                    nid = n.get('paper_id') or n.get('id', '')
                    if nid in existing_ids:
                        continue
                    # Check expanded terms against title
                    matched = False
                    for term in expanded_terms:
                        title_words = [w for w in title.split() if len(w) > 4]
                        if any(w in term for w in title_words[:3]):
                            matched = True
                            break
                        # Also check if the expanded alias appears in the title
                        if term != msg_lower and term in title:
                            matched = True
                            break
                    if matched:
                        entities.append({"paper_id": nid, "name": (n.get('title', '') or '')[:40]})
                        existing_ids.add(nid)
                        if len(entities) >= 3:
                            break
            elif intent_type in ("exploration", "relationship", "deep_dive", "traversal") and seed_id:
                # For exploration (path/trace/connection queries): try to find mentioned papers
                PAPER_ALIASES = {
                    'resnet': 'residual', 'vggnet': 'very deep convolutional',
                    'vgg': 'very deep convolutional', 'alexnet': 'imagenet classification with deep',
                    'lstm': 'long short-term memory', 'batch norm': 'batch normalization',
                    'backprop': 'backpropagation', 'googlenet': 'going deeper',
                    'inception': 'going deeper', 'bert': 'bert',
                }
                expanded_terms = [msg_lower]
                for alias, expansion in PAPER_ALIASES.items():
                    if alias in msg_lower:
                        expanded_terms.append(expansion)

                # Find papers mentioned in the message
                # Use word-boundary matching to avoid false positives like
                # "direct" matching "directly" in "papers directly connected"
                import re as _re
                msg_words = set(_re.findall(r'\b[a-z]{3,}\b', msg_lower))
                for n in nodes:
                    title = (n.get('title', '') or '').lower()
                    nid = n.get('paper_id') or n.get('id', '')
                    if not nid:
                        continue
                    # Strategy 1: Check if distinctive title words appear as WHOLE WORDS
                    # in the user message (not substrings). Require 2+ matching words
                    # to avoid false positives from common words.
                    title_words = [w for w in _re.findall(r'\b[a-z]{4,}\b', title) if w not in {
                        'with', 'from', 'that', 'this', 'into', 'over', 'their',
                        'more', 'than', 'been', 'have', 'were', 'does', 'also',
                        'based', 'using', 'paper', 'approach', 'method', 'methods',
                        'model', 'models', 'learning', 'network', 'networks', 'deep',
                        'neural', 'image', 'images', 'recognition', 'detection',
                    }]
                    matching_words = [w for w in title_words[:6] if w in msg_words]
                    # Strategy 1a: 2+ matching words (standard threshold)
                    if len(matching_words) >= 2:
                        entities.append({"paper_id": nid, "name": (n.get('title', '') or '')[:40]})
                    # Strategy 1b: Single long distinctive word (7+ chars) — reduces false negatives
                    # for papers like "Deep Residual Learning" where stopwords remove all but "residual"
                    elif any(len(w) >= 7 for w in matching_words):
                        entities.append({"paper_id": nid, "name": (n.get('title', '') or '')[:40]})
                    # Strategy 2: Check expanded alias terms against title
                    elif expanded_terms:
                        for term in expanded_terms:
                            if term != msg_lower and term in title:
                                entities.append({"paper_id": nid, "name": (n.get('title', '') or '')[:40]})
                                break
                    if len(entities) >= 2:
                        break

                # Handle "oldest paper" by finding min year
                if 'oldest' in msg_lower:
                    oldest = min(nodes, key=lambda n: int(n.get('year', 9999) or 9999))
                    oid = oldest.get('paper_id') or oldest.get('id', '')
                    if oid and oid not in [e.get('paper_id') for e in entities]:
                        entities.insert(0, {"paper_id": oid, "name": (oldest.get('title', '') or '')[:40]})

                if not entities:
                    entities = [{"paper_id": seed_id, "name": "seed paper"}]
            elif seed_id:
                entities = [{"paper_id": seed_id, "name": "seed paper"}]

            default_intent = {
                "intent": intent_type,
                "complexity": keyword_blocks.get("complexity", "moderate"),
                "entities": entities,
                "data_needs": keyword_blocks.get("data_needs", ["pagerank", "cluster_info"]),
                "block_plan": keyword_blocks.get("block_plan", ["stat_grid", "prose"]),
                "mode_override": None,
                "model_selection": "70b",
                "reasoning_visible": False,
                "gemini_review": True,
                "skip_llm": keyword_blocks.get("skip_llm", False),
                "context_refs": [],
                # Phase C #005: Propagate command action if detected
                "command_action": keyword_blocks.get("command_action"),
                # Phase C #012: Propagate terminal command if detected
                "terminal_command": keyword_blocks.get("terminal_command"),
            }
        else:
            default_intent = {
                "intent": "question",
                "complexity": "moderate",
                "entities": [],
                "data_needs": [],
                "block_plan": ["prose"],
                "mode_override": None,
                "model_selection": "70b",
                "reasoning_visible": False,
                "gemini_review": True,
                "skip_llm": keyword_blocks.get("skip_llm", False),
                "context_refs": [],
                "command_action": keyword_blocks.get("command_action"),
                "terminal_command": keyword_blocks.get("terminal_command"),
            }

        # OPTIMIZATION: If keyword selector already determined a specific block plan
        # (not the generic "stat_grid + prose" default), skip the LLM decomposer call.
        # This saves 1 Groq call per message, doubling effective rate limit.
        kb_plan = keyword_blocks.get("block_plan", [])
        if kb_plan and kb_plan != ["stat_grid", "prose"] and graph_data:
            logger.info(f"[ATHENA] Keyword selector chose block_plan={kb_plan}, skipping LLM decomposer")
            return default_intent

        groq = self._get_groq()
        if not groq:
            return default_intent

        # Build template variables from graph data
        if graph_data:
            nodes = graph_data.get('nodes', [])
            edges = graph_data.get('edges', [])
            metadata = graph_data.get('metadata', {})
            years = [n.get('year') for n in nodes if n.get('year')]
            dna = graph_data.get('dna_json', {})
            clusters = []
            if isinstance(dna, dict):
                clusters = [c.get('label', c.get('name', '')) for c in dna.get('clusters', [])]

            template_vars = {
                "total_nodes": len(nodes),
                "total_edges": len(edges),
                "min_year": min(years) if years else "N/A",
                "max_year": max(years) if years else "N/A",
                "cluster_names": ', '.join(clusters[:8]) if clusters else "Not computed",
                "current_mode": "default",
                "recent_topics": "New conversation",
                "user_message": message,
            }
        else:
            template_vars = {
                "total_nodes": 0, "total_edges": 0,
                "min_year": "N/A", "max_year": "N/A",
                "cluster_names": "No graph loaded",
                "current_mode": "default",
                "recent_topics": "No graph context",
                "user_message": message,
            }

        try:
            resp = groq.chat.completions.create(
                model=config.GROQ_FAST_MODEL,
                messages=[{"role": "user", "content": INTENT_DECOMPOSER_PROMPT.format(**template_vars)}],
                max_tokens=200,
                temperature=0,
                response_format={"type": "json_object"},
            )
            result = json.loads(resp.choices[0].message.content)

            # Validate and merge with defaults
            for key in default_intent:
                if key not in result:
                    result[key] = default_intent[key]

            # CRITICAL FIX: If block_plan includes stat_grid, ensure data_needs
            # includes the minimum required fields that _assemble_stat_grid processes.
            # The LLM may return arbitrary data_needs that don't match assembler fields.
            if 'stat_grid' in (result.get('block_plan') or []):
                required_stat_needs = {'pagerank', 'cluster_info', 'descendants'}
                current_needs = set(result.get('data_needs') or [])
                result['data_needs'] = list(current_needs | required_stat_needs)

            # Similarly for paper_card
            if 'paper_card' in (result.get('block_plan') or []):
                current_needs = set(result.get('data_needs') or [])
                result['data_needs'] = list(current_needs | {'pagerank'})

            # Phase C #005: If LLM classified as command, add skip_llm
            if result.get('intent') == 'command' and result.get('command_action'):
                result['skip_llm'] = True
                result['block_plan'] = []

            return result

        except Exception as e:
            error_name = type(e).__name__
            logger.warning(f"Intent decomposition failed ({error_name}): {e}")
            # Rotate key on rate limit and retry once
            if 'RateLimit' in error_name or '429' in str(e):
                _groq_rotator.mark_rate_limited(cooldown_seconds=30)
                retry_groq = self._get_groq()
                if retry_groq:
                    try:
                        resp = retry_groq.chat.completions.create(
                            model=config.GROQ_FAST_MODEL,
                            messages=[{"role": "user", "content": INTENT_DECOMPOSER_PROMPT.format(**template_vars)}],
                            max_tokens=200, temperature=0,
                            response_format={"type": "json_object"},
                        )
                        result = json.loads(resp.choices[0].message.content)
                        for key in default_intent:
                            if key not in result:
                                result[key] = default_intent[key]
                        return result
                    except Exception as retry_e:
                        logger.warning(f"Intent decomposition retry failed: {retry_e}")
                        if 'RateLimit' in type(retry_e).__name__:
                            _groq_rotator.mark_rate_limited(cooldown_seconds=30)
            return default_intent

    # ── Keyword-Based Block Selection (no LLM needed) ──────────────────────

    def _detect_graph_command(self, msg_lower, graph_data=None, awareness=None):
        """Phase C #005: Detect graph manipulation commands.
        Returns intent dict with 'command_action' if detected, else None.
        Commands have HIGHEST priority per GAP C-54.

        graph_data: full graph JSON (for superlative resolution)
        awareness: dict with click_context, last_command_target etc.
        """
        import re

        # Common filler words to strip from command targets
        # NOTE: 'that', 'this', 'it' are NOT here — they're pronouns handled separately
        _cmd_filler = {'a', 'an', 'paper', 'node', 'papers', 'nodes',
                       'on', 'in', 'for', 'me', 'please', 'can', 'you'}

        # Zoom commands — flexible patterns:
        # "zoom to BERT", "zoom on BERT", "zoom in on BERT", "zoom that on the graph",
        # "focus on X", "center on X", "centre on X", "center the graph on X",
        # "go to X", "navigate to X", "can you zoom on X"
        zoom_patterns = [
            r'\b(?:can you |please )?(zoom\s+(?:to|into|onto|in\s+on|on|in\s+to))\s+(.+)',
            r'\b(?:can you |please )?(focus|center|centre)\s+(?:the\s+graph\s+)?on\s+(.+)',
            r'\b(?:can you |please )?(go\s+to|navigate\s+to)\s+(.+)',
            r'\b(?:can you |please )?zoom\s+(\S+)\s+on\s+(?:the\s+graph\b)?\s*()',  # "zoom that on the graph" → pronoun
        ]
        for zp in zoom_patterns:
            m = re.search(zp, msg_lower)
            if m:
                # For the "zoom that on the graph" pattern, target is the pronoun word
                if m.group(2).strip():
                    target = m.group(2).strip().rstrip('?.!')
                else:
                    # "zoom that on the graph" — pronoun is between zoom and on
                    pronoun_match = re.search(r'\bzoom\s+(\S+)\s+on\b', msg_lower)
                    target = pronoun_match.group(1) if pronoun_match else ''
                # Strip leading filler words but keep the core entity name intact
                words = target.split()
                while words and words[0] in _cmd_filler:
                    words.pop(0)
                target = ' '.join(words) if words else target
                target = self._resolve_command_target(target, "zoom", graph_data, awareness)
                if target:  # Only return if we have a resolved target
                    return {
                        "intent": "command", "block_plan": [],
                        "data_needs": [], "complexity": "simple",
                        "command_action": {"action": "zoom", "target": target},
                        "skip_llm": True,
                    }
                break  # Don't try more patterns if we matched but couldn't resolve

        # Highlight commands: "highlight BERT", "can you highlight X"
        # Skip if it's an annotation pattern ("mark X as Y")
        m = re.search(r'\b(?:can you |please )?(highlight|mark|emphasize)\s+(.+)', msg_lower)
        if m and ' as ' not in m.group(2):
            target = m.group(2).strip().rstrip('?.!')
            words = target.split()
            while words and words[0] in _cmd_filler:
                words.pop(0)
            target = ' '.join(words) if words else target
            target = self._resolve_command_target(target, "highlight", graph_data, awareness)
            return {
                "intent": "command", "block_plan": [],
                "data_needs": [], "complexity": "simple",
                "command_action": {"action": "highlight", "target": target},
                "skip_llm": True,
            }

        # "Show me" + superlative pattern → zoom to that specific paper
        # "show me the most cited paper", "show me the most impactful paper",
        # "show me the oldest paper", "show me the seed paper"
        # NOTE: "least cited" and "bottlenecks" are excluded — those are filter commands
        superlative_kws = r'(most cited|most impactful|highest impact|most important|most interesting|most influential|oldest|newest|most recent|seed|root|main)'
        m = re.search(r'\b(?:can you |please )?(?:show|find|where is|locate|zoom\s+(?:to|onto|on|into))\s+(?:me\s+)?(?:the\s+)?' + superlative_kws + r'\b', msg_lower)
        if m and graph_data:
            target = m.group(1).strip()
            resolved = self._resolve_command_target(target, "zoom", graph_data, awareness)
            if resolved and resolved != target:
                # Superlative was resolved to an actual paper — zoom to it
                return {
                    "intent": "command", "block_plan": [],
                    "data_needs": [], "complexity": "simple",
                    "command_action": {"action": "zoom", "target": resolved},
                    "skip_llm": True,
                }

        # Filter commands — broad patterns:
        # "filter to bottlenecks", "show only most cited", "show bottlenecks only",
        # "can you show bottlenecks only on the graph", "display only contradictions"
        filter_target = None
        if re.search(r'\b(filter\s+(?:to|by)|show\s+only|display\s+only)\s+(.+)', msg_lower):
            filter_target = re.search(r'\b(filter\s+(?:to|by)|show\s+only|display\s+only)\s+(.+)', msg_lower).group(2)
        elif re.search(r'\b(show|display)\b.+\b(only|just)\b', msg_lower):
            # "show bottlenecks only", "can you show bottlenecks only on the graph"
            m2 = re.search(r'\b(?:show|display)\s+(.+?)\s+(?:only|just)', msg_lower)
            if m2: filter_target = m2.group(1)
        elif re.search(r'\bonly\s+(bottleneck|most cited|least cited|contradiction|highest impact)', msg_lower):
            filter_target = re.search(r'\bonly\s+(\S+(?:\s+\S+)?)', msg_lower).group(1)
        elif re.search(r'\b(?:show|display|give)\b.*\b(bottlenecks?|contradictions?|most cited|least cited|highest impact)\b', msg_lower):
            # Catch-all: "show me those bottlenecks", "give me the contradictions"
            m3 = re.search(r'\b(bottlenecks?|contradictions?|most cited|least cited|highest impact)\b', msg_lower)
            if m3: filter_target = m3.group(1)

        if filter_target:
            # Strip filler words that get captured by broad regex patterns
            # e.g. "show me the bottlenecks only" → target was "me the bottlenecks"
            filler_words = {'me', 'the', 'a', 'an', 'can', 'you', 'just', 'please',
                           'on', 'in', 'for', 'with', 'some', 'all', 'of', 'those',
                           'these', 'that', 'this', 'papers', 'nodes', 'graph'}
            filter_target = filter_target.strip().rstrip('?.!') \
                .replace(' on the graph', '').replace(' in the graph', '') \
                .replace(' on graph', '').replace(' in graph', '').strip()
            # Remove filler words from the beginning of the target
            words = filter_target.split()
            cleaned = [w for w in words if w.lower() not in filler_words]
            filter_target = ' '.join(cleaned) if cleaned else filter_target
            return {
                "intent": "command", "block_plan": [],
                "data_needs": [], "complexity": "simple",
                "command_action": {"action": "filter", "target": filter_target},
                "skip_llm": True,
            }

        # Phase C #012: Annotation commands → suggest terminal syntax
        # "annotate ResNet as key paper", "mark this as bottleneck", "label BERT important"
        m = re.search(r'\b(?:annotate|tag)\s+(.+?)(?:\s+as\s+(.+))?$|(?:mark|label)\s+(.+?)\s+as\s+(.+)$', msg_lower)
        if m:
            target = (m.group(1) or m.group(3) or '').strip().rstrip('?.!')
            label = (m.group(2) or m.group(4) or '').strip().rstrip('?.!') or 'noted'
            words = target.split()
            while words and words[0] in _cmd_filler:
                words.pop(0)
            target = ' '.join(words) if words else target
            target = self._resolve_command_target(target, "highlight", graph_data, awareness)
            # Return a terminal suggestion instead of direct execution
            return {
                "intent": "terminal_suggest", "block_plan": [],
                "data_needs": [], "complexity": "simple",
                "terminal_command": f'annotate "{target}" as "{label[:20]}"',
                "skip_llm": True,
            }

        # "remove annotation from ResNet", "clear annotations"
        m2 = re.search(r'\b(?:remove|clear|delete)\s+(?:all\s+)?(?:annotations?|labels?|tags?)\s*(?:from\s+)?(.+)?', msg_lower)
        if m2:
            target = (m2.group(1) or '').strip().rstrip('?.!')
            if target:
                words = target.split()
                while words and words[0] in _cmd_filler:
                    words.pop(0)
                target = ' '.join(words) if words else target
                target = self._resolve_command_target(target, "highlight", graph_data, awareness)
            cmd = f'remove annotation "{target}"' if target else 'clear annotations'
            return {
                "intent": "terminal_suggest", "block_plan": [],
                "data_needs": [], "complexity": "simple",
                "terminal_command": cmd,
                "skip_llm": True,
            }

        # Reset commands: "reset the graph", "clear filters", "undo", "show all papers"
        if re.search(r'\b(reset|undo|clear\s+(?:filters?|all)|restore|go\s+back\s+to\s+(?:original|default|normal)|show\s+all\s+(?:papers|nodes)|recenter|recentre|remove\s+filters?)\b', msg_lower):
            return {
                "intent": "command", "block_plan": [],
                "data_needs": [], "complexity": "simple",
                "command_action": {"action": "reset", "target": ""},
                "skip_llm": True,
            }

        return None

    def _extract_first_mentioned_paper(self, llm_text, graph_data):
        """Extract the first paper title mentioned in an LLM response.
        Used for pronoun resolution: if LLM says 'Faster R-CNN is interesting',
        then 'zoom to that paper' should resolve to Faster R-CNN.

        Checks for [CITE:paper_id] patterns first, then title substring matches."""
        import re
        nodes = graph_data.get('nodes', [])
        if not nodes:
            return None

        # Check for [CITE:hex_id] patterns first (most reliable)
        cite_matches = re.findall(r'\[CITE:([a-f0-9]{10,})\]', llm_text)
        if cite_matches:
            cited_id = cite_matches[0]
            for n in nodes:
                nid = n.get('paper_id') or n.get('id', '')
                if nid == cited_id:
                    return n.get('title', '')

        # Fallback: find which graph paper title appears first in the text
        # (skip seed paper — it's mentioned in almost every response)
        seed_id = graph_data.get('metadata', {}).get('seed_paper_id', '')
        text_lower = llm_text.lower()
        best_pos = len(text_lower) + 1
        best_title = None
        for n in nodes:
            nid = n.get('paper_id') or n.get('id', '')
            if nid == seed_id:
                continue  # Skip seed — too common
            title = n.get('title', '')
            if not title or len(title) < 8:
                continue
            # Check first 30 chars of title (handles truncation)
            short_title = title[:30].lower()
            pos = text_lower.find(short_title)
            if pos >= 0 and pos < best_pos:
                best_pos = pos
                best_title = title

        return best_title

    def _resolve_command_target(self, target, action, graph_data=None, awareness=None):
        """Resolve pronouns and superlatives in command targets.

        Pronouns ("that", "it", "this", "this one") → resolve from:
          1. Last command target in this session
          2. Currently clicked paper from awareness context

        Superlatives ("most cited paper", "highest impact") → resolve from graph_data
          to the actual paper title for zoom/highlight commands.
        """
        if not target:
            return target

        target_lower = target.lower().strip()
        awareness = awareness or {}

        # ── Pronoun resolution ────────────────────────────────────────────
        pronouns = {'that', 'it', 'this', 'this one', 'that one', 'that paper',
                    'this paper', 'it too', 'same', 'same one', 'same paper'}
        if target_lower in pronouns:
            # Try 1: Last command target from this session
            last_target = awareness.get('last_command_target')
            if last_target:
                return last_target

            # Try 2: Currently clicked paper from awareness
            clicked = awareness.get('clicked_paper')
            if clicked and clicked.get('title'):
                return clicked['title']

            # Fallback: return as-is (frontend fuzzy matcher will try its best)
            return target

        # ── Superlative resolution (only for zoom/highlight, not filter) ──
        if action in ('zoom', 'highlight') and graph_data and graph_data.get('nodes'):
            nodes = graph_data['nodes']
            resolved = None

            if 'most cited' in target_lower:
                best = max(nodes, key=lambda n: int(n.get('citation_count', 0) or 0), default=None)
                if best:
                    resolved = best.get('title', '')

            elif 'least cited' in target_lower:
                non_zero = [n for n in nodes if int(n.get('citation_count', 0) or 0) > 0]
                best = min(non_zero, key=lambda n: int(n.get('citation_count', 0) or 0), default=None)
                if best:
                    resolved = best.get('title', '')

            elif 'highest impact' in target_lower or 'most important' in target_lower or 'most impactful' in target_lower:
                best = max(nodes, key=lambda n: float(n.get('pruning_impact', 0) or 0), default=None)
                if best:
                    resolved = best.get('title', '')

            elif 'most interesting' in target_lower or 'most influential' in target_lower:
                # "Most interesting" = highest citation count among NON-seed papers
                # (seed is obvious; "interesting" implies discovery of something less known)
                seed_id = graph_data.get('metadata', {}).get('seed_paper_id', '')
                non_seed = [n for n in nodes if (n.get('paper_id') or n.get('id', '')) != seed_id]
                best = max(non_seed, key=lambda n: int(n.get('citation_count', 0) or 0), default=None)
                if best:
                    resolved = best.get('title', '')

            elif 'oldest' in target_lower:
                with_year = [n for n in nodes if n.get('year')]
                best = min(with_year, key=lambda n: int(n.get('year', 9999)), default=None)
                if best:
                    resolved = best.get('title', '')

            elif 'newest' in target_lower or 'most recent' in target_lower:
                with_year = [n for n in nodes if n.get('year')]
                best = max(with_year, key=lambda n: int(n.get('year', 0)), default=None)
                if best:
                    resolved = best.get('title', '')

            elif 'seed' in target_lower or 'root' in target_lower or 'main' in target_lower:
                seed_id = graph_data.get('metadata', {}).get('seed_paper_id', '')
                if seed_id:
                    for n in nodes:
                        nid = n.get('paper_id') or n.get('id', '')
                        if nid == seed_id:
                            resolved = n.get('title', '')
                            break

            if resolved:
                return resolved

        return target

    def _keyword_block_select(self, msg_lower, graph_data):
        """Select appropriate blocks based on keywords in the user message.
        This runs WITHOUT any LLM call and ensures the correct block types
        render even when Groq is rate-limited.

        Returns dict with block_plan, intent, data_needs, complexity."""

        import re

        # Phase C #005: Graph commands — HIGHEST PRIORITY (GAP C-54)
        # BUT: skip command detection if message contains visualization/analysis keywords.
        # "show me a donut chart of the least cited" → donut chart, NOT filter command.
        # "give me a timeline of the most cited" → timeline, NOT zoom command.
        _viz_keywords = re.search(
            r'\b(chart|donut|pie|bar graph|bar chart|timeline|table|list all|'
            r'compare|comparison|breakdown|distribution|diagram|'
            r'visualization|visualize|visualise|'
            r'statistics|stats|analysis|analyze|analyse|explain|tell me about|'
            r'describe|what is|what are|who wrote|how does|how many|why)\b', msg_lower
        )
        if not _viz_keywords:
            graph_command = self._detect_graph_command(msg_lower, graph_data, self._current_awareness)
            if graph_command:
                return graph_command

        # Phase C #016: Deep Dive patterns
        # "deep dive on ResNet", "analyze ResNet in depth", "comprehensive analysis of X",
        # "/deepdive ResNet", "tell me everything about this paper"
        if re.search(r'\b(deep dive|deepdive|in-depth analysis|comprehensive analysis|full analysis|analyze.*in depth|everything about.*paper|detailed analysis)\b', msg_lower):
            return {
                "intent": "deep_dive",
                "block_plan": ["deep_dive"],
                "data_needs": ["pagerank", "cluster_info", "descendants"],
                "complexity": "complex",
                "model_selection": "70b",
            }

        # Phase C #034: Chat-Driven Graph Navigation (traversal)
        # "walk me through X's ancestry", "guide me through the lineage",
        # "trace the path from X to Y", "show me the journey from seed to X"
        if re.search(r'\b(walk me through|guide me through|trace the path|trace.*ancestry|trace.*lineage|navigate.*lineage|tour.*graph|walk.*lineage|journey.*from|step by step.*ancestry|guided tour)\b', msg_lower):
            return {
                "intent": "traversal",
                "block_plan": ["traversal"],
                "data_needs": ["pagerank", "cluster_info"],
                "complexity": "complex",
                "model_selection": "8b",
            }

        # Timeline patterns
        if re.search(r'\b(timeline|chronolog|evolution|history|over time|year by year|when were)\b', msg_lower):
            return {
                "intent": "exploration",
                "block_plan": ["timeline", "prose"],
                "data_needs": ["timeline_data"],
                "complexity": "moderate",
            }

        # Phase C #008: Pathfinder Integration — detect research positioning queries
        # Only trigger when asking about THEIR research positioning, not graph commands
        _pathfinder_patterns = re.search(
            r'\b(position(?:ing)?|where.+fit|place.+in.+lineage|novelty|'
            r'research gap|gap.+in.+literature|unique contribution|'
            r'differentiate.+from|how.+my.+paper|how.+our.+paper|'
            r'compare.+technical.+approach|where.+stand)\b', msg_lower
        )
        # Exclude graph commands that happen to contain "position" (e.g. "position this node")
        _graph_cmd_override = re.search(r'\b(zoom|highlight|filter|prune|trace|reset|show|display)\b', msg_lower)
        if _pathfinder_patterns and not _graph_cmd_override:
            return {
                "intent": "pathfinder_handoff",
                "block_plan": ["pathfinder_handoff", "prose"],
                "data_needs": [],
                "complexity": "simple",
                "skip_llm": True,
            }

        # Phase C #026: Relationship explainer patterns
        # "how are X and Y related", "explain the relationship between X and Y",
        # "what's the connection between X and Y", "how does X cite Y"
        if re.search(r'\b(relationship between|related to|connection between|how does.*cite|how are.*related|link between|edge between|explain.*relationship|explain.*connection)\b', msg_lower):
            return {
                "intent": "relationship",
                "block_plan": ["relationship_explainer", "prose"],
                "data_needs": ["pagerank", "cluster_info", "descendants"],
                "complexity": "complex",
                "model_selection": "70b",  # Default; overridden by confidence tier in assembler
            }

        # Comparison patterns
        if re.search(r'\b(compare|vs|versus|difference|side by side|contrast)\b', msg_lower):
            return {
                "intent": "comparison",
                "block_plan": ["comparison_card", "prose"],
                "data_needs": ["pagerank", "cluster_info", "descendants"],
                "complexity": "moderate",
            }

        # Table/list patterns
        if re.search(r'\b(table|list|top \d+|rank|all papers)\b', msg_lower):
            return {
                "intent": "question",
                "block_plan": ["data_table", "prose"],
                "data_needs": ["pagerank"],
                "complexity": "moderate",
            }

        # Chart/distribution patterns
        if re.search(r'\b(distribution|breakdown|pie|donut|field|proportion|percentage)\b', msg_lower):
            return {
                "intent": "question",
                "block_plan": ["mini_chart_donut", "prose"],
                "data_needs": ["field_distribution"],
                "complexity": "moderate",
            }

        # Bar chart patterns (BEFORE generic stat patterns so "bar" overrides stat_grid)
        if re.search(r'\b(bar\s*(graph|chart)?|in a bar|most cited.*chart|top.*papers.*chart|bar chart|most cited|top papers|ranking|leaderboard)\b', msg_lower):
            return {
                "intent": "question",
                "block_plan": ["mini_chart_bar", "prose"],
                "data_needs": ["pagerank"],
                "complexity": "moderate",
            }

        # Trend/sparkline patterns
        if re.search(r'\b(trend|citation trend|over the years|growth|decline)\b', msg_lower):
            return {
                "intent": "question",
                "block_plan": ["sparkline", "prose"],
                "data_needs": ["timeline_data"],
                "complexity": "moderate",
            }

        # Phase C #020: Edge/citation sentence patterns
        if re.search(r'\b(citation sentence|citing sentence|cited sentence|how does.*cite|how does.*reference|relationship between|edge between|mutation.*between|citation evidence)\b', msg_lower):
            return {
                "intent": "exploration",
                "block_plan": ["citation_evidence", "prose"],
                "data_needs": ["pagerank", "cluster_info"],
                "complexity": "moderate",
            }

        # Network/connection patterns
        if re.search(r'\b(network|connections|neighbors|connected|subgraph|cluster map)\b', msg_lower):
            return {
                "intent": "exploration",
                "block_plan": ["network_snippet", "prose"],
                "data_needs": ["pagerank", "cluster_info"],
                "complexity": "moderate",
            }

        # Heatmap patterns
        if re.search(r'\b(heatmap|mutation.*distribution|relationship types|edge types)\b', msg_lower):
            return {
                "intent": "question",
                "block_plan": ["heatmap", "prose"],
                "data_needs": ["mutation_types"],
                "complexity": "moderate",
            }

        # Tree/hierarchy patterns
        if re.search(r'\b(tree|hierarchy|ancestry|genealogy|family|descendants|ancestors)\b', msg_lower):
            return {
                "intent": "exploration",
                "block_plan": ["tree", "prose"],
                "data_needs": ["ancestors", "descendants"],
                "complexity": "moderate",
            }

        # Filter-related questions — show FILTER stat card, not seed paper stat card
        # Only matches when user explicitly references "filter" or "filtered"
        if re.search(r'\b(this filter|the filter|filtered|current filter|active filter)\b', msg_lower):
            return {
                "intent": "question",
                "block_plan": ["filter_stats", "prose"],
                "data_needs": ["filter_context"],
                "complexity": "moderate",
            }

        # Stats/numbers patterns
        if re.search(r'\b(stats|statistics|numbers|key metrics|overview|summary|how many)\b', msg_lower):
            return {
                "intent": "question",
                "block_plan": ["stat_grid", "prose"],
                "data_needs": ["pagerank", "cluster_info", "descendants"],
                "complexity": "moderate",
            }

        # Paper-specific patterns
        if re.search(r'\b(tell me about|what is|explain|describe)\b.*\b(paper|resnet|vggnet|alexnet|lstm|bert|imagenet|backprop)\b', msg_lower):
            return {
                "intent": "exploration",
                "block_plan": ["paper_card", "stat_grid", "prose"],
                "data_needs": ["pagerank", "pruning_impact", "cluster_info", "descendants"],
                "complexity": "moderate",
            }

        # Sankey/flow patterns
        if re.search(r'\b(sankey|flow|mutation.*intent|how.*papers.*flow|cluster.*flow)\b', msg_lower):
            return {
                "intent": "question",
                "block_plan": ["sankey", "prose"],
                "data_needs": ["mutation_types", "citation_intents"],
                "complexity": "moderate",
            }

        # Progress/percentage patterns
        if re.search(r'\b(progress|percentage|percent|proportion|ratio|coverage|how much|completion|data quality)\b', msg_lower):
            return {
                "intent": "question",
                "block_plan": ["progress_ring", "prose"],
                "data_needs": ["data_coverage"],
                "complexity": "moderate",
            }

        # Path/trace patterns — render mini SVG graph with highlighted path
        if re.search(r'\b(path between|path from|path to|connection between|how.*connect|link between|trace.*from.*to|show.*path)\b', msg_lower):
            return {
                "intent": "exploration",
                "block_plan": ["inline_mini_graph", "prose"],
                "data_needs": ["pagerank", "mutation_types"],
                "complexity": "moderate",
            }

        # JSON/data patterns
        if re.search(r'\b(json|raw data|export data|show.*data|paper data)\b', msg_lower):
            return {
                "intent": "question",
                "block_plan": ["json_data", "prose"],
                "data_needs": ["pagerank"],
                "complexity": "moderate",
            }

        # Code/programming patterns — prose only (LLM generates code blocks in markdown)
        if re.search(r'\b(code|python|sql|javascript|script|function|implement|algorithm|pseudo|snippet|programming|query)\b', msg_lower):
            return {
                "intent": "question",
                "block_plan": ["prose"],
                "data_needs": ["pagerank"],
                "complexity": "moderate",
            }

        # Default: prose only (stat_grid only when explicitly requested)
        return {
            "intent": "question",
            "block_plan": ["prose"],
            "data_needs": ["pagerank", "cluster_info"],
            "complexity": "moderate",
        }

    # ── Gemini Prose Fallback (Tier 4) ─────────────────────────────────────

    # ── Pathfinder Caller (Phase C #008) ────────────────────────────────────

    def _call_pathfinder(self, ctx, graph_id, query):
        """Call Pathfinder endpoint internally and stream results.
        Per ATHENA_PHASE_C.md Feature 12: HTTP API boundary only."""
        import requests as _req

        full_response = "[PATHFINDER_ANALYSIS]\n"
        try:
            # Call Pathfinder via internal HTTP (same server)
            resp = _req.post(
                f"http://localhost:{__import__('os').environ.get('PORT', '5000')}/api/graph/{graph_id}/pathfinder-prompt",
                json={"source": "athena", "prompt": query},
                cookies={"arivu_session": ctx.get("session_id", "")},
                timeout=30,
            )

            if resp.status_code == 200:
                data = resp.json()
                blocks = data.get("blocks", [])

                # Render each Pathfinder block as prose sections
                for block in blocks:
                    block_type = block.get("type", "")
                    section_text = ""

                    if block_type == "position_section":
                        section_text = "**Research Position**\n\n"
                        cp = block.get("closestPaper", {})
                        if cp:
                            section_text += f"Closest paper: **{cp.get('title', '?')}** ({cp.get('year', '?')})\n"
                        if block.get("matchScore"):
                            section_text += f"Match score: {block['matchScore']}\n"
                        if block.get("relationship"):
                            rel = block["relationship"]
                            if isinstance(rel, str):
                                section_text += f"\n{rel}\n"

                    elif block_type == "landscape_section":
                        section_text = "**Research Landscape**\n\n"
                        gap = block.get("gap")
                        if gap:
                            section_text += f"Gap: {gap if isinstance(gap, str) else str(gap)}\n"
                        comps = block.get("competitors", [])
                        if comps:
                            section_text += "\nRelated work:\n"
                            for c in comps[:5]:
                                title = c.get("title", c.get("name", str(c)))
                                section_text += f"- {title}\n"

                    elif block_type == "roadmap_section":
                        section_text = "**Research Roadmap**\n\n"
                        papers = block.get("papers", [])
                        for i, p in enumerate(papers[:8], 1):
                            section_text += f"{i}. **{p.get('title', '?')}** ({p.get('year', '?')})"
                            if p.get("reason"):
                                section_text += f" — {p['reason']}"
                            section_text += "\n"

                    elif block_type == "citation_section":
                        section_text = "**Citation Strategy**\n\n"
                        must = block.get("mustCite", [])
                        if must:
                            section_text += "Must cite:\n"
                            for p in must[:5]:
                                section_text += f"- {p.get('title', p.get('name', str(p)))}\n"
                        should = block.get("shouldCite", [])
                        if should:
                            section_text += "\nShould cite:\n"
                            for p in should[:5]:
                                section_text += f"- {p.get('title', p.get('name', str(p)))}\n"

                    if section_text:
                        full_response += section_text + "\n"
                        yield {"id": self._next_event_id(), "type": "prose",
                               "data": {"content": section_text, "provenance": "computed"}}

                if not blocks:
                    msg = "Pathfinder analysis complete but returned no structured blocks."
                    full_response = msg
                    yield {"id": self._next_event_id(), "type": "prose",
                           "data": {"content": msg, "provenance": "computed"}}

            else:
                error_msg = f"*Pathfinder returned an error (HTTP {resp.status_code}). Falling back to Athena analysis.*\n"
                full_response = error_msg
                yield {"id": self._next_event_id(), "type": "prose",
                       "data": {"content": error_msg, "provenance": "computed"}}

        except Exception as e:
            logger.warning(f"Pathfinder call failed: {e}")
            error_msg = "*Pathfinder is temporarily unavailable. Please try again later.*\n"
            full_response = error_msg
            yield {"id": self._next_event_id(), "type": "prose",
                   "data": {"content": error_msg, "provenance": "computed"}}

        ctx["full_response"] = full_response
        ctx["status"] = "complete"

        yield {"id": self._next_event_id(), "type": "done",
               "data": {"total_tokens": 0, "model": "pathfinder",
                        "grounding_report": {}, "footnotes": [],
                        "full_text": full_response}}

    # ── Traversal Generator (Phase C #034) ──────────────────────────────────

    def _generate_traversal(self, ctx, intent, graph_data):
        """Generate a step-by-step guided traversal through the graph.
        Sends the full traversal plan as a single event, then the frontend
        executes each step with zoom + highlight + narration animations.
        Per ATHENA_PHASE_C.md Feature 11."""
        import networkx as nx
        from backend.athena_blocks import DataAssemblyEngine

        engine = DataAssemblyEngine(graph_data)
        entities = intent.get('entities', [])
        seed_id = graph_data.get('metadata', {}).get('seed_paper_id', '')

        # Determine start and end papers
        start_id = seed_id
        end_id = entities[0].get('paper_id', '') if entities else ''

        # If user mentioned a specific paper, trace from seed to that paper
        # Otherwise trace from seed along the highest-impact path
        if not end_id or end_id == seed_id:
            # Find the highest-PageRank non-seed paper as the destination
            sorted_by_pr = sorted(engine.pagerank.items(), key=lambda x: x[1], reverse=True)
            for pid, score in sorted_by_pr:
                if pid != seed_id:
                    end_id = pid
                    break

        if not end_id or not engine.nx_graph:
            yield {"id": self._next_event_id(), "type": "error",
                   "data": {"message": "Could not build a traversal path.", "recoverable": True}}
            return

        # Build a multi-stop guided tour through the most important papers
        # Instead of shortest path A→B (often just 1 hop), visit top-N papers
        # ordered by a mix of PageRank and citation count for a meaningful tour.
        #
        # Strategy: Start at seed, then visit papers sorted by importance,
        # preferring those connected to the previous stop.
        sorted_papers = sorted(
            engine.pagerank.items(),
            key=lambda x: (x[1] * 0.6) + (int(engine.nodes.get(x[0], {}).get('citation_count', 0) or 0) / 300000 * 0.4),
            reverse=True
        )

        # Pick top 6 non-seed papers as tour stops
        # Filter: must have a real title and year
        tour_stops = [start_id]
        visited = {start_id}
        for pid, score in sorted_papers:
            if pid in visited:
                continue
            p = engine.nodes.get(pid, {})
            title = (p.get('title', '') or '').strip()
            if not title or len(title) < 5 or not p.get('year'):
                continue  # Skip papers with missing/broken data
            tour_stops.append(pid)
            visited.add(pid)
            if len(tour_stops) >= 7:  # seed + 6 stops = 7 total
                break

        # If user mentioned a specific paper, make sure it's included
        if end_id and end_id != start_id and end_id not in visited:
            tour_stops.insert(1, end_id)  # Visit it early
            if len(tour_stops) > 7:
                tour_stops = tour_stops[:7]

        path = tour_stops

        if len(path) < 2:
            yield {"id": self._next_event_id(), "type": "error",
                   "data": {"message": "Not enough papers to build a tour.", "recoverable": True}}
            return

        # Build traversal steps with narrations
        edges = graph_data.get('edges', [])
        edge_map = {}
        for e in edges:
            key = f"{e.get('source', '')}:{e.get('target', '')}"
            edge_map[key] = e
            rev_key = f"{e.get('target', '')}:{e.get('source', '')}"
            edge_map[rev_key] = e

        steps = []
        for i, paper_id in enumerate(path):
            paper = engine.nodes.get(paper_id, {})
            title = paper.get('title', 'Unknown')
            year = paper.get('year', '')

            from_id = path[i - 1] if i > 0 else None
            edge_id = f"{from_id}:{paper_id}" if from_id else None
            edge_data = edge_map.get(edge_id, {}) if edge_id else {}
            mutation = edge_data.get('mutation_type', '')

            # Build computed fallback narration first
            if i == 0:
                narration = f"We begin at **{title}** ({year}), with {int(paper.get('citation_count', 0) or 0):,} citations."
            else:
                from_paper = engine.nodes.get(from_id, {})
                from_title = from_paper.get('title', 'previous paper')
                if mutation and mutation != 'incidental':
                    narration = f"Moving to **{title}** ({year}) — a {mutation} of {from_title[:30]}."
                else:
                    narration = f"Next: **{title}** ({year}), cited by {from_title[:30]}."

            steps.append({
                "step_index": i,
                "from_paper_id": from_id,
                "to_paper_id": paper_id,
                "to_title": title,
                "to_year": year,
                "edge_id": edge_id,
                "mutation_type": mutation,
                "narration": narration,
            })

        # Batch-generate LLM narrations in ONE call (instead of per-step)
        try:
            groq = self._get_groq()
            if groq:
                step_descriptions = []
                for s in steps:
                    if s["step_index"] == 0:
                        step_descriptions.append(f"Step {s['step_index']+1}: Start at \"{s['to_title']}\" ({s['to_year']}), {int(engine.nodes.get(s['to_paper_id'], {}).get('citation_count', 0) or 0):,} citations.")
                    else:
                        from_t = engine.nodes.get(s['from_paper_id'], {}).get('title', '?')[:35]
                        step_descriptions.append(f"Step {s['step_index']+1}: From \"{from_t}\" to \"{s['to_title']}\" ({s['to_year']}), connection: {s['mutation_type'] or 'citation'}.")

                prompt = (
                    f"You are narrating a guided tour through a research paper lineage graph.\n"
                    f"Write ONE sentence (15-25 words) per step. Be specific. Use **bold** for paper names.\n\n"
                    + "\n".join(step_descriptions)
                    + "\n\nFormat: one line per step, starting with 'Step N:'"
                )
                resp = groq.chat.completions.create(
                    model=config.GROQ_FAST_MODEL,
                    messages=[
                        {"role": "system", "content": "You narrate research paper lineage tours. Write exactly one concise sentence per step. Use **bold** for paper names."},
                        {"role": "user", "content": prompt},
                    ],
                    max_tokens=400,
                    temperature=0.7,
                )
                llm_text = resp.choices[0].message.content or ""
                # Parse per-step narrations from LLM response
                for line in llm_text.strip().split("\n"):
                    line = line.strip()
                    if not line:
                        continue
                    for s in steps:
                        marker = f"Step {s['step_index']+1}:"
                        if line.startswith(marker):
                            s["narration"] = line[len(marker):].strip()
                            break
        except Exception as e:
            logger.warning(f"Batch traversal narration failed: {e}")
            # Keep computed fallback narrations

        # Emit the full traversal plan
        plan = {
            "type": "traversal",
            "seed_paper_id": seed_id,
            "steps": steps,
            "total_steps": len(steps),
        }

        yield {"id": self._next_event_id(), "type": "traversal_plan",
               "data": plan}

        # Build storable content with [TRAVERSAL_STEP:N] markers for history restoration
        stored_content = "[TRAVERSAL]\n"
        for s in steps:
            stored_content += f"[TRAVERSAL_STEP:{s['step_index']+1}]{s['narration']}\n"

        # Don't emit a separate prose summary — the traversal_plan event handler
        # in the frontend already creates numbered step divs during animation.
        ctx["full_response"] = stored_content
        ctx["status"] = "complete"

        # Store in DB with traversal markers
        try:
            execute(
                "INSERT INTO chat_history (session_id, thread_id, role, content, metadata) "
                "VALUES (%s, %s, 'assistant', %s, %s)",
                (ctx["session_id"], ctx.get("thread_id", "main"), stored_content,
                 json.dumps({"graph_id": ctx.get("graph_id"), "traversal": True,
                             "traversal_plan": json.dumps(plan)}))
            )
        except Exception:
            pass

        yield {"id": self._next_event_id(), "type": "done",
               "data": {"total_tokens": 0, "model": "none",
                        "grounding_report": {}, "footnotes": [],
                        "full_text": summary}}

    def _traversal_step_narration(self, to_title, from_title, mutation, paper):
        """Generate a 1-sentence LLM narration for a traversal step."""
        try:
            groq = self._get_groq()
            if not groq:
                return ""
            resp = groq.chat.completions.create(
                model=config.GROQ_FAST_MODEL,
                messages=[
                    {"role": "system", "content": "You are narrating a guided tour through a research paper lineage. Write exactly ONE sentence (15-25 words) describing how this paper connects to the previous one. Be specific and grounded."},
                    {"role": "user", "content": f'Paper: "{to_title}" connects from "{from_title}" via {mutation or "citation"}. Citations: {int(paper.get("citation_count", 0) or 0):,}.'},
                ],
                max_tokens=60,
                temperature=0.7,
            )
            return resp.choices[0].message.content.strip() or ""
        except Exception:
            return ""

    # ── Deep Dive Generator (Phase C #016) ─────────────────────────────────

    def _generate_deep_dive(self, ctx, intent, graph_data, context_stack):
        """Generate a 6-section deep dive analysis for a paper.
        Yields SSE events: section_start, block, prose, done.
        Per ATHENA_PHASE_C.md Feature 10 and ATHENA_FEATURES.md #016."""
        import networkx as nx
        from backend.athena_blocks import DataAssemblyEngine

        entities = intent.get('entities', [])
        paper_id = entities[0].get('paper_id', '') if entities else ''
        if not paper_id:
            yield {"id": self._next_event_id(), "type": "error",
                   "data": {"message": "Could not identify which paper to analyze. Please specify a paper name.", "recoverable": True}}
            return

        engine = DataAssemblyEngine(graph_data)
        paper = engine.nodes.get(paper_id, {})
        title = paper.get('title', 'Unknown Paper')

        # Gather all edge data for this paper
        edges = graph_data.get('edges', [])
        incoming = [e for e in edges if e.get('target') == paper_id]
        outgoing = [e for e in edges if e.get('source') == paper_id]

        # Gather structural data
        pr_score = engine.pagerank.get(paper_id, 0)
        sorted_pr = sorted(engine.pagerank.values(), reverse=True)
        pr_rank = (sorted_pr.index(pr_score) + 1) if pr_score in sorted_pr else len(sorted_pr)
        total_papers = len(engine.pagerank)

        # Descendants
        descendants = set()
        if engine.nx_graph and paper_id in engine.nx_graph:
            try:
                descendants = set(nx.descendants(engine.nx_graph.reverse(), paper_id))
            except Exception:
                pass

        # Pruning impact
        pruning = graph_data.get('precomputed_pruning', {}).get(paper_id, {})
        pruning_impact = paper.get('pruning_impact', 0)
        collapsed_count = pruning.get('collapsed_count', 0)

        full_response = ""

        # ── Section 1: Paper Overview (COMPUTED ONLY) ─────────────────
        full_response += "[SECTION:1:Paper Overview]\n"
        _dd_dbg = lambda msg: open('athena_debug.log', 'a').write(f"{msg}\n")
        _dd_dbg(f"[DD] After S1 marker: full_response starts with: {full_response[:60]!r}")
        yield {"id": self._next_event_id(), "type": "section_start",
               "data": {"section": 1, "title": "Paper Overview"}}

        overview = f"**{title}**"
        if paper.get('year'):
            overview += f" ({paper['year']})"
        overview += "\n\n"
        authors = paper.get('authors', [])
        if authors:
            author_str = ', '.join(authors[:5])
            if len(authors) > 5:
                author_str += f' +{len(authors) - 5} more'
            overview += f"**Authors:** {author_str}\n"
        overview += f"**Citations:** {int(paper.get('citation_count', 0) or 0):,}\n"
        overview += f"**PageRank:** #{pr_rank} of {total_papers} (score: {pr_score:.4f})\n"
        overview += f"**Direct references:** {len(outgoing)} papers cited\n"
        overview += f"**Cited by:** {len(incoming)} papers in this graph\n"
        if paper.get('is_bottleneck'):
            overview += f"**Bottleneck:** Yes — critical structural node\n"
        if paper.get('fields_of_study'):
            overview += f"**Fields:** {', '.join(paper['fields_of_study'][:4])}\n"
        overview += f"**Data quality:** Text tier {paper.get('text_tier', 4)}\n"

        full_response += overview
        yield {"id": self._next_event_id(), "type": "prose",
               "data": {"content": overview, "provenance": "computed"}}

        # ── Section 2: Ancestry Analysis (LLM) ────────────────────────
        full_response += "[SECTION:2:Ancestry Analysis]\n"
        yield {"id": self._next_event_id(), "type": "section_start",
               "data": {"section": 2, "title": "Ancestry Analysis"}}

        # Computed intro
        ancestry_computed = f"This paper cites {len(outgoing)} papers in the graph"
        parent_titles = []
        for e in outgoing[:8]:
            tgt = e.get('target', '')
            p = engine.nodes.get(tgt, {})
            parent_titles.append(f"{p.get('title', '?')[:40]} ({e.get('mutation_type', 'incidental')})")
        if parent_titles:
            ancestry_computed += ":\n" + "\n".join(f"- {t}" for t in parent_titles)
        ancestry_computed += "\n\n"

        full_response += ancestry_computed
        yield {"id": self._next_event_id(), "type": "prose",
               "data": {"content": ancestry_computed, "provenance": "computed"}}

        # LLM narrative for ancestry
        ancestry_prose = self._deep_dive_llm_section(
            f"Analyze the ancestry/lineage of \"{title}\". It cites these papers: {', '.join(parent_titles[:6])}. "
            f"What intellectual traditions does it draw from? (2-3 sentences, grounded in the data)",
            ctx
        )
        if ancestry_prose:
            full_response += ancestry_prose
            yield {"id": self._next_event_id(), "type": "prose",
                   "data": {"content": ancestry_prose, "provenance": "interpreted"}}

        # ── Section 3: Descendant Impact (COMPUTED ONLY) ──────────────
        full_response += "[SECTION:3:Descendant Impact]\n"
        yield {"id": self._next_event_id(), "type": "section_start",
               "data": {"section": 3, "title": "Descendant Impact"}}

        desc_text = f"**Descendants:** {len(descendants)} papers build on this work\n"
        desc_text += f"**Cited by in graph:** {len(incoming)} direct citations\n"
        desc_text += f"**Pruning impact:** {pruning_impact}% of graph would collapse\n"
        if collapsed_count:
            desc_text += f"**Papers that exclusively depend on this:** {collapsed_count}\n"

        full_response += desc_text
        yield {"id": self._next_event_id(), "type": "prose",
               "data": {"content": desc_text, "provenance": "computed"}}

        # ── Section 4: Mutation Pattern (LLM) ─────────────────────────
        full_response += "[SECTION:4:Mutation Pattern]\n"
        yield {"id": self._next_event_id(), "type": "section_start",
               "data": {"section": 4, "title": "Mutation Pattern"}}

        # Compute mutation type distribution
        in_mutations = {}
        for e in incoming:
            mt = e.get('mutation_type', 'incidental')
            in_mutations[mt] = in_mutations.get(mt, 0) + 1
        out_mutations = {}
        for e in outgoing:
            mt = e.get('mutation_type', 'incidental')
            out_mutations[mt] = out_mutations.get(mt, 0) + 1

        mut_text = "**Incoming edge types** (how others cite this paper):\n"
        for mt, cnt in sorted(in_mutations.items(), key=lambda x: -x[1]):
            mut_text += f"- {mt}: {cnt}\n"
        mut_text += f"\n**Outgoing edge types** (how this paper cites others):\n"
        for mt, cnt in sorted(out_mutations.items(), key=lambda x: -x[1]):
            mut_text += f"- {mt}: {cnt}\n"
        mut_text += "\n"

        full_response += mut_text
        yield {"id": self._next_event_id(), "type": "prose",
               "data": {"content": mut_text, "provenance": "computed"}}

        # LLM narrative for mutation patterns
        mut_prose = self._deep_dive_llm_section(
            f"Interpret the mutation pattern for \"{title}\". Incoming: {dict(in_mutations)}. Outgoing: {dict(out_mutations)}. "
            f"What does this tell us about how the paper's ideas were used? (2-3 sentences)",
            ctx
        )
        if mut_prose:
            full_response += mut_prose
            yield {"id": self._next_event_id(), "type": "prose",
                   "data": {"content": mut_prose, "provenance": "interpreted"}}

        # ── Section 5: Structural Position (COMPUTED ONLY) ────────────
        full_response += "[SECTION:5:Structural Position]\n"
        yield {"id": self._next_event_id(), "type": "section_start",
               "data": {"section": 5, "title": "Structural Position"}}

        # Betweenness centrality
        betweenness = 0
        try:
            if engine.nx_graph:
                bc = nx.betweenness_centrality(engine.nx_graph)
                betweenness = bc.get(paper_id, 0)
        except Exception:
            pass

        struct_text = f"**PageRank:** #{pr_rank} of {total_papers} (score: {pr_score:.4f})\n"
        struct_text += f"**Betweenness centrality:** {betweenness:.4f}\n"
        struct_text += f"**BFS depth:** {paper.get('depth', '?')}\n"
        struct_text += f"**Bottleneck:** {'Yes' if paper.get('is_bottleneck') else 'No'}\n"
        struct_text += f"**Is seed paper:** {'Yes' if paper.get('is_seed') else 'No'}\n"

        full_response += struct_text
        yield {"id": self._next_event_id(), "type": "prose",
               "data": {"content": struct_text, "provenance": "computed"}}

        # ── Section 6: Research Implications (LLM) ────────────────────
        full_response += "[SECTION:6:Research Implications]\n"
        yield {"id": self._next_event_id(), "type": "section_start",
               "data": {"section": 6, "title": "Research Implications"}}

        impl_prose = self._deep_dive_llm_section(
            f"Based on the structural analysis of \"{title}\": PageRank #{pr_rank}/{total_papers}, "
            f"{len(descendants)} descendants, {len(incoming)} citations in graph, "
            f"bottleneck={paper.get('is_bottleneck', False)}, pruning impact={pruning_impact}%. "
            f"What are the research implications? What does this paper's position tell us about the field? (3-4 sentences)",
            ctx
        )
        if impl_prose:
            full_response += impl_prose
            yield {"id": self._next_event_id(), "type": "prose",
                   "data": {"content": impl_prose, "provenance": "interpreted"}}

        # Store response directly (finalize_response may not always run for deep dives)
        _dd_dbg(f"[DD] Before store: full_response len={len(full_response)}, has_SECTION={'[SECTION:' in full_response}")
        _dd_dbg(f"[DD] First 100: {full_response[:100]!r}")
        ctx["full_response"] = full_response
        ctx["status"] = "complete"
        try:
            execute(
                "INSERT INTO chat_history (session_id, thread_id, role, content, metadata) "
                "VALUES (%s, %s, 'assistant', %s, %s)",
                (ctx["session_id"], ctx.get("thread_id", "main"), full_response,
                 json.dumps({"graph_id": ctx.get("graph_id"), "deep_dive": True}))
            )
        except Exception as e:
            logger.error(f"Failed to store deep dive response: {e}")

        # Follow-ups
        followups = [
            f'Compare "{title[:30]}" with its most cited ancestor',
            f'Show me the papers that cite "{title[:30]}"',
            f'What would collapse if "{title[:25]}" never existed?',
        ]
        yield {"id": self._next_event_id(), "type": "followups",
               "data": {"suggestions": followups}}

        yield {"id": self._next_event_id(), "type": "done",
               "data": {"total_tokens": 0, "model": config.GROQ_FAST_MODEL,
                        "grounding_report": {}, "footnotes": [],
                        "full_text": full_response}}

    def _deep_dive_llm_section(self, prompt, ctx):
        """Generate a single LLM section for deep dive. Returns prose string or empty."""
        try:
            groq = self._get_groq()
            if not groq:
                return ""
            # Use 8b for deep dive sections to conserve 70b quota
            resp = groq.chat.completions.create(
                model=config.GROQ_FAST_MODEL,
                messages=[
                    {"role": "system", "content": "You are a research analysis assistant. Be concise and grounded in the data provided. Do not invent data."},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=300,
                temperature=0.7,
            )
            return resp.choices[0].message.content or ""
        except Exception as e:
            logger.warning(f"Deep dive LLM section failed: {e}")
            return "*Narrative analysis unavailable for this section.*\n"

    def _gemini_prose_fallback(self, context_stack):
        """Generate prose using Gemini when all Groq keys are rate-limited.
        Gemini Flash 2.0 has 15 req/min free tier - much more generous.
        Returns prose string or None on failure."""
        try:
            gemini = self._get_gemini()
            if not gemini:
                return None

            # Convert context stack to a single prompt for Gemini
            system_parts = []
            user_msg = ""
            for msg in context_stack:
                if msg["role"] == "system":
                    system_parts.append(msg["content"])
                elif msg["role"] == "user":
                    user_msg = msg["content"]
                elif msg["role"] == "assistant":
                    system_parts.append(f"Previous assistant response: {msg['content'][:200]}")

            combined_prompt = "\n\n".join(system_parts) + f"\n\nUser question: {user_msg}\n\nProvide a concise analysis (2-3 paragraphs). Use ONLY the data provided above. No emojis. No em dashes."

            result = gemini.generate(combined_prompt)
            if result:
                logger.info(f"Gemini fallback generated {len(result)} chars of prose")
                return result
            return None
        except Exception as e:
            logger.warning(f"Gemini prose fallback failed: {e}")
            return None

    # ── LLM Response Cache ────────────────────────────────────────────────

    def _check_prose_cache(self, message, graph_id):
        """Check llm_cache for a cached prose response."""
        import hashlib
        key = hashlib.sha256(f"athena_prose:{graph_id}:{message}".encode()).hexdigest()
        try:
            row = fetchone(
                "SELECT response FROM llm_cache WHERE cache_key = %s AND created_at > NOW() - INTERVAL '7 days'",
                (key,)
            )
            if row and row.get('response'):
                logger.info(f"Cache HIT for prose: {key[:12]}...")
                return row['response']
        except Exception:
            pass
        return None

    def _store_prose_cache(self, message, graph_id, response):
        """Store prose response in llm_cache for future reuse."""
        import hashlib
        key = hashlib.sha256(f"athena_prose:{graph_id}:{message}".encode()).hexdigest()
        try:
            execute(
                "INSERT INTO llm_cache (cache_key, model, system_prompt, user_prompt, response) "
                "VALUES (%s, %s, %s, %s, %s) ON CONFLICT (cache_key) DO UPDATE SET response = EXCLUDED.response, created_at = NOW()",
                (key, "athena_prose", graph_id or "", message, response)
            )
        except Exception as e:
            logger.warning(f"Failed to cache prose: {e}")

    # ── Async Gemini Check ─────────────────────────────────────────────────

    def _async_gemini_check(self, message_id, session_id, question, response, graph_data):
        """Background thread: Gemini quality check. Non-blocking.
        Per ATHENA_PHASE_A.md Section 2.1.24."""
        try:
            gemini = self._get_gemini()
            if not gemini:
                return
            result = gemini.quality_check_sync(question, response, graph_data)
            if result.get("action") in ("correct", "enrich"):
                _active_streams[f"enrich_{message_id}"] = result
                logger.info(f"Gemini enrichment ready: {result.get('action')}")
        except Exception as e:
            logger.warning(f"Gemini async check failed: {e}")

    # ── FIX #6: Block Marker Parsing ───────────────────────────────────────

    def _parse_block_marker(self, marker, graph_data, content=None):
        """Parse [BLOCK:type:key=value,...] into block data.
        Called when the LLM outputs block markers during streaming.
        content: text between [BLOCK:...] and [/BLOCK] tags.

        Supports formats:
          [BLOCK:type:key1=val1,key2=val2]
          [BLOCK:type:key1=val1:key2=val2]   (colon-separated params)
          [BLOCK:type:params] content [/BLOCK]  (multiline)
        """
        m = re.match(r'\[BLOCK:(\w+)(?::(.+))?\]', marker)
        if not m:
            return None
        block_type = m.group(1)
        params_str = m.group(2) or ""
        params = {}
        # Split by comma or colon, then parse key=value pairs
        # Use regex to split by , or : that are NOT inside values
        for pair in re.split(r'[,:]', params_str):
            pair = pair.strip()
            if '=' in pair:
                k, v = pair.split('=', 1)
                params[k.strip()] = v.strip()
            elif pair:
                # Bare value without key -- store as positional
                params.setdefault('_positional', []).append(pair)

        try:
            from backend.athena_blocks import DataAssemblyEngine
            engine = DataAssemblyEngine(graph_data) if graph_data else None
            paper_id = params.get('paper_id')

            if block_type == 'paper_card' and paper_id and engine:
                return engine._assemble_paper_card(paper_id)
            elif block_type == 'stat_grid' and paper_id and engine:
                return engine._assemble_stat_grid(paper_id, ['pagerank', 'pruning_impact'])
            elif block_type == 'quote':
                # Quote block with LLM-generated content
                text = (content or '').strip().strip('"').strip("'")
                return {"type": "quote", "provenance": "interpreted",
                        "data": {"text": text, "source": params.get("paper_id", ""),
                                 "paper_id": params.get("paper_id", "")}}
            elif block_type == 'warning':
                text = content or params.get("message", "")
                return {"type": "warning", "provenance": "interpreted",
                        "data": {"level": params.get("level", "warn"),
                                 "message": text, "detail": ""}}
            elif block_type == 'expandable':
                return {"type": "expandable", "provenance": "interpreted",
                        "data": {"title": params.get("title", "More details"),
                                 "content": content or "", "expanded_default": False}}
            else:
                data = dict(params)
                if content:
                    data["content"] = content
                return {"type": block_type, "provenance": "interpreted", "data": data}
        except Exception as e:
            logger.warning(f"Block marker parse failed: {e}")
            return None

    # ── Graph Data Loading ─────────────────────────────────────────────────

    def _load_graph(self, graph_id):
        """Load full graph JSON from DB + R2.
        The graphs table stores graph_json_url (R2 key), not inline JSON.
        We fetch the JSON from R2, then attach intel/dna/diversity from DB."""
        if not graph_id:
            return None
        try:
            row = fetchone(
                "SELECT graph_json_url, dna_json, diversity_json, leaderboard_json, intel_json "
                "FROM graphs WHERE graph_id = %s",
                (graph_id,)
            )
            if not row or not row.get('graph_json_url'):
                # Try lookup by seed_paper_id (graph_id might be the paper ID)
                row = fetchone(
                    "SELECT graph_json_url, dna_json, diversity_json, leaderboard_json, intel_json "
                    "FROM graphs WHERE seed_paper_id = %s ORDER BY last_accessed DESC LIMIT 1",
                    (graph_id,)
                )
            if not row or not row.get('graph_json_url'):
                logger.warning(f"No graph found for id={graph_id}")
                return None

            # Fetch graph JSON from R2 (or local cache)
            from backend.r2_client import R2Client
            graph = R2Client().download_json(row['graph_json_url'])
            if not graph:
                logger.warning(f"Failed to download graph from R2: {row['graph_json_url']}")
                return None

            # Attach pre-computed intelligence data from DB columns
            for key in ('intel_json', 'dna_json', 'diversity_json', 'leaderboard_json'):
                val = row.get(key)
                if val:
                    graph[key] = json.loads(val) if isinstance(val, str) else val

            return graph
        except Exception as e:
            logger.error(f"Failed to load graph {graph_id}: {e}")
            return None

    # ── Conversation Memory Loading ────────────────────────────────────────

    def _load_memory(self, session_id, thread_id):
        """Load recent conversation for context.
        Per ATHENA_PHASE_A.md Section 2.1.24."""
        try:
            rows = fetchall(
                "SELECT role, content FROM chat_history "
                "WHERE session_id = %s AND thread_id = %s "
                "ORDER BY created_at DESC LIMIT 10",
                (session_id, thread_id)
            )
            return list(reversed(rows)) if rows else []
        except Exception as e:
            logger.warning(f"Failed to load memory: {e}")
            return []

    # ── Enrichment Polling ─────────────────────────────────────────────────

    def get_enrichment(self, message_id):
        """Check if Gemini enrichment is available for a message.
        Called by frontend polling after 'done' event."""
        key = f"enrich_{message_id}"
        result = _active_streams.pop(key, None)
        return result


# ══════════════════════════════════════════════════════════════════════════════
# B-23/B-24: Citation and Footnote Processing
# Per ATHENA_PHASE_B.md Section 2.1.8
# ══════════════════════════════════════════════════════════════════════════════

def process_citations(llm_text, graph_data):
    """Parse [CITE:paper_id] markers and produce numbered citations.

    Returns:
        processed_text: text with markers replaced by [N] references
        footnotes: list of {index, paper_id, title} dicts
    """
    import re
    # Build paper lookup from graph nodes
    papers = {}
    for node in graph_data.get('nodes', []):
        pid = node.get('paper_id', '')
        if pid:
            papers[pid] = node

    pattern = r'\[CITE:([a-f0-9]+)\]'
    seen = {}
    footnotes = []
    counter = [0]

    def replace_cite(match):
        paper_id = match.group(1)
        paper = papers.get(paper_id)
        if not paper:
            return ''  # Strip invalid citation
        if paper_id not in seen:
            counter[0] += 1
            seen[paper_id] = counter[0]
            authors = paper.get('authors', [])
            author_str = authors[0] + ' et al.' if len(authors) > 1 else (authors[0] if authors else '')
            footnotes.append({
                'index': counter[0],
                'paper_id': paper_id,
                'title': paper.get('title', 'Unknown'),
                'year': paper.get('year'),
                'authors': author_str,
            })
        return f'[{seen[paper_id]}]'

    processed_text = re.sub(pattern, replace_cite, llm_text)

    # Also strip [BLOCK:...] markers if any (per Section 2.1.1)
    processed_text = re.sub(r'\[BLOCK:\w+(?::[^\]]+)?\]', '', processed_text)
    processed_text = re.sub(r'\[/BLOCK:\w+\]', '', processed_text)

    return processed_text, footnotes


# ══════════════════════════════════════════════════════════════════════════════
# B-29: Follow-up Suggestion Generation
# Per ATHENA_PHASE_B.md Section 2.1.14
# ══════════════════════════════════════════════════════════════════════════════

def generate_followups(intent_result, graph_data, response_blocks, memory):
    """Generate 2-4 context-aware follow-up suggestions.

    Args:
        intent_result: dict with entities, intent, etc.
        graph_data: full graph JSON with nodes and edges.
        response_blocks: list of block dicts that were sent in this response.
        memory: conversation history list (from _load_memory).

    Returns:
        list of 2-4 suggestion strings.
    """
    suggestions = []
    entities = intent_result.get('entities', [])
    shown_blocks = [b.get('type') for b in (response_blocks or [])]
    block_plan = intent_result.get('block_plan', [])

    # Collect discussed paper IDs from memory to avoid repeating
    discussed_ids = set()
    discussed_topics = set()
    # Include the CURRENT message's topics too
    current_msg = intent_result.get('_user_message', '')
    if isinstance(current_msg, str):
        for keyword in ['timeline', 'compare', 'pruning', 'bar', 'heatmap', 'coverage', 'stats', 'sparkline', 'donut', 'field', 'tree', 'hierarchy', 'network']:
            if keyword in current_msg.lower():
                discussed_topics.add(keyword)
    # Also include what block types were just shown
    for bt in shown_blocks:
        discussed_topics.add(bt)
    if isinstance(memory, list):
        for m in memory:
            content = m.get('content', '')
            meta = m.get('metadata')
            if isinstance(meta, str):
                try:
                    meta = json.loads(meta)
                except Exception:
                    meta = {}
            if isinstance(meta, dict):
                for pid in meta.get('paper_ids', []):
                    discussed_ids.add(pid)
            # Track discussed topics from past messages
            if isinstance(content, str):
                for keyword in ['timeline', 'compare', 'pruning', 'bar', 'heatmap', 'coverage', 'stats', 'sparkline', 'donut']:
                    if keyword in content.lower():
                        discussed_topics.add(keyword)

    # Strategy 1: Response-specific deepening based on what blocks were shown
    if 'stat_grid' in shown_blocks:
        if entities:
            name = (entities[0].get('name', entities[0].get('title', 'this paper')) or 'this paper')[:35]
            suggestions.append(f"Show {name} in a bar chart compared to others")
        else:
            suggestions.append("Show me a bar chart of the most cited papers")
    elif 'mini_chart_bar' in shown_blocks:
        suggestions.append("What would collapse if the top paper were removed?")
    elif 'heatmap' in shown_blocks:
        suggestions.append("Which mutation type is most common and why?")
    elif 'sparkline' in shown_blocks:
        suggestions.append("What happened during the biggest citation spike?")
    elif 'progress_ring' in shown_blocks:
        suggestions.append("Which papers have full text and which are title-only?")
    elif 'timeline' in shown_blocks:
        suggestions.append("What were the key turning points in this timeline?")

    # Strategy 2: Unexplored neighbor from graph (context-specific)
    if graph_data and graph_data.get('nodes'):
        nodes = graph_data.get('nodes', [])
        edges = graph_data.get('edges', [])
        entity_pid = entities[0].get('paper_id', '') if entities else ''

        if entity_pid:
            # Find a connected paper not yet discussed
            for edge in edges[:200]:
                other = None
                if (edge.get('citing_paper_id') or edge.get('source', '')) == entity_pid:
                    other = edge.get('cited_paper_id') or edge.get('target', '')
                elif (edge.get('cited_paper_id') or edge.get('target', '')) == entity_pid:
                    other = edge.get('citing_paper_id') or edge.get('source', '')
                if other and other not in discussed_ids:
                    for node in nodes:
                        nid = node.get('paper_id') or node.get('id', '')
                        if nid == other:
                            title = (node.get('title', 'Unknown') or 'Unknown')[:35]
                            suggestions.append(f"Tell me about \"{title}\"")
                            break
                    break
        else:
            # No specific entity -- suggest exploring the most important paper
            try:
                import networkx as nx
                G = nx.DiGraph()
                for n in nodes:
                    G.add_node(n.get('paper_id') or n.get('id', ''))
                for e in edges:
                    s = e.get('citing_paper_id') or e.get('source', '')
                    t = e.get('cited_paper_id') or e.get('target', '')
                    if s and t:
                        G.add_edge(s, t)
                if G.nodes:
                    pr = nx.pagerank(G, alpha=0.85)
                    top_id = max(pr, key=pr.get)
                    if top_id not in discussed_ids:
                        for node in nodes:
                            if (node.get('paper_id') or node.get('id', '')) == top_id:
                                title = (node.get('title', 'Unknown') or 'Unknown')[:35]
                                suggestions.append(f"What makes \"{title}\" the most influential?")
                                break
            except Exception:
                pass

    # Strategy 3: Complementary visualization NOT yet shown or discussed
    viz_suggestions = []
    if 'timeline' not in shown_blocks and 'timeline' not in discussed_topics:
        viz_suggestions.append("Show me the research timeline")
    if 'heatmap' not in shown_blocks and 'heatmap' not in discussed_topics:
        viz_suggestions.append("Show a heatmap of mutation types vs confidence")
    if 'mini_chart_bar' not in shown_blocks and 'bar' not in discussed_topics:
        viz_suggestions.append("Show a bar chart of the most cited papers")
    if 'progress_ring' not in shown_blocks and 'coverage' not in discussed_topics:
        viz_suggestions.append("What percentage of papers have full text?")

    # Add at most 1 complementary viz suggestion
    if viz_suggestions and len(suggestions) < 3:
        suggestions.append(viz_suggestions[0])

    # Strategy 4: Pruning invitation (if not already discussed)
    if 'pruning' not in discussed_topics:
        if entities:
            paper_name = (entities[0].get('name', entities[0].get('title', 'this paper')) or 'this paper')[:30]
            suggestions.append(f"What would collapse if \"{paper_name}\" never existed?")
        elif graph_data:
            seed_title = graph_data.get('metadata', {}).get('seed_paper_title', '')
            if seed_title:
                suggestions.append(f"What would collapse if \"{seed_title[:30]}\" never existed?")

    return suggestions[:4]


# Module-level singleton
orchestrator = AthenaOrchestrator()
