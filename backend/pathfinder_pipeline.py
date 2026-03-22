"""
backend/pathfinder_pipeline.py
3-Stage Pathfinder Pipeline: Classify → Select Tools → Generate Narratives → Assemble

Stage 1: Classify the user's prompt (fast model, 1 word output)
Stage 2: Select visual tools and identify data needs (fast model, JSON output)
Stage 3: Generate narrative prose with quality rules (smart model, JSON output)
Stage 4: Assemble structured output from graph data + LLM narratives (deterministic)
"""

import json
import math
import logging
import re

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════
# STAGE 1: CLASSIFY
# ═══════════════════════════════════════════════════════════════════════════

def stage1_classify(groq_client, config, prompt_text, context):
    """Classify the user's prompt into one of 7 categories."""

    seed_title = context.get('seed_title', 'Unknown')
    seed_year = context.get('seed_year', '')
    seed_authors = context.get('seed_authors', '')
    total_nodes = context.get('total_nodes', 0)
    total_edges = context.get('total_edges', 0)
    min_year = context.get('min_year', '')
    max_year = context.get('max_year', '')
    cluster_names = context.get('cluster_names', [])
    seed_fields = context.get('seed_fields', [])
    seed_citations = context.get('seed_citations', 0)
    prev_count = context.get('previous_prompt_count', 0)
    last_prompt = context.get('last_prompt_text', '')
    last_type = context.get('last_prompt_type', '')
    has_position = context.get('has_position', False)
    position_summary = context.get('position_summary', '')

    classify_prompt = f"""You are the intent classifier for Arivu's Pathfinder system.

ABOUT THIS SYSTEM:
Arivu analyzes academic paper lineages. The user is exploring the ancestry of "{seed_title}" by {seed_authors} ({seed_year}).
This lineage: {total_nodes} papers, {total_edges} edges, {min_year}-{max_year}.
Research areas: {', '.join(cluster_names[:8])}.
Seed paper field: {', '.join(seed_fields[:3])}. Citations: {seed_citations}.

USER SESSION:
Previous prompts: {prev_count}. Last prompt: "{last_prompt[:100]}" (type: {last_type}).
Has research position: {'Yes: ' + position_summary[:100] if has_position else 'No'}.

THE USER'S PROMPT:
"{prompt_text}"

CLASSIFY into EXACTLY ONE category:

POSITION — User describes THEIR OWN research topic or goal. Uses "I want to build", "I'm working on", "my research", "my paper", "I want to develop", "I want to create". They describe what THEY are doing or plan to do. Includes abstracts. IMPORTANT: "I want to build X" is ALWAYS POSITION because they are describing their own work goal.
COMPARISON — User wants TWO things compared. Names two papers/methods. Uses "compare", "vs", "differ", "which is better". "How does X differ from this" = compare X with seed paper.
FOLLOW_UP — References PREVIOUS output. Short (<20 words). Uses "that", "why", "more about", "explain". Only if previous prompts exist.
EXPLORATION — Wants depth on a SPECIFIC entity (paper, author, cluster, field). "Tell me about", "explain", "who is", "what is".
RECOMMENDATION — Wants reading guidance WITHOUT describing own research. "What should I read", "where to start", "important papers". Does NOT include "I want to build" (that's POSITION).
QUESTION — Direct factual question. "How many", "what", "who", "when". Short, expects concise answer.
META — About the tool, character, off-topic, jokes, greetings.

Return ONLY the classification word."""

    try:
        resp = groq_client.chat.completions.create(
            model=config.GROQ_FAST_MODEL,
            messages=[{"role": "user", "content": classify_prompt}],
            max_tokens=5,
            temperature=0,
        )
        result = resp.choices[0].message.content.strip().upper()
        valid = ['POSITION', 'COMPARISON', 'FOLLOW_UP', 'EXPLORATION', 'RECOMMENDATION', 'QUESTION', 'META']
        if result in valid:
            return result.lower()
        # Try extracting from response
        for v in valid:
            if v in result:
                return v.lower()
        return 'question'  # safe default
    except Exception as e:
        logger.warning(f"Stage 1 classify failed: {e}")
        return _fallback_classify(prompt_text, prev_count)


def _fallback_classify(prompt_text, prev_count):
    """Keyword-based fallback classification."""
    t = prompt_text.lower()
    if any(k in t for k in ['i am working on', 'my research', 'i want to build', 'find my position', 'my paper']):
        return 'position'
    if any(k in t for k in ['compare', ' vs ', 'versus', 'difference between', 'differ from']):
        return 'comparison'
    if any(k in t for k in ['what should i read', 'recommend', 'suggest', 'where to start', 'reading list', 'important papers']):
        return 'recommendation'
    if prev_count > 0 and len(prompt_text.split()) < 15 and any(k in t for k in ['why', 'more about', 'explain', 'that paper', 'the first']):
        return 'follow_up'
    if any(k in t for k in ['tell me about', 'explain', 'who is', 'what is the', 'describe']):
        return 'exploration'
    if any(k in t for k in ['what can you do', 'how does this work', 'your name', 'joke', 'hello', 'hi ']):
        return 'meta'
    return 'question'


# ═══════════════════════════════════════════════════════════════════════════
# STAGE 2: SELECT TOOLS
# ═══════════════════════════════════════════════════════════════════════════

def stage2_select_tools(groq_client, config, prompt_text, classification, context):
    """Ask the LLM to select visual elements and identify narrative needs from the full toolkit."""

    seed_title = context.get('seed_title', 'Unknown')
    total_nodes = context.get('total_nodes', 0)
    has_position = context.get('has_position', False)
    position_summary = context.get('position_summary', '')
    cluster_names = context.get('cluster_names', [])

    tool_prompt = f"""You are the layout designer for Arivu's Pathfinder output.

THE USER ASKED: "{prompt_text[:300]}"
CLASSIFICATION: {classification}
LINEAGE: "{seed_title}" with {total_nodes} papers.
CLUSTERS: {', '.join(cluster_names[:8])}
{"USER'S RESEARCH: " + position_summary[:150] if has_position else "No research position established yet."}

YOUR COMPLETE TOOLKIT — select ONLY elements that ADD VALUE for this specific prompt:

VISUAL DATA ELEMENTS:
- stat_card: Single big number with label and context. USE WHEN the answer IS a number or a key metric needs emphasis.
- stat_grid: 3-4 stat_cards in a row. USE WHEN an overview needs multiple key numbers at once. DO NOT use for single-metric questions.
- dot_bar: Horizontal dot matrix bar showing percentage. USE WHEN showing match scores, impact percentages, coverage ratios.
- comparison: Side-by-side cards with metric rows. USE ONLY WHEN classification is COMPARISON and exactly two entities are compared. Each side has title, authors, year, citations, and 3-4 metric rows.
- match_bar: Similarity score bar. USE WHEN showing how close a competitor paper is. Inside competitor cards only.
- paper_card: Rich single paper summary. USE WHEN highlighting ONE specific paper with full details.
- paper_list: Ordered list of papers. USE WHEN showing search results, reading lists, or evidence. Each paper is clickable.
- evidence_trail: Expandable "show N items" list. USE WHEN a claim references multiple papers. Collapsed by default.

SVG VISUALIZATIONS:
- position_map: Radial scatter of DNA clusters with user position marked. USE ONLY FOR POSITION classification.
- reading_chain: Horizontal connected dots showing reading order. USE FOR RECOMMENDATION or POSITION. Each dot is a paper with a symbol.

TEXT ELEMENTS:
- heading: Section divider. Monospace uppercase. USE for separating major sections.
- prose: Narrative paragraph with [paper name] links. USE for analysis, explanation, context. This is where insight lives.
- takeaway: Gold highlighted box. THE single most important insight. LIMIT one per output, at the end.
- opportunity: Yellow bordered box. Actionable research gap. LIMIT one per output.
- caveat: Orange warning. USE for limitations, adjacent topics.

INTERACTIVE ELEMENTS:
- show_me: Button highlighting a paper in the graph. USE after mentioning a specific paper.
- trace_path: Button highlighting path between two papers. USE for showing relationships.
- discuss_link: Link opening chat with context. USE at end of sections.

COMPOSITE SECTIONS (POSITION classification ONLY — use ALL 4 for position queries):
- position_section: Position map + relationship text + closest paper card
- landscape_section: Competitor cards with match bars + WHAT THEY DID + HOW YOU DIFFER + gap opportunity
- roadmap_section: Reading chain + per-paper cards with WHY READ + WHAT TO LOOK FOR
- citation_section: Three-tier citation debt (MUST CITE / SHOULD CITE / STRATEGIC) with reasoning

RULES:
1. POSITION queries MUST include ALL 4 composite sections. No exceptions.
2. QUESTION queries should use 2-4 elements maximum. Be concise.
3. COMPARISON queries MUST use the comparison element with dot_bar metrics.
4. EXPLORATION should use 4-6 elements including evidence_trails and opportunity.
5. RECOMMENDATION MUST use reading_chain + paper cards.
6. FOLLOW_UP should use 3-5 elements, prose-heavy.
7. META uses only prose.
8. ALWAYS end analytical responses with a takeaway.
9. If user has a research position, include personalized context in prose.
10. NEVER use position_map for non-POSITION queries.

Return ONLY valid JSON:
{{
  "elements": ["list", "of", "element", "types", "to", "use"],
  "narrative_needs": [
    {{"id": "unique_id", "instruction": "Specific instruction for what to write. Reference the user's prompt and relevant data.", "max_sentences": 4}},
    ...
  ],
  "data_to_compute": ["what data the backend should prepare: similar_papers, bottlenecks, reading_order, clusters, key_stats, top_papers, find_entity, related_papers, find_two_papers, paper_metrics"]
}}"""

    try:
        resp = groq_client.chat.completions.create(
            model=config.GROQ_FAST_MODEL,
            messages=[
                {"role": "system", "content": "You are a UI layout designer. Return valid JSON only."},
                {"role": "user", "content": tool_prompt},
            ],
            max_tokens=500,
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        text = resp.choices[0].message.content.strip()
        plan = json.loads(text)

        # Validate the plan has required fields
        if not plan.get('elements'):
            plan['elements'] = ['prose', 'takeaway']
        if not plan.get('narrative_needs'):
            plan['narrative_needs'] = [{'id': 'answer', 'instruction': f'Respond to: "{prompt_text[:200]}"', 'max_sentences': 4}]
        if not plan.get('data_to_compute'):
            plan['data_to_compute'] = []

        # Enforce rules: POSITION must have all 4 sections
        if classification == 'position':
            required_sections = ['position_section', 'landscape_section', 'roadmap_section', 'citation_section']
            for s in required_sections:
                if s not in plan['elements']:
                    plan['elements'].append(s)

            # Ensure narrative needs for position
            required_narratives = {'relationship', 'competitor_analyses', 'gap_analysis', 'reading_reasons', 'citation_reasoning'}
            existing_ids = {n['id'] for n in plan['narrative_needs']}
            for rn in required_narratives:
                if rn not in existing_ids:
                    plan['narrative_needs'].append({
                        'id': rn,
                        'instruction': _default_narrative_instruction(rn, prompt_text),
                        'max_sentences': 3
                    })

            # Ensure data computation for position
            for d in ['similar_papers', 'bottlenecks', 'reading_order', 'clusters']:
                if d not in plan['data_to_compute']:
                    plan['data_to_compute'].append(d)

        # Enforce: COMPARISON must have comparison element
        if classification == 'comparison' and 'comparison' not in plan['elements']:
            plan['elements'].append('comparison')

        # Enforce: RECOMMENDATION must have reading_chain
        if classification == 'recommendation' and 'reading_chain' not in plan['elements']:
            plan['elements'].append('reading_chain')

        return plan

    except Exception as e:
        logger.warning(f"Stage 2 tool selection failed: {e}")
        return _fallback_tool_plan(classification, prompt_text)


def _default_narrative_instruction(narrative_id, prompt_text):
    """Default instructions for required position narratives."""
    instructions = {
        'relationship': f'Describe where the user fits in this lineage. Their research: "{prompt_text[:200]}". Be specific about cluster, relationship type (SPECIALIZATION/GENERALIZATION/HYBRIDIZATION), depth level.',
        'competitor_analyses': f'For each competitor paper, write whatTheyDid (2 sentences about their approach) and howYouDiffer (2 sentences comparing to the user\'s work on: "{prompt_text[:150]}").',
        'gap_analysis': f'What gap does the user\'s research fill? What hasn\'t been done? Be concrete about methods/domains. User works on: "{prompt_text[:200]}"',
        'reading_reasons': f'For each paper in the reading list, write whyRead (2-3 sentences about why this matters FOR THE USER\'S SPECIFIC RESEARCH on "{prompt_text[:150]}") and whatToLookFor (1 sentence referencing specific sections/tables/figures).',
        'citation_reasoning': 'For each citation category (must/should/strategic), explain WHY citing each paper matters for the user\'s specific research.',
    }
    return instructions.get(narrative_id, f'Analyze: "{prompt_text[:200]}"')


def _fallback_tool_plan(classification, prompt_text):
    """Fallback tool plan when LLM fails."""
    plans = {
        'position': {
            'elements': ['position_section', 'landscape_section', 'roadmap_section', 'citation_section'],
            'narrative_needs': [
                {'id': 'relationship', 'instruction': _default_narrative_instruction('relationship', prompt_text), 'max_sentences': 3},
                {'id': 'competitor_analyses', 'instruction': _default_narrative_instruction('competitor_analyses', prompt_text), 'max_sentences': 4},
                {'id': 'gap_analysis', 'instruction': _default_narrative_instruction('gap_analysis', prompt_text), 'max_sentences': 3},
                {'id': 'reading_reasons', 'instruction': _default_narrative_instruction('reading_reasons', prompt_text), 'max_sentences': 3},
                {'id': 'citation_reasoning', 'instruction': _default_narrative_instruction('citation_reasoning', prompt_text), 'max_sentences': 2},
            ],
            'data_to_compute': ['similar_papers', 'bottlenecks', 'reading_order', 'clusters'],
        },
        'comparison': {
            'elements': ['heading', 'comparison', 'prose', 'takeaway', 'show_me'],
            'narrative_needs': [
                {'id': 'comparison_text', 'instruction': f'Compare: "{prompt_text[:200]}"', 'max_sentences': 5},
                {'id': 'verdict', 'instruction': 'Which is stronger and why?', 'max_sentences': 2},
            ],
            'data_to_compute': ['find_two_papers', 'paper_metrics'],
        },
        'recommendation': {
            'elements': ['heading', 'reading_chain', 'paper_list', 'takeaway'],
            'narrative_needs': [
                {'id': 'reading_reasons', 'instruction': f'Why read each paper. Context: "{prompt_text[:200]}"', 'max_sentences': 3},
                {'id': 'takeaway', 'instruction': 'Key reading advice.', 'max_sentences': 2},
            ],
            'data_to_compute': ['reading_order', 'bottlenecks'],
        },
        'exploration': {
            'elements': ['heading', 'prose', 'paper_list', 'evidence_trail', 'opportunity', 'takeaway', 'show_me'],
            'narrative_needs': [
                {'id': 'exploration', 'instruction': f'Deep dive: "{prompt_text[:200]}"', 'max_sentences': 8},
                {'id': 'opportunity', 'instruction': 'Research opportunity?', 'max_sentences': 2},
                {'id': 'takeaway', 'instruction': 'Key insight.', 'max_sentences': 2},
            ],
            'data_to_compute': ['find_entity', 'related_papers'],
        },
        'follow_up': {
            'elements': ['prose', 'evidence_trail', 'show_me', 'takeaway'],
            'narrative_needs': [
                {'id': 'answer', 'instruction': f'Follow-up answer: "{prompt_text[:200]}"', 'max_sentences': 6},
                {'id': 'takeaway', 'instruction': 'Key point.', 'max_sentences': 2},
            ],
            'data_to_compute': ['related_papers'],
        },
        'question': {
            'elements': ['heading', 'stat_grid', 'prose', 'paper_list', 'takeaway'],
            'narrative_needs': [
                {'id': 'answer', 'instruction': f'Answer: "{prompt_text[:200]}"', 'max_sentences': 4},
                {'id': 'takeaway', 'instruction': 'Key fact.', 'max_sentences': 1},
            ],
            'data_to_compute': ['key_stats', 'top_papers'],
        },
        'meta': {
            'elements': ['prose'],
            'narrative_needs': [
                {'id': 'answer', 'instruction': f'Respond helpfully: "{prompt_text[:200]}"', 'max_sentences': 4},
            ],
            'data_to_compute': [],
        },
    }
    return plans.get(classification, plans['question'])


# ═══════════════════════════════════════════════════════════════════════════
# STAGE 3: GENERATE NARRATIVES
# ═══════════════════════════════════════════════════════════════════════════

def stage3_generate_narratives(groq_client, config, prompt_text, classification, tool_plan, context, graph_data, similar_papers):
    """Generate narrative prose for each narrative need."""

    seed_title = context.get('seed_title', 'Unknown')
    seed_year = context.get('seed_year', '')
    seed_citations = context.get('seed_citations', 0)
    total_nodes = context.get('total_nodes', 0)
    position_summary = context.get('position_summary', '')

    narrative_needs = tool_plan.get('narrative_needs', [])
    if not narrative_needs:
        return {}

    # Build data context for the LLM
    nodes = graph_data.get('nodes', [])
    edges = graph_data.get('edges', [])

    # Top papers by citations
    top_papers = sorted(nodes, key=lambda n: n.get('citation_count', 0), reverse=True)[:10]
    top_papers_str = '\n'.join([
        f"  - {p.get('title', '?')} ({p.get('year', '?')}, {p.get('citation_count', 0)} cites, depth {p.get('depth', '?')}, bottleneck: {p.get('is_bottleneck', False)})"
        for p in top_papers
    ])

    # Similar papers
    similar_str = '\n'.join([
        f"  - {p.get('title', '?')} ({p.get('year', '?')}, {p.get('citation_count', 0)} cites, similarity: {p.get('similarity', 0):.2f})"
        for p in similar_papers[:5]
    ]) if similar_papers else '  (none found)'

    # Mutation distribution
    mutation_counts = {}
    for e in edges:
        mt = e.get('mutation_type', 'unknown')
        mutation_counts[mt] = mutation_counts.get(mt, 0) + 1
    mutation_str = ', '.join([f"{k}: {v}" for k, v in sorted(mutation_counts.items(), key=lambda x: -x[1])[:5]])

    # Bottlenecks
    bottlenecks = sorted([n for n in nodes if n.get('is_bottleneck')], key=lambda n: n.get('pruning_impact', 0), reverse=True)[:5]
    bottleneck_str = '\n'.join([
        f"  - {p.get('title', '?')} ({p.get('year', '?')}, impact: {p.get('pruning_impact', 0):.0f}%)"
        for p in bottlenecks
    ]) if bottlenecks else '  (none)'

    # Clusters
    dna = graph_data.get('dna_profile', {})
    clusters = dna.get('clusters', [])
    cluster_str = '\n'.join([
        f"  - {c.get('name', 'Unknown')} ({c.get('paper_count', len(c.get('papers', [])))} papers)"
        for c in clusters[:8]
    ]) if clusters else '  (none)'

    # Previous context
    prev_str = ''
    if context.get('previous_prompts'):
        for pp in context['previous_prompts'][-2:]:
            prev_str += f"\nUser previously asked: \"{pp.get('prompt', '')[:150]}\"\nSummary of response: {pp.get('output_summary', '')[:200]}\n"

    # Build the narrative generation prompt
    narrative_instructions = '\n\n'.join([
        f"""NARRATIVE "{n['id']}":
Instruction: {n['instruction']}
Max length: {n.get('max_sentences', 4)} sentences."""
        for n in narrative_needs
    ])

    full_prompt = f"""You are a senior research analyst for Arivu's Pathfinder.

AUDIENCE: Expert researchers who need INSIGHTS, not summaries. They need CONNECTIONS between papers they missed and ACTIONABLE advice.

LINEAGE DATA:
Seed: "{seed_title}" ({seed_year}), {seed_citations} citations.
{total_nodes} papers, {len(edges)} edges.

TOP PAPERS (by citations):
{top_papers_str}

SIMILAR TO USER'S QUERY:
{similar_str}

BOTTLENECK PAPERS (highest structural impact):
{bottleneck_str}

DNA CLUSTERS:
{cluster_str}

MUTATION DISTRIBUTION: {mutation_str}

{f'USER RESEARCH POSITION: {position_summary}' if position_summary else ''}
{prev_str}

THE USER ASKED: "{prompt_text}"
Classification: {classification}

GENERATE THESE NARRATIVES:

{narrative_instructions}

QUALITY RULES:
1. Every sentence must contain at least ONE specific fact (paper name, number, year, method). No filler.
2. Reference papers in [brackets]: [Deep Residual Learning], [VGGNet].
3. Use concrete metrics: "216,247 citations" not "many citations".
4. For WHY READ, reference specific sections: "Section 3.2 introduces skip connections".
5. For gaps, be concrete: "No paper combines X with Y under Z constraints".
6. No em dashes. Use commas, periods, "and".
7. No filler: "it is worth noting", "importantly", "interestingly", "notably".
8. Write like a colleague at a whiteboard. Direct. Specific. Actionable.
9. If user has a position, connect EVERY finding to THEIR research.
10. Each narrative must be different in tone and structure from the others.

Return ONLY valid JSON:
{{"narratives": {{"narrative_id": "text", ...}}}}"""

    try:
        model = config.GROQ_SMART_MODEL if classification in ('position', 'comparison', 'exploration') else config.GROQ_FAST_MODEL
        resp = groq_client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a research analyst. Return valid JSON only. No markdown."},
                {"role": "user", "content": full_prompt},
            ],
            max_tokens=1500,
            temperature=0.4,
            response_format={"type": "json_object"},
        )
        text = resp.choices[0].message.content.strip()
        parsed = json.loads(text)

        # The LLM might return narratives OR blocks format
        if 'narratives' in parsed:
            narr = parsed['narratives']
            # If narratives is a string (LLM nested JSON in a string), try to parse it
            if isinstance(narr, str):
                try:
                    narr = json.loads(narr)
                except (json.JSONDecodeError, Exception):
                    pass
            if isinstance(narr, dict):
                return narr
            # If still a string, wrap it as the main answer
            return {'answer': str(narr)}

        # If LLM returned blocks directly (old format), extract narrative text from them
        raw_blocks = parsed.get('blocks')
        if raw_blocks is not None:
            # Normalize: if blocks is a single dict, wrap in list
            if isinstance(raw_blocks, dict) and raw_blocks.get('type'):
                raw_blocks = [raw_blocks]
            if isinstance(raw_blocks, list):
                logger.info(f"Stage 3: LLM returned blocks format ({len(raw_blocks)} blocks) instead of narratives. Using directly.")
                extracted = {'_raw_blocks': raw_blocks}
            for block in parsed['blocks']:
                if isinstance(block, dict) and block.get('type') == 'prose' and block.get('text'):
                    # Use first prose block as the main narrative
                    if 'answer' not in extracted:
                        extracted['answer'] = block['text']
                    elif 'exploration' not in extracted:
                        extracted['exploration'] = block['text']
                elif isinstance(block, dict) and block.get('type') == 'takeaway' and block.get('text'):
                    extracted['takeaway'] = block['text']
                elif isinstance(block, dict) and block.get('type') == 'opportunity' and block.get('text'):
                    extracted['gap_analysis'] = block['text']
            return extracted

        # Fallback: return the entire parsed dict as narratives
        return parsed
    except json.JSONDecodeError:
        # JSON parse failed — the LLM returned non-JSON text
        # Try to extract JSON from the text
        logger.warning(f"Stage 3: JSON parse failed, attempting extraction")
        try:
            # Try to find {...} in the text
            brace_match = re.search(r'\{[\s\S]*\}', text)
            if brace_match:
                parsed = json.loads(brace_match.group(0))
                if 'narratives' in parsed:
                    return parsed['narratives'] if isinstance(parsed['narratives'], dict) else {'answer': str(parsed['narratives'])}
                if 'blocks' in parsed:
                    blocks = parsed['blocks']
                    if isinstance(blocks, dict):
                        blocks = [blocks]
                    if isinstance(blocks, list):
                        return {'_raw_blocks': blocks}
        except Exception:
            pass
        # Last resort: use the raw text as a prose answer
        return {'answer': text[:1500] if text else f"Analysis based on {total_nodes} papers."}
    except Exception as e:
        logger.warning(f"Stage 3 narrative generation failed: {e}")
        return {n['id']: f"Analysis based on {total_nodes} papers in this lineage." for n in narrative_needs}


# ═══════════════════════════════════════════════════════════════════════════
# STAGE 4: ASSEMBLE
# ═══════════════════════════════════════════════════════════════════════════

def stage4_assemble(classification, tool_plan, narratives, graph_data, similar_papers, prompt_text, context):
    """Assemble the final block structure from graph data + LLM narratives."""

    # If the LLM returned pre-structured blocks, use them directly
    # (with validation and enhancement from graph data)
    if isinstance(narratives, dict) and '_raw_blocks' in narratives:
        raw_blocks = narratives['_raw_blocks']
        if isinstance(raw_blocks, list) and len(raw_blocks) > 0:
            # Validate each block has a type
            valid_blocks = [b for b in raw_blocks if isinstance(b, dict) and b.get('type')]
            if valid_blocks:
                logger.info(f"Stage 4: Using {len(valid_blocks)} pre-structured LLM blocks")
                return valid_blocks

    nodes = graph_data.get('nodes', [])
    edges = graph_data.get('edges', [])
    dna = graph_data.get('dna_profile', {})
    clusters = dna.get('clusters', [])

    if classification == 'position':
        return _assemble_position(nodes, edges, clusters, similar_papers, narratives, context)
    elif classification == 'comparison':
        return _assemble_comparison(nodes, edges, similar_papers, narratives, prompt_text, context)
    elif classification == 'recommendation':
        return _assemble_recommendation(nodes, edges, similar_papers, narratives, context)
    elif classification == 'exploration':
        return _assemble_exploration(nodes, edges, similar_papers, narratives, prompt_text, context)
    elif classification == 'follow_up':
        return _assemble_followup(nodes, edges, similar_papers, narratives, context)
    elif classification == 'question':
        return _assemble_question(nodes, edges, similar_papers, narratives, prompt_text, context)
    elif classification == 'meta':
        return _assemble_meta(narratives, context)
    else:
        return [{'type': 'prose', 'text': narratives.get('answer', 'No analysis available.')}]


def _assemble_position(nodes, edges, clusters, similar_papers, narratives, context):
    """Full 4-section position analysis."""
    seed = next((n for n in nodes if n.get('is_seed')), None)
    bottlenecks = sorted([n for n in nodes if n.get('is_bottleneck')], key=lambda n: n.get('pruning_impact', 0), reverse=True)

    # ── Section 1: Position ──
    # If DNA clusters are empty, generate pseudo-clusters from fields_of_study
    if not clusters:
        field_counts = {}
        for n in nodes:
            for f in (n.get('fields_of_study') or []):
                field_counts[f] = field_counts.get(f, 0) + 1
        clusters = [{'name': f, 'paper_count': c} for f, c in sorted(field_counts.items(), key=lambda x: -x[1])[:10]]

    cluster_positions = []
    for i, c in enumerate(clusters[:10]):
        cluster_positions.append({
            'name': c.get('name', f'Cluster {i+1}'),
            'paperCount': c.get('paper_count', len(c.get('papers', []))),
        })

    closest_cluster = ''
    if similar_papers:
        fos = similar_papers[0].get('fields_of_study', [])
        closest_cluster = fos[0] if fos else (clusters[0]['name'] if clusters else '')
    elif clusters:
        closest_cluster = clusters[0].get('name', '')
    seed_cluster = ''
    if seed:
        seed_fos = seed.get('fields_of_study', [])
        seed_cluster = seed_fos[0] if seed_fos else (clusters[0].get('name', '') if clusters else '')

    closest_paper = None
    match_score = 0
    if similar_papers:
        sp = similar_papers[0]
        closest_paper = {
            'title': sp.get('title', ''),
            'id': sp.get('id', ''),
            'year': sp.get('year'),
            'citations': sp.get('citation_count', 0),
            'paperId': sp.get('id', ''),
        }
        match_score = round(sp.get('similarity', 0) * 100)

    position_section = {
        'type': 'position_section',
        'map': {'clusters': cluster_positions, 'userCluster': closest_cluster, 'seedCluster': seed_cluster},
        'relationship': narratives.get('relationship', f'Your research aligns with the {closest_cluster} area of this lineage.'),
        'closestPaper': closest_paper,
        'matchScore': match_score,
    }

    # ── Section 2: Landscape ──
    competitor_analyses = narratives.get('competitor_analyses', '')
    # Parse if it's a string (LLM returned prose instead of structured)
    if isinstance(competitor_analyses, str):
        # Split by paper mentions
        competitor_analyses = [{'whatTheyDid': competitor_analyses, 'howYouDiffer': ''}]
    elif isinstance(competitor_analyses, dict):
        competitor_analyses = [competitor_analyses]

    competitors = []
    for i, sp in enumerate(similar_papers[:5]):
        comp = {
            'title': sp.get('title', ''),
            'authors': ', '.join(sp.get('authors', [])[:3]) if isinstance(sp.get('authors'), list) else str(sp.get('authors', '')),
            'year': sp.get('year'),
            'citations': sp.get('citation_count', 0),
            'match': round(sp.get('similarity', 0) * 100),
            'paperId': sp.get('id', ''),
        }
        if isinstance(competitor_analyses, list) and i < len(competitor_analyses):
            ca = competitor_analyses[i]
            if isinstance(ca, dict):
                comp['whatTheyDid'] = ca.get('whatTheyDid', '')
                comp['howYouDiffer'] = ca.get('howYouDiffer', '')
            elif isinstance(ca, str):
                comp['whatTheyDid'] = ca
        competitors.append(comp)

    landscape_section = {
        'type': 'landscape_section',
        'competitors': competitors,
        'gap': narratives.get('gap_analysis', ''),
    }

    # ── Section 3: Roadmap ──
    reading_order = _compute_reading_order(nodes, seed, bottlenecks, similar_papers)
    reading_reasons = narratives.get('reading_reasons', '')

    # Parse reading reasons
    if isinstance(reading_reasons, str):
        reading_reasons = [{'whyRead': reading_reasons, 'whatToLookFor': ''}]
    elif isinstance(reading_reasons, dict):
        reading_reasons = [reading_reasons]

    roadmap_papers = []
    symbols = ['seed', 'impact', 'rival', 'root', 'alt']
    roles = ['SEED PAPER', 'HIGHEST STRUCTURAL IMPACT', 'YOUR CLOSEST COMPETITOR', 'DEEP ROOT', 'ALTERNATIVE APPROACH']
    for i, paper in enumerate(reading_order[:5]):
        rp = {
            'id': paper.get('id', ''),
            'title': paper.get('title', ''),
            'year': paper.get('year'),
            'citations': paper.get('citation_count', 0),
            'role': roles[i] if i < len(roles) else '',
            'symbol': symbols[i] if i < len(symbols) else 'seed',
            'paperId': paper.get('id', ''),
        }
        if isinstance(reading_reasons, list) and i < len(reading_reasons):
            rr = reading_reasons[i]
            if isinstance(rr, dict):
                rp['whyRead'] = rr.get('whyRead', '')
                rp['whatToLookFor'] = rr.get('whatToLookFor', '')
            elif isinstance(rr, str):
                rp['whyRead'] = rr
        roadmap_papers.append(rp)

    roadmap_section = {
        'type': 'roadmap_section',
        'chain': [{'id': p['id'], 'title': p['title'], 'year': p.get('year'), 'role': p.get('role', ''), 'symbol': p.get('symbol', '')} for p in roadmap_papers],
        'papers': roadmap_papers,
    }

    # ── Section 4: Citation Debt ──
    citation_reasoning = narratives.get('citation_reasoning', {})
    if isinstance(citation_reasoning, str):
        citation_reasoning = {'must': [citation_reasoning], 'should': [], 'strategic': []}
    must_reasons = citation_reasoning.get('must', []) if isinstance(citation_reasoning, dict) else []
    should_reasons = citation_reasoning.get('should', []) if isinstance(citation_reasoning, dict) else []
    strategic_reasons = citation_reasoning.get('strategic', []) if isinstance(citation_reasoning, dict) else []

    must_cite = []
    if seed:
        must_cite.append({
            'title': seed['title'], 'id': seed['id'], 'year': seed.get('year'),
            'reason': must_reasons[0] if isinstance(must_reasons, list) and must_reasons else 'This is the seed paper of this lineage.',
        })
    if bottlenecks and bottlenecks[0].get('id') != (seed or {}).get('id'):
        must_cite.append({
            'title': bottlenecks[0]['title'], 'id': bottlenecks[0]['id'], 'year': bottlenecks[0].get('year'),
            'reason': must_reasons[1] if isinstance(must_reasons, list) and len(must_reasons) > 1 else f"Structural bottleneck. {bottlenecks[0].get('pruning_impact', 0):.0f}% of this lineage depends on it.",
        })

    should_cite = []
    deep_roots = sorted([n for n in nodes if n.get('depth', 0) >= 2 and n.get('is_bottleneck')], key=lambda n: n.get('year', 9999))
    for j, dr in enumerate(deep_roots[:2]):
        if dr['id'] not in [m['id'] for m in must_cite]:
            should_cite.append({
                'title': dr['title'], 'id': dr['id'], 'year': dr.get('year'),
                'reason': should_reasons[j] if isinstance(should_reasons, list) and j < len(should_reasons) else 'Foundational paper that multiple critical works cite.',
            })

    strategic = []
    for j, sp in enumerate(similar_papers[:2]):
        if sp['id'] not in [m['id'] for m in must_cite] + [s['id'] for s in should_cite]:
            strategic.append({
                'title': sp['title'], 'id': sp['id'], 'year': sp.get('year'),
                'reason': strategic_reasons[j] if isinstance(strategic_reasons, list) and j < len(strategic_reasons) else 'Citing competitors shows landscape awareness.',
            })

    citation_section = {
        'type': 'citation_section',
        'mustCite': must_cite,
        'shouldCite': should_cite,
        'strategic': strategic,
    }

    return [position_section, landscape_section, roadmap_section, citation_section]


def _assemble_comparison(nodes, edges, similar_papers, narratives, prompt_text, context):
    """Side-by-side comparison output."""
    # Try to find two papers mentioned in the prompt
    paper_a, paper_b = _find_two_papers(prompt_text, nodes, context)

    if not paper_a or not paper_b:
        # Fallback: use seed and top similar
        seed = next((n for n in nodes if n.get('is_seed')), None)
        paper_a = paper_a or seed
        paper_b = paper_b or (similar_papers[0] if similar_papers else (nodes[1] if len(nodes) > 1 else None))

    if not paper_a or not paper_b:
        return [{'type': 'prose', 'text': 'Could not identify two papers to compare. Try naming specific papers.'}]

    max_cites = max(paper_a.get('citation_count', 1), paper_b.get('citation_count', 1), 1)

    blocks = [
        {'type': 'heading', 'text': f"{paper_a.get('title', '?')[:30]} vs {paper_b.get('title', '?')[:30]}"},
        {'type': 'comparison',
         'left': {
             'title': paper_a.get('title', ''),
             'authors': ', '.join(paper_a.get('authors', [])[:3]) if isinstance(paper_a.get('authors'), list) else '',
             'year': paper_a.get('year'),
             'citation_count': paper_a.get('citation_count', 0),
             'id': paper_a.get('id', ''),
             'metrics': [
                 {'label': 'CITATIONS', 'value': paper_a.get('citation_count', 0), 'maxValue': max_cites},
                 {'label': 'PRUNE IMPACT', 'value': round(paper_a.get('pruning_impact', 0)), 'maxValue': 100, 'suffix': '%'},
                 {'label': 'DEPTH', 'value': paper_a.get('depth', 0), 'maxValue': 3, 'display': f"{paper_a.get('depth', '?')} ({'seed' if paper_a.get('is_seed') else 'ref'})"},
             ],
         },
         'right': {
             'title': paper_b.get('title', ''),
             'authors': ', '.join(paper_b.get('authors', [])[:3]) if isinstance(paper_b.get('authors'), list) else '',
             'year': paper_b.get('year'),
             'citation_count': paper_b.get('citation_count', 0),
             'id': paper_b.get('id', ''),
             'metrics': [
                 {'label': 'CITATIONS', 'value': paper_b.get('citation_count', 0), 'maxValue': max_cites},
                 {'label': 'PRUNE IMPACT', 'value': round(paper_b.get('pruning_impact', 0)), 'maxValue': 100, 'suffix': '%'},
                 {'label': 'DEPTH', 'value': paper_b.get('depth', 0), 'maxValue': 3, 'display': f"{paper_b.get('depth', '?')} ({'seed' if paper_b.get('is_seed') else 'ref'})"},
             ],
         }},
        {'type': 'prose', 'text': (narratives.get('comparison_text') or narratives.get('answer') or
                                    narratives.get('comparison') or _get_first_narrative(narratives) or
                                    f'[{paper_a.get("title", "Paper A")}] has {paper_a.get("citation_count", 0):,} citations while [{paper_b.get("title", "Paper B")}] has {paper_b.get("citation_count", 0):,} citations. ' +
                                    f'{"The seed paper has significantly more structural impact." if paper_a.get("is_seed") else "Both papers contribute to this lineage."}')},
    ]

    for_research = narratives.get('for_your_research') or narratives.get('for_research') or narratives.get('relevance')
    if for_research:
        blocks.append({'type': 'prose', 'text': for_research})

    verdict = narratives.get('verdict') or narratives.get('takeaway') or narratives.get('conclusion')
    if not verdict:
        # Generate a template verdict from the data
        a_cites = paper_a.get('citation_count', 0)
        b_cites = paper_b.get('citation_count', 0)
        a_impact = paper_a.get('pruning_impact', 0)
        b_impact = paper_b.get('pruning_impact', 0)
        winner = paper_a.get('title', 'Paper A') if (a_cites + a_impact * 1000) > (b_cites + b_impact * 1000) else paper_b.get('title', 'Paper B')
        verdict = f'[{winner}] has stronger overall influence in this lineage based on citations and structural impact.'
    blocks.append({'type': 'takeaway', 'text': verdict})
    blocks.append({'type': 'show_me', 'action': 'trace', 'paperIds': [paper_a.get('id', ''), paper_b.get('id', '')], 'label': 'Show both in graph'})

    return blocks


def _assemble_recommendation(nodes, edges, similar_papers, narratives, context):
    """Reading list with chain visualization."""
    seed = next((n for n in nodes if n.get('is_seed')), None)
    bottlenecks = sorted([n for n in nodes if n.get('is_bottleneck')], key=lambda n: n.get('pruning_impact', 0), reverse=True)
    reading_order = _compute_reading_order(nodes, seed, bottlenecks, similar_papers)

    reading_reasons = narratives.get('reading_reasons', '')
    if isinstance(reading_reasons, str):
        reading_reasons = [{'whyRead': reading_reasons}]
    elif isinstance(reading_reasons, dict):
        reading_reasons = [reading_reasons]

    symbols = ['seed', 'impact', 'rival', 'root', 'alt']
    roles = ['SEED PAPER', 'HIGHEST IMPACT', 'CLOSEST MATCH', 'DEEP ROOT', 'ALTERNATIVE']

    papers = []
    for i, p in enumerate(reading_order[:5]):
        rp = {
            'id': p.get('id', ''), 'title': p.get('title', ''), 'year': p.get('year'),
            'citations': p.get('citation_count', 0), 'role': roles[i] if i < len(roles) else '',
            'symbol': symbols[i] if i < len(symbols) else '', 'paperId': p.get('id', ''),
        }
        if isinstance(reading_reasons, list) and i < len(reading_reasons):
            rr = reading_reasons[i]
            if isinstance(rr, dict):
                rp['whyRead'] = rr.get('whyRead', '')
                rp['whatToLookFor'] = rr.get('whatToLookFor', '')
        papers.append(rp)

    chain = [{'id': p['id'], 'title': p['title'], 'year': p.get('year'), 'role': p.get('role', ''), 'symbol': p.get('symbol', '')} for p in papers]

    blocks = [
        {'type': 'heading', 'text': 'RECOMMENDED READING'},
        {'type': 'roadmap_section', 'chain': chain, 'papers': papers},
    ]
    if narratives.get('takeaway'):
        blocks.append({'type': 'takeaway', 'text': narratives['takeaway']})

    return blocks


def _assemble_exploration(nodes, edges, similar_papers, narratives, prompt_text, context):
    """Deep dive into a specific topic."""
    related = _find_related_papers(prompt_text, nodes)[:5]

    # Try multiple narrative keys (LLM might use different ones)
    prose_text = (narratives.get('exploration') or narratives.get('answer') or
                  narratives.get('main_answer') or narratives.get('deep_dive') or
                  _get_first_narrative(narratives) or
                  f"This lineage contains {len(nodes)} papers. The most cited is {nodes[0].get('title', '?') if nodes else '?'}.")

    blocks = [
        {'type': 'heading', 'text': prompt_text.upper()[:50]},
        {'type': 'prose', 'text': prose_text},
    ]

    if related:
        blocks.append({'type': 'paper_list', 'papers': [
            {'title': p.get('title', ''), 'year': p.get('year'), 'citation_count': p.get('citation_count', 0), 'id': p.get('id', '')}
            for p in related
        ]})

    if narratives.get('opportunity'):
        blocks.append({'type': 'opportunity', 'text': narratives['opportunity']})

    if narratives.get('takeaway'):
        blocks.append({'type': 'takeaway', 'text': narratives['takeaway']})

    return blocks


def _assemble_followup(nodes, edges, similar_papers, narratives, context):
    """Context-aware follow-up answer."""
    prose_text = (narratives.get('answer') or narratives.get('follow_up') or
                  _get_first_narrative(narratives) or 'Follow-up analysis not available.')
    blocks = [
        {'type': 'prose', 'text': prose_text},
    ]
    if narratives.get('takeaway'):
        blocks.append({'type': 'takeaway', 'text': narratives['takeaway']})
    return blocks


def _assemble_question(nodes, edges, similar_papers, narratives, prompt_text, context):
    """Direct factual answer with supporting data."""
    years = [n.get('year') for n in nodes if n.get('year')]
    min_year = min(years) if years else 0
    max_year = max(years) if years else 0
    contradictions = sum(1 for e in edges if e.get('mutation_type') == 'contradiction')
    bottleneck_count = sum(1 for n in nodes if n.get('is_bottleneck'))
    dna = context.get('graph_data', {}).get('dna_profile', {})
    cluster_count = len(dna.get('clusters', []))

    blocks = [
        {'type': 'heading', 'text': 'KEY FINDINGS'},
        {'type': 'stat_grid', 'cards': [
            {'label': 'Papers', 'value': str(len(nodes)), 'detail': f'spanning {min_year}-{max_year}'},
            {'label': 'Connections', 'value': str(len(edges)), 'detail': 'meaningful edges'},
            {'label': 'Clusters', 'value': str(cluster_count), 'detail': 'research threads'},
            {'label': 'Bottlenecks', 'value': str(bottleneck_count), 'detail': 'critical papers'},
        ]},
        {'type': 'prose', 'text': narratives.get('answer') or _get_first_narrative(narratives) or f'This lineage contains {len(nodes)} papers spanning {context.get("min_year", "?")} to {context.get("max_year", "?")}.'},
    ]

    # Add top papers if relevant
    top = sorted(nodes, key=lambda n: n.get('citation_count', 0), reverse=True)[:5]
    if top:
        blocks.append({'type': 'paper_list', 'papers': [
            {'title': p.get('title', ''), 'year': p.get('year'), 'citation_count': p.get('citation_count', 0), 'id': p.get('id', '')}
            for p in top
        ]})

    if narratives.get('takeaway'):
        blocks.append({'type': 'takeaway', 'text': narratives['takeaway']})

    return blocks


def _assemble_meta(narratives, context):
    """Help text or character response."""
    answer = narratives.get('answer', '')
    if not answer:
        answer = (
            "I can help you with:\n\n"
            "POSITION: Tell me your research topic and I'll find where you fit.\n"
            "COMPARE: Name two papers to see them side by side.\n"
            "READING: Ask what to read for personalized recommendations.\n"
            "EXPLORE: Say 'tell me about [topic]' for a deep dive.\n"
            "QUESTION: Ask anything about papers, authors, or trends.\n\n"
            "Try: 'I'm working on efficient transformers'"
        )
    return [{'type': 'prose', 'text': answer}]


# ═══════════════════════════════════════════════════════════════════════════
# HELPER FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════

def _get_first_narrative(narratives):
    """Get the first non-empty string value from the narratives dict."""
    if not isinstance(narratives, dict):
        return str(narratives)[:500] if narratives else None
    for k, v in narratives.items():
        if k.startswith('_'):
            continue
        if isinstance(v, str) and len(v) > 10:
            return v
    return None


def _compute_reading_order(nodes, seed, bottlenecks, similar_papers):
    """Compute optimal reading order: seed → impact → rival → root → alt."""
    order = []
    seen_ids = set()

    # 1. Seed
    if seed:
        order.append(seed)
        seen_ids.add(seed['id'])

    # 2. Highest impact non-seed bottleneck
    for b in bottlenecks:
        if b['id'] not in seen_ids:
            order.append(b)
            seen_ids.add(b['id'])
            break

    # 3. Closest competitor
    if similar_papers:
        for sp in similar_papers:
            if sp.get('id') and sp['id'] not in seen_ids:
                # Find the full node data
                node = next((n for n in nodes if n['id'] == sp['id']), sp)
                order.append(node)
                seen_ids.add(sp['id'])
                break

    # 4. Deep root (oldest bottleneck at depth 2+)
    deep_roots = sorted([n for n in nodes if n.get('depth', 0) >= 2 and n.get('is_bottleneck')], key=lambda n: n.get('year', 9999))
    for dr in deep_roots:
        if dr['id'] not in seen_ids:
            order.append(dr)
            seen_ids.add(dr['id'])
            break

    # 5. Alternative approach (highest cited paper from a different field than seed)
    seed_fields = set(seed.get('fields_of_study', [])) if seed else set()
    for n in sorted(nodes, key=lambda x: x.get('citation_count', 0), reverse=True):
        if n['id'] not in seen_ids:
            n_fields = set(n.get('fields_of_study', []))
            if not seed_fields or not n_fields or not seed_fields.intersection(n_fields):
                order.append(n)
                seen_ids.add(n['id'])
                break

    return order[:5]


def _find_two_papers(prompt_text, nodes, context):
    """Find two papers mentioned in the prompt text."""
    prompt_lower = prompt_text.lower()
    found = []

    for n in nodes:
        title_lower = n.get('title', '').lower()
        # Check if any significant words from the title appear in the prompt
        title_words = [w for w in title_lower.split() if len(w) > 4]
        matches = sum(1 for w in title_words if w in prompt_lower)
        if matches >= 2 or (len(title_words) <= 3 and matches >= 1):
            found.append((n, matches))

    found.sort(key=lambda x: -x[1])

    if len(found) >= 2:
        return found[0][0], found[1][0]
    elif len(found) == 1:
        # Second paper: check for "this" or "the seed" reference
        seed = next((n for n in nodes if n.get('is_seed')), None)
        if seed and seed['id'] != found[0][0]['id']:
            return found[0][0], seed
        return found[0][0], None
    else:
        return None, None


def _find_related_papers(prompt_text, nodes):
    """Find papers related to the prompt by keyword matching."""
    prompt_words = set(w.lower() for w in prompt_text.split() if len(w) > 3)
    scored = []
    for n in nodes:
        title_words = set(w.lower() for w in n.get('title', '').split() if len(w) > 3)
        abstract_words = set(w.lower() for w in (n.get('abstract_preview', '') or '').split() if len(w) > 3)
        all_words = title_words | abstract_words
        overlap = len(prompt_words & all_words)
        if overlap > 0:
            scored.append((n, overlap))
    scored.sort(key=lambda x: (-x[1], -x[0].get('citation_count', 0)))
    return [s[0] for s in scored[:10]]
