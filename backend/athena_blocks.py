"""
backend/athena_blocks.py

DataAssemblyEngine: computes response blocks from graph data without LLM.
Per ATHENA_CLAUDE.md Section 2.8 and ATHENA_PHASE_A.md Section 2.1.28.

Phase A supports: stat_grid, paper_card, prose.
Phase B adds all 30+ other block types.
"""

import json
import logging
import math

logger = logging.getLogger(__name__)

# Per ATHENA_PHASE_B.md Section 2.1.6 -- Chart color palettes
CHART_PALETTE = [
    '#D4A843', '#3B82F6', '#06B6D4', '#22C55E',
    '#F59E0B', '#9333EA', '#EF4444', '#64748B',
]

FIELD_COLORS = {
    'Computer Science': '#648FFF',
    'Biology': '#785EF0',
    'Physics': '#DC267F',
    'Chemistry': '#FE6100',
    'Economics': '#FFB000',
    'Mathematics': '#009E73',
    'Other': '#56B4E9',
}


class DataAssemblyEngine:
    """Computes response blocks from graph data. No LLM. Pure computation.
    Per ATHENA_CLAUDE.md Section 2.8."""

    def __init__(self, graph_data, intel_cache=None):
        self.graph = graph_data or {}
        self.intel = intel_cache or graph_data.get('intel_json')
        self.nodes = {}
        self.edges = []
        self.pagerank = {}

        # Build lookup tables
        # NOTE: Graph export JSON uses 'id' for nodes and 'source'/'target' for edges
        # (D3-compatible format from AncestryGraph.export_to_json).
        # The DB models use 'paper_id', 'citing_paper_id', 'cited_paper_id'.
        # We support BOTH formats for robustness.
        for n in self.graph.get('nodes', []):
            pid = n.get('paper_id') or n.get('id', '')
            if pid:
                n['paper_id'] = pid  # Normalize to paper_id
                self.nodes[pid] = n

        self.edges = self.graph.get('edges', [])
        # Normalize edge field names
        for e in self.edges:
            if 'citing_paper_id' not in e and 'source' in e:
                e['citing_paper_id'] = e['source']
            if 'cited_paper_id' not in e and 'target' in e:
                e['cited_paper_id'] = e['target']

        # Compute PageRank once (expensive, cache result)
        self._compute_pagerank()

    def _compute_pagerank(self):
        """Compute PageRank scores and store NetworkX graph for reuse."""
        try:
            import networkx as nx
            G = nx.DiGraph()
            for n in self.graph.get('nodes', []):
                pid = n.get('paper_id') or n.get('id', '')
                G.add_node(pid)
            for e in self.edges:
                citing = e.get('citing_paper_id') or e.get('source', '')
                cited = e.get('cited_paper_id') or e.get('target', '')
                if citing and cited:
                    G.add_edge(citing, cited)

            self.nx_graph = G

            if G.nodes:
                self.pagerank = nx.pagerank(G, alpha=0.85)
            else:
                self.pagerank = {}
        except Exception as e:
            logger.warning(f"PageRank computation failed: {e}")
            self.pagerank = {}
            self.nx_graph = None

    # Per ATHENA_PHASE_B.md Section 2.1.2 -- Assembler dispatch map
    # FIX #4: Types marked (LLM) are LLM-generated block types whose assemblers
    # return None. Their blocks come from marker parsing in the orchestrator,
    # not from the DataAssemblyEngine. Types marked (computed) have real assemblers.
    ASSEMBLER_MAP = {
        'paper_card': '_assemble_paper_card',           # (computed) entity-specific
        'stat_grid': '_assemble_stat_grid',             # (computed) entity-specific
        'data_table': '_assemble_data_table',           # (computed)
        'comparison_card': '_assemble_comparison_card',  # (computed)
        'timeline': '_assemble_timeline',               # (computed)
        'quote': '_assemble_quote',                     # (LLM) assembler returns None
        'warning': '_assemble_warning',                 # (LLM) assembler returns None
        'expandable': '_assemble_expandable',           # (LLM) assembler returns None
        'code_block': '_assemble_code_block',           # (LLM) assembler returns None
        'equation': '_assemble_equation',               # (LLM) assembler returns None
        'mini_chart_donut': '_assemble_donut',          # (computed)
        'mini_chart_bar': '_assemble_bar',              # (computed)
        'sparkline': '_assemble_sparkline',             # (computed)
        'progress_ring': '_assemble_progress_ring',     # (computed)
        'heatmap': '_assemble_heatmap',                 # (computed)
        'network_snippet': '_assemble_network',         # (computed)
        'sankey': '_assemble_sankey',                   # (computed)
        'tree': '_assemble_tree',                       # (computed)
        'inline_mini_graph': '_assemble_inline_mini_graph',  # (computed)
        'citation_evidence': '_assemble_citation_evidence',  # (computed) Phase C #020
        'relationship_explainer': '_assemble_relationship_explainer',  # (computed) Phase C #026
        'citation_ref': '_assemble_citation_ref',       # (LLM) assembler returns None
        'footnote': '_assemble_footnote',               # (LLM) assembler returns None
        'confidence_bar': '_assemble_confidence_bar',   # (LLM) assembler returns None
        # Group 3: Code Variants
        'python_code': '_assemble_python_code',         # (LLM) assembler returns None
        'sql_query': '_assemble_sql_query',             # (LLM) assembler returns None
        'json_data': '_assemble_json_data',             # (computed) can extract from graph
        'api_endpoint': '_assemble_api_endpoint',       # (LLM) assembler returns None
        # Phase C #107: Filter-specific stat card
        'filter_stats': '_assemble_filter_stats',       # (computed) from awareness context
    }

    def assemble(self, intent_result):
        """Given intent decomposer output, compute all needed blocks.
        Per ATHENA_CLAUDE.md Section 2.8 and ATHENA_PHASE_B.md Section 2.1.2."""
        blocks = []
        data_needs = intent_result.get('data_needs', [])
        block_plan = intent_result.get('block_plan', [])
        entities = intent_result.get('entities', [])

        for block_type in block_plan:
            if block_type == 'prose':
                continue  # Prose is handled by LLM, not data assembly

            # Phase A entity-specific dispatchers
            if block_type == 'paper_card' and entities:
                for entity in entities:
                    pid = entity.get('paper_id', '')
                    if pid and pid in self.nodes:
                        blocks.append(self._assemble_paper_card(pid))
                continue

            if block_type == 'stat_grid' and entities:
                for entity in entities:
                    pid = entity.get('paper_id', '')
                    if pid:
                        block = self._assemble_stat_grid(pid, data_needs)
                        if block:
                            blocks.append(block)
                continue

            if block_type == 'stat_grid' and not entities and data_needs:
                block = self._assemble_graph_stats()
                if block:
                    blocks.append(block)
                continue

            # FIX #15: Skip entity-specific types already handled by special-case code above
            if block_type in ('paper_card', 'stat_grid'):
                continue

            # Phase B chart/visualization block dispatch via ASSEMBLER_MAP
            method_name = self.ASSEMBLER_MAP.get(block_type)
            if method_name and hasattr(self, method_name):
                try:
                    result = getattr(self, method_name)(intent_result)
                    if result:
                        blocks.append(result)
                except Exception as e:
                    logger.warning(f"Block assembly failed for {block_type}: {e}")

        return blocks

    def _assemble_paper_card(self, paper_id):
        """Build a paper citation card block."""
        node = self.nodes.get(paper_id, {})
        return {
            "type": "paper_card",
            "provenance": "computed",
            "data": {
                "paper_id": paper_id,
                "title": node.get("title", "Unknown"),
                "authors": node.get("authors", []),
                "year": node.get("year"),
                "citation_count": node.get("citation_count", 0),
                "fields": node.get("fields_of_study", []),
                "url": node.get("url", ""),
                "text_tier": node.get("text_tier", 4),
            }
        }

    def _assemble_stat_grid(self, paper_id, data_needs):
        """Build a statistics dashboard block for a specific paper."""
        stats = []

        if "pagerank" in data_needs and paper_id in self.pagerank:
            score = self.pagerank[paper_id]
            sorted_pr = sorted(self.pagerank.items(), key=lambda x: x[1], reverse=True)
            rank = next(
                (i + 1 for i, (pid, _) in enumerate(sorted_pr) if pid == paper_id),
                len(sorted_pr)
            )
            stats.append({
                "label": "PageRank",
                "value": f"#{rank} of {len(self.nodes)}",
                "detail": f"Score: {score:.4f}",
                "source": "computed:nx.pagerank"
            })

        if "pruning_impact" in data_needs:
            try:
                from backend.pruning import compute_pruning_result
                # FIX #8: Reuse self.nx_graph instead of rebuilding a new DiGraph
                G = self.nx_graph
                if G is not None:
                    seed_id = self.graph.get('metadata', {}).get('seed_paper_id')
                    if seed_id:
                        result = compute_pruning_result(G, paper_id, seed_id)
                        stats.append({
                            "label": "Pruning Impact",
                            "value": f"{result.get('impact_percentage', 0):.1f}%",
                            "detail": f"{result.get('collapsed_count', 0)} papers collapse",
                            "source": "computed:bfs_pruning"
                        })
            except Exception as e:
                logger.warning(f"Pruning computation failed: {e}")

        if "cluster_info" in data_needs:
            node = self.nodes.get(paper_id, {})
            cluster = node.get("cluster_name", "Unknown")
            # Try to get from DNA profile
            dna = self.graph.get('dna_json', {})
            if isinstance(dna, dict) and dna.get('clusters'):
                for c in dna['clusters']:
                    papers_in_cluster = c.get('papers', [])
                    if paper_id in papers_in_cluster:
                        cluster = c.get('label', c.get('name', 'Unknown'))
                        break
            stats.append({
                "label": "DNA Cluster",
                "value": cluster,
                "source": "computed:dna_profiler"
            })

        if "descendants" in data_needs:
            desc_count = sum(1 for e in self.edges if e.get('cited_paper_id') == paper_id)
            anc_count = sum(1 for e in self.edges if e.get('citing_paper_id') == paper_id)
            stats.append({"label": "Descendants", "value": str(desc_count), "source": "computed:graph_count"})
            stats.append({"label": "Ancestors", "value": str(anc_count), "source": "computed:graph_count"})

        if not stats:
            return None

        return {
            "type": "stat_grid",
            "provenance": "computed",
            "data": {"stats": stats}
        }

    # ── Phase B: Chart Block Assemblers ──────────────────────────────────────

    def _compute_field_distribution(self, graph_data):
        """Compute field-of-study distribution for donut chart.
        Per ATHENA_PHASE_B.md Section 2.1.5."""
        counts = {}
        for node in graph_data.get('nodes', []):
            for field in (node.get('fields_of_study') or ['Other']):
                counts[field] = counts.get(field, 0) + 1
        sorted_fields = sorted(counts.items(), key=lambda x: -x[1])
        total = sum(c for _, c in sorted_fields)
        if total == 0:
            return None
        segments = []
        other = 0
        for field, count in sorted_fields[:7]:
            if count / total < 0.02:
                other += count
            else:
                segments.append({
                    'label': field,
                    'value': count,
                    'color': FIELD_COLORS.get(field, '#56B4E9'),
                })
        if other > 0:
            segments.append({'label': 'Other', 'value': other, 'color': '#56B4E9'})
        return {'segments': segments, 'total': total}

    def _assemble_donut(self, intent_result):
        """B-11: #083 Mini Donut Chart -- field distribution."""
        dist = self._compute_field_distribution(self.graph)
        if not dist or not dist['segments']:
            return None
        return {
            "type": "mini_chart_donut",
            "provenance": "computed",
            "data": dist,
        }

    def _compute_top_papers(self, graph_data, limit=10):
        """Compute top papers by citation count for bar chart.
        Per ATHENA_PHASE_B.md Section 2.1.5."""
        nodes = sorted(
            graph_data.get('nodes', []),
            key=lambda n: n.get('citation_count', 0),
            reverse=True,
        )
        if not nodes:
            return None
        bars = []
        max_val = nodes[0].get('citation_count', 1) if nodes else 1
        if max_val == 0:
            max_val = 1
        for node in nodes[:limit]:
            bars.append({
                'label': (node.get('title', 'Unknown') or 'Unknown')[:20],
                'value': node.get('citation_count', 0),
                'color': CHART_PALETTE[len(bars) % len(CHART_PALETTE)],
            })
        return {'bars': bars, 'max': max_val}

    def _assemble_bar(self, intent_result):
        """B-12: #084 Mini Bar Chart -- top papers by citation count."""
        result = self._compute_top_papers(self.graph)
        if not result or not result['bars']:
            return None
        return {
            "type": "mini_chart_bar",
            "provenance": "computed",
            "data": result,
        }

    def _compute_citations_per_year(self, graph_data):
        """Compute aggregate citations per year for sparkline.
        Per ATHENA_PHASE_B.md Section 2.1.5."""
        by_year = {}
        for node in graph_data.get('nodes', []):
            year = node.get('year')
            if year:
                by_year[year] = by_year.get(year, 0) + node.get('citation_count', 0)
        if not by_year:
            return None
        years = sorted(by_year.keys())
        values = [by_year[y] for y in years]
        if len(values) >= 6:
            first_avg = sum(values[:3]) / 3
            last_avg = sum(values[-3:]) / 3
            delta = (last_avg - first_avg) / max(first_avg, 1)
            trend = 'up' if delta > 0.05 else ('down' if delta < -0.05 else 'flat')
        else:
            trend = 'flat'
        return {'values': values, 'label': f'{years[0]}-{years[-1]}', 'trend': trend}

    def _assemble_sparkline(self, intent_result):
        """B-13: #087 Sparkline -- citations over time."""
        result = self._compute_citations_per_year(self.graph)
        if not result:
            return None
        return {
            "type": "sparkline",
            "provenance": "computed",
            "data": result,
        }

    def _assemble_progress_ring(self, intent_result):
        """B-14: #088 Progress Ring -- single metric display."""
        data_needs = intent_result.get('data_needs', [])

        # BUG 4/7 fix: If data_coverage requested, compute text_tier coverage
        if 'data_coverage' in data_needs:
            nodes = list(self.nodes.values())
            if not nodes:
                nodes = self.graph.get('nodes', [])
            total = len(nodes)
            if total == 0:
                return None
            # text_tier 1=full text+methods, 2=intro -- count as "rich data"
            full_text = sum(1 for n in nodes if int(n.get('text_tier', 4)) <= 2)
            with_abstract = sum(1 for n in nodes if n.get('abstract'))
            ft_pct = round(full_text / total * 100, 1)
            abs_pct = round(with_abstract / total * 100, 1)
            # Use the more informative metric
            if full_text > 0:
                return {
                    "type": "progress_ring",
                    "provenance": "computed",
                    "data": {
                        "value": ft_pct,
                        "max": 100,
                        "label": f"Full Text Coverage ({full_text}/{total})",
                        "color": "#22C55E",
                    },
                }
            else:
                return {
                    "type": "progress_ring",
                    "provenance": "computed",
                    "data": {
                        "value": abs_pct,
                        "max": 100,
                        "label": f"Abstract Coverage ({with_abstract}/{total})",
                        "color": "#3B82F6",
                    },
                }

        entities = intent_result.get('entities', [])
        target = None
        if entities:
            target = entities[0].get('paper_id')
        if not target:
            target = self.graph.get('metadata', {}).get('seed_paper_id')

        if target and self.pagerank and target in self.pagerank:
            sorted_pr = sorted(self.pagerank.values(), reverse=True)
            score = self.pagerank[target]
            try:
                rank_idx = sorted_pr.index(score)
                percentile = round((1 - rank_idx / max(len(sorted_pr), 1)) * 100, 1)
            except ValueError:
                percentile = 0
            return {
                "type": "progress_ring",
                "provenance": "computed",
                "data": {
                    "value": percentile,
                    "max": 100,
                    "label": "Importance",
                    "color": "#D4A843",
                },
            }

        # Fallback: graph data coverage using text_tier
        nodes = list(self.nodes.values())
        if not nodes:
            nodes = self.graph.get('nodes', [])
        if not nodes:
            return None
        full_text = sum(1 for n in nodes if int(n.get('text_tier', 4)) <= 2)
        total = len(nodes)
        if full_text > 0:
            pct = round(full_text / total * 100, 1)
            label = f"Full Text Coverage ({full_text}/{total})"
            color = "#22C55E"
        else:
            with_abstract = sum(1 for n in nodes if n.get('abstract'))
            pct = round(with_abstract / total * 100, 1)
            label = f"Abstract Coverage ({with_abstract}/{total})"
            color = "#3B82F6"
        return {
            "type": "progress_ring",
            "provenance": "computed",
            "data": {
                "value": pct,
                "max": 100,
                "label": label,
                "color": color,
            },
        }

    @staticmethod
    def _derive_confidence_tier(confidence):
        """Derive confidence tier string from a float score.
        Mirrors get_confidence_tier() from backend.models."""
        try:
            c = float(confidence)
        except (TypeError, ValueError):
            return ''
        if c >= 0.75:
            return 'HIGH'
        elif c >= 0.55:
            return 'MEDIUM'
        elif c >= 0.35:
            return 'LOW'
        else:
            return 'SPECULATIVE'

    def _compute_mutation_heatmap(self, graph_data):
        """Compute mutation type x confidence tier matrix.
        Per ATHENA_PHASE_B.md Section 2.1.5."""
        try:
            from backend.models import MUTATION_TYPES, CONFIDENCE_TIERS
        except ImportError:
            MUTATION_TYPES = (
                "adoption", "generalization", "specialization", "hybridization",
                "contradiction", "revival", "incidental",
            )
            CONFIDENCE_TIERS = ("HIGH", "MEDIUM", "LOW", "SPECULATIVE")

        rows = list(MUTATION_TYPES)
        cols = list(CONFIDENCE_TIERS)
        matrix = [[0] * len(cols) for _ in range(len(rows))]
        for edge in graph_data.get('edges', []):
            mt = edge.get('mutation_type', '')
            # BUG 3 fix: derive confidence_tier from mutation_confidence float
            # if the string field isn't present on the edge
            ct = edge.get('confidence_tier', '')
            if not ct and edge.get('mutation_confidence') is not None:
                ct = self._derive_confidence_tier(edge['mutation_confidence'])
            if mt in rows and ct in cols:
                matrix[rows.index(mt)][cols.index(ct)] += 1
        if all(all(v == 0 for v in row) for row in matrix):
            logger.debug("Heatmap: all zero matrix, returning None")
            return None
        return {'rows': rows, 'cols': cols, 'values': matrix}

    def _assemble_heatmap(self, intent_result):
        """B-15: #085 Heatmap -- mutation type x confidence tier."""
        result = self._compute_mutation_heatmap(self.graph)
        if not result:
            return None
        return {
            "type": "heatmap",
            "provenance": "computed",
            "data": result,
        }

    def _assemble_network(self, intent_result):
        """B-16: #086 Network Snippet -- subgraph around entity.
        Per ATHENA_PHASE_B.md Section 2.1.28."""
        entities = intent_result.get('entities', [])
        if not entities:
            return None

        center = entities[0].get('paper_id')
        if not center or not self.nx_graph or center not in self.nx_graph:
            return None

        import networkx as nx

        predecessors = list(self.nx_graph.predecessors(center))
        successors = list(self.nx_graph.successors(center))
        neighbors = predecessors + successors
        subgraph_ids = [center] + neighbors[:19]  # Max 20 nodes

        sub = self.nx_graph.subgraph(subgraph_ids)
        pos = nx.spring_layout(sub, k=2.0, iterations=50, seed=42)

        nodes = []
        for nid, (x, y) in pos.items():
            paper_data = self.nodes.get(nid, {})
            nodes.append({
                "id": nid,
                "label": (paper_data.get('title', '') or '')[:30],
                "x": round((x + 1) * 140 + 10),
                "y": round((y + 1) * 90 + 10),
                "is_center": nid == center,
            })

        edges = [{"from": u, "to": v} for u, v in sub.edges()]

        return {
            "type": "network_snippet",
            "provenance": "computed",
            "data": {"nodes": nodes, "edges": edges},
        }

    def _assemble_inline_mini_graph(self, intent_result):
        """B-16b: #059 Inline Mini-Graph -- focused subgraph with path highlighting."""
        entities = intent_result.get('entities', [])
        if not entities or not self.nx_graph:
            return None

        import networkx as nx

        # If 2+ entities, find path between them; otherwise path from seed to entity
        source_id = entities[0].get('paper_id')
        target_id = entities[1].get('paper_id') if len(entities) > 1 else None

        if not source_id or source_id not in self.nx_graph:
            return None

        seed_id = self.graph.get('metadata', {}).get('seed_paper_id')

        # Determine path endpoints
        if target_id and target_id in self.nx_graph:
            start, end = source_id, target_id
        elif seed_id and seed_id in self.nx_graph and source_id != seed_id:
            start, end = seed_id, source_id
        else:
            start, end = source_id, None

        focus_path = []
        if end:
            # Try both directions (citation graph is directed)
            for s, e in [(start, end), (end, start)]:
                try:
                    focus_path = nx.shortest_path(self.nx_graph, s, e)
                    break
                except nx.NetworkXNoPath:
                    continue
            # Also try undirected shortest path as fallback
            if not focus_path:
                try:
                    focus_path = nx.shortest_path(self.nx_graph.to_undirected(), start, end)
                except (nx.NetworkXNoPath, nx.NodeNotFound):
                    focus_path = [start]
        else:
            focus_path = [start]

        path_set = set(focus_path)
        context_ids = set()
        for pid in focus_path:
            for neighbor in list(self.nx_graph.predecessors(pid)) + list(self.nx_graph.successors(pid)):
                if neighbor not in path_set:
                    context_ids.add(neighbor)
        context_ids = list(context_ids)[:10]
        all_ids = list(path_set) + context_ids
        sub = self.nx_graph.subgraph(all_ids)

        pos = nx.spring_layout(sub, k=2.0, iterations=50, seed=42)

        nodes = []
        for nid, (x, y) in pos.items():
            paper_data = self.nodes.get(nid, {})
            nodes.append({
                "id": nid,
                "label": (paper_data.get('title', '') or '')[:25],
                "x": round((x + 1) * 140 + 10),
                "y": round((y + 1) * 90 + 10),
                "highlighted": nid in path_set,
            })

        edge_lookup = {}
        for e in self.edges:
            key = (e.get('citing_paper_id', ''), e.get('cited_paper_id', ''))
            edge_lookup[key] = e.get('mutation_type', 'incidental')

        edges = []
        for u, v in sub.edges():
            edges.append({
                "from": u,
                "to": v,
                "mutation_type": edge_lookup.get((u, v), 'incidental'),
            })

        context_node_data = [
            {"id": n["id"], "x": n["x"], "y": n["y"]}
            for n in nodes if n["id"] in context_ids
        ]

        return {
            "type": "inline_mini_graph",
            "provenance": "computed",
            "data": {
                "nodes": nodes,
                "edges": edges,
                "focus_path": focus_path,
                "context_nodes": context_node_data,
            },
        }

    def _assemble_sankey(self, intent_result):
        """B-17: #089 Sankey Flow -- mutation type to citation intent flow.
        Per ATHENA_PHASE_B.md Section 2.1.5."""
        pair_counts = {}
        for edge in self.edges:
            mt = edge.get('mutation_type', 'incidental')
            ci = edge.get('citation_intent', 'incidental_mention')
            if mt and ci:
                key = (mt, ci)
                pair_counts[key] = pair_counts.get(key, 0) + 1

        if not pair_counts:
            return None

        left_names = sorted(set(k[0] for k in pair_counts.keys()))
        right_names = sorted(set(k[1] for k in pair_counts.keys()))

        if len(left_names) + len(right_names) > 15:
            left_names = left_names[:7]
            right_names = right_names[:8]

        nodes = []
        for name in left_names:
            nodes.append({"id": f"mt_{name}", "label": name, "column": 0})
        for name in right_names:
            nodes.append({"id": f"ci_{name}", "label": name, "column": 1})

        links = []
        for (mt, ci), val in sorted(pair_counts.items(), key=lambda x: -x[1])[:20]:
            if mt in left_names and ci in right_names:
                links.append({
                    "source": f"mt_{mt}",
                    "target": f"ci_{ci}",
                    "value": val,
                })

        if not links:
            return None

        return {
            "type": "sankey",
            "provenance": "computed",
            "data": {"nodes": nodes, "links": links},
        }

    def _assemble_tree(self, intent_result):
        """B-18: #090 Tree -- citation hierarchy from seed paper.
        Per ATHENA_PHASE_B.md Section 2.1.5."""
        seed_id = self.graph.get('metadata', {}).get('seed_paper_id')
        if not seed_id or not self.nx_graph:
            return None

        def build_subtree(node_id, depth, max_depth=6, visited=None):
            if visited is None:
                visited = set()
            if depth >= max_depth or node_id in visited:
                return None
            visited.add(node_id)
            paper = self.nodes.get(node_id, {})
            label = (paper.get('title', 'Unknown') or 'Unknown')[:40]
            year = paper.get('year', '')

            children = []
            if node_id in self.nx_graph:
                # Use SUCCESSORS (cited papers = ancestors) for ancestry tree
                # In our directed graph: edge A->B means A cites B
                # So successors of A = papers A cites = A's ancestors
                ancestors = list(self.nx_graph.successors(node_id))
                # Also include predecessors (citers) if no successors
                if not ancestors:
                    ancestors = list(self.nx_graph.predecessors(node_id))
                ancestors.sort(
                    key=lambda c: int(self.nodes.get(c, {}).get('citation_count', 0) or 0),
                    reverse=True,
                )
                for citer in ancestors[:8]:
                    child = build_subtree(citer, depth + 1, max_depth, visited)
                    if child:
                        children.append(child)

            result = {"label": label, "paper_id": node_id}
            if year:
                result["year"] = year
            if children:
                result["children"] = children
            return result

        root = build_subtree(seed_id, 0)
        if not root:
            return None

        return {
            "type": "tree",
            "provenance": "computed",
            "data": {"root": root},
        }

    def _assemble_citation_evidence(self, intent_result):
        """Phase C #020: Citation Sentence Viewer block.
        Assembles citation evidence for an edge from the graph data or DB.
        Triggered when user asks about an edge or clicks an edge."""
        from backend.db import fetchone as db_fetchone

        # Get edge from awareness context (clicked edge) or entities
        awareness = intent_result.get('_awareness', {})
        clicked_edge = awareness.get('clicked_edge', {})
        edge_id = clicked_edge.get('edge_id', '')

        # If no clicked edge, try to find edge from entities
        if not edge_id:
            entities = intent_result.get('entities', [])
            if len(entities) >= 2:
                pid1 = entities[0].get('paper_id', '')
                pid2 = entities[1].get('paper_id', '')
                edge_id = f"{pid1}:{pid2}"

        if not edge_id:
            return None

        # Try graph data first (faster, no DB hit)
        for e in self.edges:
            src = e.get('source', '')
            tgt = e.get('target', '')
            if f"{src}:{tgt}" == edge_id or f"{tgt}:{src}" == edge_id:
                citing_paper = self.nodes.get(src, {}).get('title', '')
                cited_paper = self.nodes.get(tgt, {}).get('title', '')
                from backend.models import get_confidence_tier
                conf = float(e.get('final_confidence', 0) or e.get('mutation_confidence', 0) or 0)
                return {
                    "type": "citation_evidence",
                    "provenance": "computed",
                    "data": {
                        "edge_id": edge_id,
                        "citing_paper_id": src,
                        "cited_paper_id": tgt,
                        "citing_paper": citing_paper,
                        "cited_paper": cited_paper,
                        "citing_sentence": e.get('citing_sentence'),
                        "cited_sentence": e.get('cited_sentence'),
                        "citing_source": e.get('citing_text_source', 'none'),
                        "cited_source": e.get('cited_text_source', 'none'),
                        "mutation_type": e.get('mutation_type', 'incidental'),
                        "confidence": conf,
                        "confidence_tier": get_confidence_tier(conf),
                        "citation_intent": e.get('citation_intent', ''),
                        "mutation_evidence": e.get('mutation_evidence', ''),
                        "similarity_score": float(e.get('similarity_score', 0) or 0),
                    }
                }

        # Fallback: query edge_analysis DB table
        try:
            row = db_fetchone(
                "SELECT citing_sentence, cited_sentence, citing_text_source, cited_text_source, "
                "mutation_type, mutation_confidence, citation_intent, mutation_evidence, similarity_score "
                "FROM edge_analysis WHERE edge_id=%s", (edge_id,))
            if row:
                parts = edge_id.split(':')
                src_id = parts[0] if len(parts) >= 2 else ''
                tgt_id = parts[1] if len(parts) >= 2 else ''
                citing_paper = self.nodes.get(src_id, {}).get('title', '')
                cited_paper = self.nodes.get(tgt_id, {}).get('title', '')
                from backend.models import get_confidence_tier
                conf = float(row['mutation_confidence'] or 0)
                return {
                    "type": "citation_evidence",
                    "provenance": "computed",
                    "data": {
                        "edge_id": edge_id,
                        "citing_paper_id": src_id,
                        "cited_paper_id": tgt_id,
                        "citing_paper": citing_paper,
                        "cited_paper": cited_paper,
                        "citing_sentence": row['citing_sentence'],
                        "cited_sentence": row['cited_sentence'],
                        "citing_source": row['citing_text_source'] or 'none',
                        "cited_source": row['cited_text_source'] or 'none',
                        "mutation_type": row['mutation_type'],
                        "confidence": conf,
                        "confidence_tier": get_confidence_tier(conf),
                        "citation_intent": row['citation_intent'],
                        "mutation_evidence": row['mutation_evidence'],
                        "similarity_score": float(row['similarity_score'] or 0),
                    }
                }
        except Exception as e:
            logger.warning(f"Citation evidence DB lookup failed: {e}")

        return None

    def _assemble_relationship_explainer(self, intent_result):
        """Phase C #026: Paper Relationship Explainer.
        Builds a structured comparison + evidence block for two papers.
        Returns a rich data block with both papers' stats, edge data, and
        shared descendants. The LLM narrative is handled by the orchestrator."""
        entities = intent_result.get('entities', [])
        if len(entities) < 2:
            return None

        import networkx as nx

        paper_a_id = entities[0].get('paper_id', '')
        paper_b_id = entities[1].get('paper_id', '')

        if not paper_a_id or not paper_b_id:
            return None

        a = self.nodes.get(paper_a_id, {})
        b = self.nodes.get(paper_b_id, {})

        if not a and not b:
            return None

        # PageRank comparison
        a_rank = self.pagerank.get(paper_a_id, 0)
        b_rank = self.pagerank.get(paper_b_id, 0)

        # Sort all pageranks to get ordinal positions
        sorted_pr = sorted(self.pagerank.values(), reverse=True)
        a_ordinal = sorted_pr.index(a_rank) + 1 if a_rank in sorted_pr else len(sorted_pr)
        b_ordinal = sorted_pr.index(b_rank) + 1 if b_rank in sorted_pr else len(sorted_pr)
        total_papers = len(self.pagerank)

        # Descendants (papers that cite this paper, i.e. predecessors in our directed graph)
        a_desc = set()
        b_desc = set()
        if self.nx_graph and paper_a_id in self.nx_graph:
            a_desc = set(nx.descendants(self.nx_graph.reverse(), paper_a_id)) if paper_a_id in self.nx_graph else set()
        if self.nx_graph and paper_b_id in self.nx_graph:
            b_desc = set(nx.descendants(self.nx_graph.reverse(), paper_b_id)) if paper_b_id in self.nx_graph else set()
        shared_desc = a_desc & b_desc

        # Cluster membership
        a_cluster = None
        b_cluster = None
        dna = self.graph.get('dna_profile', {}) or {}
        for cluster in dna.get('clusters', []):
            for member in cluster.get('members', []):
                mid = member.get('paper_id', '')
                if mid == paper_a_id:
                    a_cluster = cluster.get('name', 'Unknown')
                if mid == paper_b_id:
                    b_cluster = cluster.get('name', 'Unknown')

        same_cluster = a_cluster == b_cluster if a_cluster and b_cluster else None

        # Edge data (check both directions)
        edge_data = None
        for e in self.edges:
            src = e.get('source', '')
            tgt = e.get('target', '')
            if (src == paper_a_id and tgt == paper_b_id) or (src == paper_b_id and tgt == paper_a_id):
                from backend.models import get_confidence_tier
                conf = float(e.get('final_confidence', 0) or e.get('mutation_confidence', 0) or 0)
                edge_data = {
                    'source': src,
                    'target': tgt,
                    'mutation_type': e.get('mutation_type', 'incidental'),
                    'confidence': conf,
                    'confidence_tier': get_confidence_tier(conf),
                    'citation_intent': e.get('citation_intent', ''),
                    'citing_sentence': e.get('citing_sentence'),
                    'cited_sentence': e.get('cited_sentence'),
                    'similarity_score': float(e.get('similarity_score', 0) or 0),
                }
                break

        # Year gap
        a_year = int(a.get('year', 0) or 0)
        b_year = int(b.get('year', 0) or 0)
        year_gap = abs(a_year - b_year) if a_year and b_year else None

        return {
            "type": "relationship_explainer",
            "provenance": "computed",
            "data": {
                "paper_a": {
                    "paper_id": paper_a_id,
                    "title": a.get('title', ''),
                    "year": a_year or None,
                    "citation_count": int(a.get('citation_count', 0) or 0),
                    "pagerank_score": round(a_rank, 4),
                    "pagerank_rank": a_ordinal,
                    "descendants": len(a_desc),
                    "cluster": a_cluster,
                },
                "paper_b": {
                    "paper_id": paper_b_id,
                    "title": b.get('title', ''),
                    "year": b_year or None,
                    "citation_count": int(b.get('citation_count', 0) or 0),
                    "pagerank_score": round(b_rank, 4),
                    "pagerank_rank": b_ordinal,
                    "descendants": len(b_desc),
                    "cluster": b_cluster,
                },
                "edge": edge_data,
                "shared_descendants": len(shared_desc),
                "same_cluster": same_cluster,
                "year_gap": year_gap,
                "total_papers": total_papers,
            }
        }

    def _assemble_graph_stats(self):
        """Build graph-level statistics (no specific paper)."""
        nodes = self.graph.get('nodes', [])
        edges = self.edges
        years = [n.get('year') for n in nodes if n.get('year')]

        stats = [
            {"label": "Total Papers", "value": str(len(nodes)), "source": "computed:graph_count"},
            {"label": "Total Edges", "value": str(len(edges)), "source": "computed:graph_count"},
        ]

        if years:
            stats.append({"label": "Year Range", "value": f"{min(years)}-{max(years)}", "source": "computed:graph_count"})

        # Contradiction count
        contradictions = sum(1 for e in edges if e.get('mutation_type') == 'contradiction')
        if contradictions:
            stats.append({"label": "Contradictions", "value": str(contradictions), "source": "computed:edge_analysis"})

        # Top PageRank paper
        if self.pagerank:
            top_pid = max(self.pagerank, key=self.pagerank.get)
            top_node = self.nodes.get(top_pid, {})
            stats.append({
                "label": "Most Important",
                "value": (top_node.get('title', 'Unknown'))[:30],
                "detail": f"PageRank: {self.pagerank[top_pid]:.4f}",
                "source": "computed:nx.pagerank"
            })

        return {
            "type": "stat_grid",
            "provenance": "computed",
            "data": {"stats": stats}
        }

    # ── Phase B Group 1: Core Block Assemblers ────────────────────────────────

    def _assemble_data_table(self, intent_result):
        """B-03: #060 Data Table -- tabular paper data.
        SSE shape: {headers: [], rows: [[]], sortable, paginated}"""
        entities = intent_result.get('entities', [])
        data_needs = intent_result.get('data_needs', [])

        # Determine which columns to show based on data_needs
        headers = ["Title", "Year", "Citations"]
        include_mutation = "mutation_type" in data_needs or "edge_analysis" in data_needs
        include_pagerank = "pagerank" in data_needs

        if include_pagerank:
            headers.append("PageRank")
        if include_mutation:
            headers.append("Mutation")

        # Data table always shows top papers (not filtered by entities)
        # The user asking for "a table" expects to see multiple papers
        sorted_nodes = sorted(
            self.graph.get('nodes', []),
            key=lambda n: int(n.get('citation_count', 0) or 0),
            reverse=True,
        )
        paper_ids = [(n.get('paper_id') or n.get('id', '')) for n in sorted_nodes[:20]]

        if not paper_ids:
            return None

        rows = []
        for pid in paper_ids:
            node = self.nodes.get(pid, {})
            if not node:
                continue
            title = (node.get('title', 'Unknown') or 'Unknown')[:50]
            year = node.get('year', '')
            cites = node.get('citation_count', 0)
            row = [title, str(year) if year else '', str(cites)]

            if include_pagerank:
                pr = self.pagerank.get(pid, 0)
                row.append(f"{pr:.4f}" if pr else '0')

            if include_mutation:
                # Get dominant mutation type from edges citing this paper
                mutations = {}
                for e in self.edges:
                    if e.get('cited_paper_id') == pid:
                        mt = e.get('mutation_type', 'incidental')
                        mutations[mt] = mutations.get(mt, 0) + 1
                dominant = max(mutations, key=mutations.get) if mutations else '-'
                row.append(dominant)

            rows.append(row)

        if not rows:
            return None

        return {
            "type": "data_table",
            "provenance": "computed",
            "data": {
                "headers": headers,
                "rows": rows,
                "sortable": True,
                "paginated": len(rows) > 20,
            }
        }

    def _assemble_comparison_card(self, intent_result):
        """B-04: #061 Comparison Card -- side-by-side paper metrics.
        SSE shape: {papers: [{paper_id, title, metrics:{}}], diff_summary}"""
        entities = intent_result.get('entities', [])
        if len(entities) < 2:
            return None

        papers = []
        for entity in entities[:3]:  # Max 3 papers in comparison
            pid = entity.get('paper_id', '')
            node = self.nodes.get(pid, {})
            if not node:
                continue

            metrics = {
                "Citations": node.get('citation_count', 0),
                "Year": node.get('year', 'Unknown'),
            }

            # PageRank if available
            if pid in self.pagerank:
                metrics["PageRank"] = round(self.pagerank[pid], 4)

            # Descendant count
            desc_count = sum(
                1 for e in self.edges if e.get('cited_paper_id') == pid
            )
            metrics["Descendants"] = desc_count

            # Ancestor count
            anc_count = sum(
                1 for e in self.edges if e.get('citing_paper_id') == pid
            )
            metrics["Ancestors"] = anc_count

            papers.append({
                "paper_id": pid,
                "title": (node.get('title', 'Unknown') or 'Unknown')[:60],
                "year": node.get('year'),
                "metrics": metrics,
            })

        if len(papers) < 2:
            return None

        # Generate diff summary
        diff_parts = []
        p1, p2 = papers[0], papers[1]
        c1 = p1['metrics'].get('Citations', 0)
        c2 = p2['metrics'].get('Citations', 0)
        if c1 != c2:
            winner = p1['title'][:20] if c1 > c2 else p2['title'][:20]
            diff_parts.append(f"{winner} has more citations")

        pr1 = p1['metrics'].get('PageRank', 0)
        pr2 = p2['metrics'].get('PageRank', 0)
        if pr1 != pr2:
            winner = p1['title'][:20] if pr1 > pr2 else p2['title'][:20]
            diff_parts.append(f"{winner} ranks higher by PageRank")

        diff_summary = '. '.join(diff_parts) + '.' if diff_parts else ''

        return {
            "type": "comparison_card",
            "provenance": "computed",
            "data": {
                "papers": papers,
                "diff_summary": diff_summary,
            }
        }

    def _assemble_timeline(self, intent_result):
        """B-05: #062 Timeline -- chronological paper events.
        SSE shape: {events: [{year, paper_id, title, type}]}"""
        seed_id = self.graph.get('metadata', {}).get('seed_paper_id')
        entities = intent_result.get('entities', [])

        # Timeline always shows ALL papers chronologically (not filtered to entities)
        # Entities are used for highlighting, not filtering
        target_ids = set(self.nodes.keys())

        events = []
        for pid in target_ids:
            node = self.nodes.get(pid, {})
            if not node:
                continue
            year = node.get('year')
            if not year:
                continue
            events.append({
                "year": year,
                "paper_id": pid,
                "title": (node.get('title', 'Unknown') or 'Unknown')[:60],
                "type": "seed" if pid == seed_id else "reference",
            })

        if not events:
            return None

        # Sort by year, limit to top 20 most cited for readability
        events.sort(key=lambda e: e['year'])
        if len(events) > 20:
            # Keep seed paper + top 19 by citation count
            seed_events = [e for e in events if e['type'] == 'seed']
            other_events = [e for e in events if e['type'] != 'seed']
            # Sort others by citation count (need to look up)
            other_events.sort(key=lambda e: self.nodes.get(e['paper_id'], {}).get('citation_count', 0), reverse=True)
            top_events = seed_events + other_events[:19]
            top_events.sort(key=lambda e: e['year'])
            events = top_events

        return {
            "type": "timeline",
            "provenance": "computed",
            "data": {"events": events}
        }

    def _assemble_quote(self, intent_result):
        """B-06: #065 Quote Block -- cited text with source attribution.
        SSE shape: {text, source, paper_id}
        NOTE: Quote blocks are primarily LLM-generated via markers.
        This assembler provides a computed fallback for entity-based quotes."""
        entities = intent_result.get('entities', [])
        if not entities:
            return None

        pid = entities[0].get('paper_id', '')
        node = self.nodes.get(pid, {})
        if not node:
            return None

        # Use the abstract as quote text if available
        abstract = node.get('abstract', '')
        if not abstract:
            return None

        # Truncate to first 2 sentences for a quote
        sentences = abstract.split('. ')
        text = '. '.join(sentences[:2])
        if len(sentences) > 2:
            text += '...'

        authors = node.get('authors', [])
        author_str = authors[0] if authors else 'Unknown'
        year = node.get('year', '')
        source = f"{author_str} et al. ({year})" if year else author_str

        return {
            "type": "quote",
            "provenance": "computed",
            "data": {
                "text": text,
                "source": source,
                "paper_id": pid,
            }
        }

    def _assemble_warning(self, intent_result):
        """B-07: #066 Warning/Alert Block -- contextual alerts.
        SSE shape: {level: "info"|"warn"|"error", message, detail}
        NOTE: Warning blocks are primarily LLM-generated via markers.
        This assembler provides computed warnings (e.g., retracted papers)."""
        warnings = []

        # Check for retracted papers in context
        for pid, node in self.nodes.items():
            if node.get('is_retracted'):
                warnings.append({
                    "type": "warning",
                    "provenance": "computed",
                    "data": {
                        "level": "error",
                        "message": f"Retracted paper detected: {(node.get('title', 'Unknown'))[:40]}",
                        "detail": f"Paper {pid[:12]}... has been flagged as retracted.",
                    }
                })

        # Check for low text tier coverage
        nodes = self.graph.get('nodes', [])
        if nodes:
            title_only = sum(1 for n in nodes if n.get('text_tier', 4) >= 4)
            pct = title_only / len(nodes) * 100
            if pct > 50:
                warnings.append({
                    "type": "warning",
                    "provenance": "computed",
                    "data": {
                        "level": "warn",
                        "message": f"{pct:.0f}% of papers have title-only data",
                        "detail": "Analysis depth may be limited for papers without abstracts.",
                    }
                })

        # Return first warning (single block per call)
        return warnings[0] if warnings else None

    def _assemble_expandable(self, intent_result):
        """B-08: #067 Expandable Section -- collapsible content.
        SSE shape: {title, content, expanded_default}
        NOTE: Expandable blocks are primarily constructed by the orchestrator
        to wrap detailed analysis. This assembler provides a computed fallback."""
        entities = intent_result.get('entities', [])
        if not entities:
            return None

        pid = entities[0].get('paper_id', '')
        node = self.nodes.get(pid, {})
        if not node:
            return None

        # Build detailed paper info as expandable content
        title = node.get('title', 'Unknown')
        abstract = node.get('abstract')
        if not abstract:
            return None

        return {
            "type": "expandable",
            "provenance": "computed",
            "data": {
                "title": f"Full abstract: {title[:40]}...",
                "content": abstract,
                "expanded_default": False,
            }
        }

    def _assemble_code_block(self, intent_result):
        """B-09: #039 Code Block -- syntax-highlighted code.
        SSE shape: {language, code, filename}
        NOTE: Code blocks are primarily LLM-generated. This assembler
        provides a computed fallback for API/query related contexts."""
        # Code blocks are typically LLM-generated, not computed from graph data.
        # This is a no-op assembler that returns None.
        # The orchestrator's marker parser handles code block generation.
        return None

    def _assemble_equation(self, intent_result):
        """B-10: #064 Equation/Formula Block -- LaTeX equations.
        SSE shape: {latex, display_mode}
        NOTE: Equation blocks are primarily LLM-generated. This assembler
        provides a computed fallback."""
        # Equation blocks are typically LLM-generated, not computed from graph data.
        # This is a no-op assembler that returns None.
        # The orchestrator's marker parser handles equation block generation.
        return None

    def _assemble_citation_ref(self, intent_result):
        """Citation reference assembler stub. Handled by marker parser."""
        return None

    def _assemble_footnote(self, intent_result):
        """Footnote assembler stub. Handled by marker parser."""
        return None

    def _assemble_confidence_bar(self, intent_result):
        """Confidence bar assembler stub. Handled by orchestrator."""
        return None

    # ── GROUP 3: CODE VARIANT ASSEMBLERS (B-19 through B-22) ──────────────

    def _assemble_python_code(self, intent_result):
        """B-19: #101 Python Code Block. Primarily LLM-generated."""
        return None

    def _assemble_sql_query(self, intent_result):
        """B-20: #102 SQL Query Block. Primarily LLM-generated."""
        return None

    def _assemble_json_data(self, intent_result):
        """B-21: #103 JSON Data Block.
        Can be computed from graph data when showing raw JSON."""
        entities = intent_result.get('entities', [])
        if not entities:
            return None
        pid = entities[0].get('paper_id', '')
        node = self.nodes.get(pid)
        if not node:
            return None
        return {
            "type": "json_data",
            "provenance": "computed",
            "data": {
                "data": {
                    "paper_id": pid,
                    "title": node.get("title", ""),
                    "year": node.get("year"),
                    "citation_count": node.get("citation_count", 0),
                    "fields_of_study": node.get("fields_of_study", []),
                    "pagerank": round(self.pagerank.get(pid, 0), 4),
                },
                "collapsible": True,
            },
        }

    def _assemble_api_endpoint(self, intent_result):
        """B-22: #104 API Endpoint Block. Primarily LLM-generated."""
        return None

    def _assemble_filter_stats(self, intent_result):
        """Phase C #107: Filter-specific stat card.
        Shows filter name, visible/hidden counts, coverage percentage.
        Only triggered by explicit filter questions (safeguarded in keyword matcher).
        Reads filter data from awareness context injected into intent._awareness."""
        awareness = intent_result.get('_awareness') or {}
        active_filters = awareness.get('active_filters')
        if not active_filters:
            return None

        # Extract filter info
        filter_names = []
        for f in active_filters:
            if isinstance(f, dict):
                filter_names.append(f.get('value', ''))
            else:
                filter_names.append(str(f))
        filter_label = ', '.join(n for n in filter_names if n) or 'Active'

        visible = awareness.get('filter_visible_count', 0)
        hidden = awareness.get('filter_hidden_count', 0)
        total = visible + hidden if (visible or hidden) else len(self.nodes)
        coverage = round(visible / total * 100, 1) if total > 0 else 0

        stats = [
            {"label": "Active Filter", "value": filter_label, "source": "computed:filter"},
            {"label": "Highlighted", "value": f"{visible} papers", "source": "computed:filter"},
            {"label": "Dimmed", "value": f"{hidden} papers", "source": "computed:filter"},
            {"label": "Coverage", "value": f"{coverage}%", "detail": f"{visible} of {total} papers", "source": "computed:filter"},
        ]

        return {
            "type": "stat_grid",
            "provenance": "computed",
            "data": {"stats": stats}
        }
