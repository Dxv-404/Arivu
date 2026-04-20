"""
backend/athena_context.py

Context Stack Assembler for the Athena LLM Orchestrator.
Builds the 8-layer context stack per ATHENA_CLAUDE.md Part 2.4.

Layers:
  0: System Identity (ATHENA_SYSTEM_PROMPT)
  1: Graph Data (compact summary)
  2: Graph Awareness (click/zoom/filter/prune state)
  3: Graph Intelligence (pre-computed insights)
  4: Conversation Memory (last 10 + summary)
  5: Active Mode (if not default)
  6: Session Profile (adaptive preferences)
  7: Immediate Trigger (user message)
"""

import json
import logging

from backend.config import config

logger = logging.getLogger(__name__)

# ── System Prompt (Layer 0) ──────────────────────────────────────────────────
# Per ATHENA_CLAUDE.md Section 2.4 (exact text)

ATHENA_SYSTEM_PROMPT = """You are Athena, the research intelligence assistant for Arivu.
You help researchers understand academic paper citation lineages.

YOUR RULES:
1. Every number you state MUST come from the COMPUTED DATA provided in this conversation.
   Do not invent statistics. Do not recall numbers from training data. If you want to state
   a number that is not in the computed data, prefix it with "Based on general knowledge: "
2. Do not use emojis. Ever. Not even one.
3. Do not use em dashes. Use commas, periods, or semicolons instead.
4. Be concise. Researchers value density over verbosity. 2-3 paragraphs max unless
   the user asks for depth.
5. When referencing papers, use the format: Title (Author, Year). Example: "Deep Residual
   Learning for Image Recognition (He et al., 2016)"
6. When stating computed metrics, be specific: "PageRank rank #3 of 601 papers (score: 0.043)"
   not "one of the most important papers."
7. Focus on STRUCTURAL SIGNIFICANCE from the graph, not general importance from training data.
   "Removing ResNet collapses 31% of the lineage" is better than "ResNet was influential."
8. When you are uncertain, say so. "The graph data suggests..." is better than asserting.
9. If asked about something not in the graph, clearly state: "This paper/topic is not in
   the current lineage. I can only analyze papers present in this graph."
10. Address the user as a peer researcher, not a student. No condescension.

RICH FORMATTING (the system renders these as visual blocks automatically):
11. When quoting a paper's finding or a citing sentence, use:
    [BLOCK:quote:paper_id=PAPER_ID_HERE]The exact quoted text[/BLOCK]
12. When warning about low confidence, retracted papers, or data limitations:
    [BLOCK:warning:level=warn]Your warning message[/BLOCK]
13. When referencing a specific paper inline, use [CITE:Paper Title (Author, Year)]
    and the system will render it as a styled citation chip. Example:
    [CITE:Deep Residual Learning for Image Recognition (He et al., 2016)]
    Use this for every paper you mention by name.
14. For code or formulas, use markdown: ```python for code, $formula$ for equations.
15. For optional extra detail or visual diagrams, use expandable blocks:
    [BLOCK:expandable:title=Section Title]Content here[/BLOCK]
    The system auto-generates visual diagrams when the title contains keywords like
    "Timeline", "Network Diagram", "Distribution Chart", "Hierarchy Tree".
    Example: [BLOCK:expandable:title=Research Timeline]Key papers in order[/BLOCK]
    will render an actual interactive timeline from computed graph data."""

NO_GRAPH_ADDENDUM = """
No research graph is currently loaded. You can only provide general research guidance.
Clearly state that your responses are based on general knowledge, not computed analysis."""

# ── Intent Decomposer Prompt ─────────────────────────────────────────────────
# Per ATHENA_CLAUDE.md Section 2.3

INTENT_DECOMPOSER_PROMPT = """You are the intent decomposer for Athena, a research
intelligence chat system. Given a user message and conversation context, output a JSON
analysis that routes the message to the correct processing pipeline.

CONTEXT ABOUT THIS SYSTEM:
- Athena analyzes academic paper citation lineages (ancestry graphs)
- The user is exploring a graph with {total_nodes} papers and {total_edges} edges
- The graph spans {min_year} to {max_year}
- Research clusters: {cluster_names}
- Currently active mode: {current_mode}
- User's recent topics: {recent_topics}

AVAILABLE INTENTS:
- question: Direct factual question answerable from graph data
- exploration: Wants depth on a specific entity
- comparison: Wants 2-3 things compared
- command: User wants to MANIPULATE the graph visually. This includes:
  * zoom/focus/navigate to a paper ("zoom to BERT", "i want to see the LSTM paper", "take me to batch norm")
  * highlight a node ("highlight ResNet", "can you mark the important paper")
  * filter the view ("show only bottlenecks", "i want to see contradictions", "can you filter to most cited")
  * reset/clear ("reset the graph", "clear all filters", "show all papers again")
  When intent is "command", also include "command_action" in the JSON with: {"action": "zoom|highlight|filter|reset", "target": "paper name or filter type"}
- mode_switch: Wants to change conversation mode
- artifact: Wants a document generated
- follow_up: References previous message
- meta: About the tool itself, off-topic, greetings
- pathfinder: Research positioning query
- multimodal: Involves an uploaded file or image

COMPLEXITY LEVELS:
- simple: Answerable from graph data alone, no LLM needed
- moderate: Needs LLM prose but standard analysis
- complex: Needs deep multi-block analysis

DATA NEEDS (list ALL that apply):
pagerank, pruning_impact, cluster_info, ancestors, descendants, mutation_types,
citation_intents, contradiction_edges, bridging_papers, orphan_ideas, timeline_data,
author_stats, field_distribution, text_tier, dna_profile, diversity_scores

BLOCK TYPES (list the response blocks needed):
paper_card, stat_grid, comparison_card, timeline, data_table, prose

USER MESSAGE: "{user_message}"

Output ONLY valid JSON. No explanation. No prose."""


def estimate_tokens(text):
    """Approximate token count. 1 token ~ 4 characters for English text.
    Per ATHENA_PHASE_A.md Section 2.1.8."""
    if not text:
        return 0
    return len(text) // 4


def enforce_budget(stack, max_input_tokens=None):
    """Trim the context stack to fit within INPUT budget.
    Removes conversation messages in PAIRS (user+assistant together).
    Never removes system layers.
    Per ATHENA_PHASE_A.md Section 2.1.8."""
    if max_input_tokens is None:
        max_input_tokens = config.ATHENA_MAX_TOKENS - 2000  # Reserve 2000 for output

    total = sum(estimate_tokens(msg.get('content', '')) for msg in stack)

    # Find boundary: everything before first user/assistant message is system context
    first_conv_idx = next(
        (i for i, m in enumerate(stack) if m['role'] in ('user', 'assistant')),
        len(stack)
    )

    while total > max_input_tokens:
        removed_any = False
        for i in range(first_conv_idx, len(stack) - 2):
            if (stack[i]['role'] == 'user' and
                    i + 1 < len(stack) and
                    stack[i + 1]['role'] == 'assistant'):
                total -= estimate_tokens(stack[i]['content']) + estimate_tokens(stack[i + 1]['content'])
                stack.pop(i + 1)
                stack.pop(i)
                removed_any = True
                break
        if not removed_any:
            break

    return stack


def build_graph_summary(graph_data):
    """Build compact graph summary for Layer 1. ~800 tokens max."""
    if not graph_data:
        return ""

    nodes = graph_data.get('nodes', [])
    edges = graph_data.get('edges', [])
    metadata = graph_data.get('metadata', {})

    # Top 15 papers by PageRank (per ATHENA_CLAUDE.md Part 2.4 Layer 1)
    # PageRank emphasizes structural importance, Arivu's core differentiator
    import networkx as nx
    G = nx.DiGraph()
    for n in nodes:
        G.add_node(n.get('paper_id', ''))
    for e in edges:
        G.add_edge(e.get('citing_paper_id', ''), e.get('cited_paper_id', ''))
    pr = nx.pagerank(G, alpha=0.85) if G.nodes else {}
    sorted_nodes = sorted(nodes, key=lambda n: pr.get(n.get('paper_id', ''), 0), reverse=True)
    top_papers = sorted_nodes[:15]

    # Cluster names from DNA profile
    dna = graph_data.get('dna_json', {})
    clusters = []
    if isinstance(dna, dict):
        for c in dna.get('clusters', []):
            name = c.get('label', c.get('name', 'Unknown'))
            size = c.get('size', len(c.get('papers', [])))
            clusters.append(f"{name} ({size} papers)")

    # Year range
    years = [n.get('year') for n in nodes if n.get('year')]
    min_year = min(years) if years else 'N/A'
    max_year = max(years) if years else 'N/A'

    # Contradiction count
    contradictions = sum(1 for e in edges if e.get('mutation_type') == 'contradiction')

    summary = f"""Graph: {metadata.get('seed_paper_title', 'Unknown')} lineage
Total: {len(nodes)} papers, {len(edges)} edges, spanning {min_year}-{max_year}
Contradictions: {contradictions}
Clusters: {', '.join(clusters[:8]) if clusters else 'Not computed'}

Top papers by citations:
"""
    for i, p in enumerate(top_papers, 1):
        title = p.get('title', 'Unknown')[:60]
        year = p.get('year', '?')
        cites = p.get('citation_count', 0)
        summary += f"  {i}. {title} ({year}) - {cites:,} citations\n"

    return summary.strip()


def format_awareness(awareness_state):
    """Format graph awareness state for Layer 2. ~200 tokens max.
    Phase C #105: Enhanced with cluster, PageRank, depth for nodes; mutation evidence for edges."""
    if not awareness_state:
        return ""

    parts = []

    # Phase C #105: Enriched node click context
    if awareness_state.get('clicked_paper'):
        p = awareness_state['clicked_paper']
        line = f"User is examining: \"{p.get('title', 'Unknown')}\" ({p.get('year', '?')})"
        extras = []
        if p.get('cluster_name'):
            extras.append(f"cluster: {p['cluster_name']}")
        if p.get('pagerank_score') is not None:
            extras.append(f"PageRank: {p['pagerank_score']:.4f}")
        if p.get('depth') is not None:
            extras.append(f"depth: {p['depth']}")
        if p.get('citation_count'):
            extras.append(f"citations: {p['citation_count']}")
        if extras:
            line += f" [{', '.join(extras)}]"
        parts.append(line)

    # Phase C #105: Edge click context with mutation evidence
    if awareness_state.get('clicked_edge'):
        e = awareness_state['clicked_edge']
        line = (f"User is examining edge: \"{e.get('citing_title', '?')}\" -> "
                f"\"{e.get('cited_title', '?')}\". "
                f"Mutation: {e.get('mutation_type', '?')} "
                f"(confidence: {e.get('mutation_confidence', '?')}). "
                f"Intent: {e.get('citation_intent', '?')}.")
        if e.get('citing_sentence'):
            line += f" Citing sentence: \"{e['citing_sentence'][:120]}\"."
        if e.get('cited_sentence'):
            line += f" Cited sentence: \"{e['cited_sentence'][:120]}\"."
        parts.append(line)

    # Phase C #106: Enriched zoom context with visible count and cluster focus
    if awareness_state.get('zoom_level'):
        level = awareness_state['zoom_level']
        count = awareness_state.get('zoom_visible_count', '')
        cluster = awareness_state.get('zoom_cluster_focus', '')
        if level == 'overview':
            line = "User is viewing the full graph overview"
        elif level == 'detail':
            line = f"User is zoomed into {count} papers" if count else "User is zoomed into a few nodes"
        else:
            line = f"User is viewing {count} papers at normal zoom" if count else "User is at normal zoom level"
        if cluster:
            line += f", focused on the \"{cluster}\" cluster"
        parts.append(line)

    # Phase C #107: Enhanced filter context with visible/hidden counts
    if awareness_state.get('active_filters'):
        filters = awareness_state['active_filters']
        filter_names = []
        for f in filters:
            if isinstance(f, dict):
                filter_names.append(f.get('value', str(f)))
            else:
                filter_names.append(str(f))
        line = f"Active filter: {', '.join(filter_names)}"
        vis = awareness_state.get('filter_visible_count')
        hid = awareness_state.get('filter_hidden_count')
        if vis is not None and hid is not None:
            line += f" (showing ~{vis} papers, {hid} dimmed)"
        parts.append(line)

    # Phase C #108: Enhanced prune context with collapsed/surviving details
    if awareness_state.get('prune_state') == 'active':
        p = awareness_state.get('pruned_paper', 'Unknown')
        impact = awareness_state.get('prune_impact', '?')
        count = awareness_state.get('prune_collapsed_count', '?')
        line = f"PRUNING ACTIVE: \"{p}\" removed from history. {impact}% of lineage collapsed ({count} papers removed)."

        dependents = awareness_state.get('prune_direct_dependents')
        if dependents:
            line += f" Direct dependents that collapsed: {', '.join(str(d) for d in dependents[:5])}."

        survivors = awareness_state.get('prune_survivors')
        if survivors:
            surv_parts = []
            for s in survivors[:3]:
                title = s.get('title', '?')
                path = s.get('path', [])
                if path:
                    surv_parts.append(f"\"{title}\" (survived via {' -> '.join(str(p) for p in path[:4])})")
                else:
                    surv_parts.append(f"\"{title}\"")
            if surv_parts:
                line += f" Key survivors: {'; '.join(surv_parts)}."

        parts.append(line)

    return '\n'.join(parts)


def get_session_history_context(session_id):
    """Phase C #109: Build session history summary from action_log.
    Returns a formatted string for Layer 2 context injection (~200 tokens max).
    Queries the most recent 10 meaningful actions (excludes hover/scroll/zoom noise).
    Per ATHENA_PHASE_C.md Section 4 Feature 5 and GAP C-50."""
    if not session_id:
        return ""

    try:
        from backend.db import fetchall
        rows = fetchall(
            "SELECT action_type, action_data FROM action_log "
            "WHERE session_id = %s AND action_type IN "
            "('node_click', 'prune', 'discuss', 'command', 'mode_change', 'search', 'graph_build_start', 'athena_chat') "
            "ORDER BY timestamp DESC LIMIT 10",
            (session_id,)
        )
        if not rows:
            return ""

        # Build summary from actions
        explored_papers = set()
        prune_history = []
        actions_desc = []

        for row in reversed(rows):  # Chronological order (oldest first)
            atype = row.get('action_type', '')
            adata = row.get('action_data') or {}

            if atype == 'node_click':
                title = adata.get('title', adata.get('paper_title', ''))
                if title:
                    explored_papers.add(title[:40])

            elif atype == 'prune':
                paper = adata.get('paper_title', adata.get('paper_ids', ['?'])[0] if isinstance(adata.get('paper_ids'), list) else '?')
                impact = adata.get('impact_percentage', '?')
                prune_history.append(f"{paper} ({impact}% collapsed)")

            elif atype == 'discuss':
                title = adata.get('paper_title', '')
                if title:
                    explored_papers.add(title[:40])
                    actions_desc.append(f"discussed {title[:30]}")

            elif atype == 'command':
                cmd = adata.get('command', '')
                if cmd:
                    actions_desc.append(f"ran {cmd} command")

            elif atype == 'search':
                query = adata.get('query', '')
                if query:
                    actions_desc.append(f"searched for \"{query[:25]}\"")

            elif atype == 'athena_chat':
                msg = adata.get('message', '')
                if msg:
                    actions_desc.append(f"asked: \"{msg[:30]}\"")

        parts = []
        if explored_papers:
            if len(explored_papers) <= 5:
                parts.append(f"Papers explored: {', '.join(explored_papers)}")
            else:
                parts.append(f"Explored {len(explored_papers)} papers including {', '.join(list(explored_papers)[:3])}")

        if prune_history:
            parts.append(f"Pruning history: {'; '.join(prune_history[:3])}")

        if actions_desc:
            parts.append(f"Recent actions: {', '.join(actions_desc[:5])}")

        if not parts:
            return ""

        summary = ". ".join(parts) + "."
        # Enforce ~200 token budget (roughly 800 chars)
        if len(summary) > 800:
            summary = summary[:797] + "..."

        return f"SESSION HISTORY: {summary} Do not repeat information already covered. Suggest unexplored areas when appropriate."

    except Exception as e:
        logger.warning(f"Failed to build session history context: {e}")
        return ""


def format_intel(intel_json):
    """Format pre-computed intelligence for Layer 3. ~300 tokens max."""
    if not intel_json or not isinstance(intel_json, dict):
        return ""

    parts = []
    if intel_json.get('top_authors'):
        authors = intel_json['top_authors'][:5]
        parts.append("Top authors: " + ', '.join(
            f"{a.get('name', '?')} ({a.get('paper_count', '?')} papers)"
            for a in authors
        ))

    if intel_json.get('bottleneck_summary'):
        parts.append(f"Key bottleneck: {intel_json['bottleneck_summary']}")

    if intel_json.get('contradiction_summary'):
        parts.append(f"Contradictions: {intel_json['contradiction_summary']}")

    return '\n'.join(parts)


def format_profile(profile):
    """Format session profile for Layer 6. ~100 tokens max."""
    if not profile:
        return ""
    if hasattr(profile, 'to_context_string'):
        return profile.to_context_string()
    return ""


def assemble_context_stack(session_id, graph_data, user_message, memory, mode="default",
                           awareness=None, profile=None):
    """Assemble the 8-layer context stack for LLM calls.
    Per ATHENA_CLAUDE.md Part 2.2 and ATHENA_PHASE_A.md Section 2.1.8.

    Args:
        session_id: Current session ID
        graph_data: Full graph JSON dict or None
        user_message: The user's message text
        memory: List of recent message dicts [{role, content}, ...]
        mode: Active conversation mode ID (default="default")
        awareness: Graph awareness state dict or None
        profile: SessionProfile instance or None

    Returns:
        List of message dicts ready for LLM API call
    """
    stack = []

    # Layer 0: System Identity (~200 tokens)
    system_prompt = ATHENA_SYSTEM_PROMPT
    if not graph_data:
        system_prompt += NO_GRAPH_ADDENDUM
    stack.append({"role": "system", "content": system_prompt})

    # Layer 1: Graph Data (~800 tokens)
    if graph_data:
        graph_summary = build_graph_summary(graph_data)
        if graph_summary:
            stack.append({"role": "system", "content": f"GRAPH DATA:\n{graph_summary}"})

    # Layer 2: Graph Awareness (~200 tokens)
    if awareness:
        awareness_text = format_awareness(awareness)
        if awareness_text:
            stack.append({"role": "system", "content": f"CURRENT STATE:\n{awareness_text}"})

    # Layer 2b: Session History (~200 tokens) — Phase C #109
    session_history = get_session_history_context(session_id)
    if session_history:
        stack.append({"role": "system", "content": session_history})

    # Layer 3: Graph Intelligence (~300 tokens)
    if graph_data and graph_data.get('intel_json'):
        intel_text = format_intel(graph_data['intel_json'])
        if intel_text:
            stack.append({"role": "system", "content": f"PRE-COMPUTED INSIGHTS:\n{intel_text}"})

    # Layer 4: Conversation Memory (~2000 tokens)
    if memory:
        for msg in memory:
            if isinstance(msg, dict) and 'role' in msg and 'content' in msg:
                stack.append({"role": msg['role'], "content": msg['content']})

    # Layer 5: Active Mode (~100 tokens)
    if mode and mode != "default":
        # Mode prompts added by Phase E. Stub for Phase A.
        stack.append({"role": "system", "content": f"Active mode: {mode}"})

    # Layer 6: Session Profile (~100 tokens)
    if profile:
        profile_text = format_profile(profile)
        if profile_text:
            stack.append({"role": "system", "content": f"USER PROFILE:\n{profile_text}"})

    # Layer 7: Immediate Trigger (user message)
    stack.append({"role": "user", "content": user_message})

    # Enforce token budget
    stack = enforce_budget(stack)

    return stack
