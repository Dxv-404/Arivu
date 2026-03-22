"""
backend/pruning.py

Stateless pruning computation functions.
These operate on a pre-built AncestryGraph and compute what would collapse
if one or more papers were removed from the citation graph.

The AncestryGraph.compute_pruning() method in graph_engine.py delegates
to these functions, keeping graph_engine.py focused on building.

Used by:
  - app.py: POST /api/prune
  - scripts/precompute_gallery.py: build precomputed pruning for gallery
"""
import logging
from collections import deque
from dataclasses import dataclass, field

import networkx as nx

logger = logging.getLogger(__name__)


@dataclass
class PruningResult:
    """Result of pruning one or more papers from the graph."""
    pruned_ids: list
    collapsed_nodes: list       # [{"paper_id": ..., "bfs_level": ...}]
    surviving_nodes: list       # [{"paper_id": ..., "survival_path": [...]}]
    impact_percentage: float
    total_nodes: int
    collapsed_count: int
    survived_count: int
    dna_before: dict
    dna_after: dict

    def to_dict(self) -> dict:
        return {
            "pruned_ids": self.pruned_ids,
            "collapsed_nodes": self.collapsed_nodes,
            "surviving_nodes": self.surviving_nodes,
            "impact_percentage": round(self.impact_percentage, 2),
            "total_nodes": self.total_nodes,
            "collapsed_count": self.collapsed_count,
            "survived_count": self.survived_count,
            "dna_before": self.dna_before,
            "dna_after": self.dna_after,
        }


def compute_pruning_result(graph_nx: nx.DiGraph, pruned_ids: list,
                            all_papers: dict, seed_id: str) -> PruningResult:
    """
    Compute what would collapse if pruned_ids were removed from graph_nx.

    Args:
        graph_nx: NetworkX DiGraph from AncestryGraph.graph
        pruned_ids: list of paper_id strings to prune
        all_papers: dict[paper_id → Paper] for DNA computation
        seed_id: seed paper ID (root of the graph)

    Returns:
        PruningResult
    """
    # First: compute BASELINE reachability from seed BEFORE pruning.
    # Some nodes may be unreachable from seed even in the original graph
    # (e.g., papers that cite the seed but aren't referenced by it).
    # These "always-unreachable" nodes must be excluded from collapse counts
    # to avoid inflating the impact of every prune operation.
    baseline_reachable = set()
    if graph_nx.has_node(seed_id):
        queue = deque([seed_id])
        while queue:
            node = queue.popleft()
            if node in baseline_reachable:
                continue
            baseline_reachable.add(node)
            for successor in graph_nx.successors(node):
                queue.append(successor)

    working_graph = graph_nx.copy()

    for pid in pruned_ids:
        if working_graph.has_node(pid):
            working_graph.remove_node(pid)

    # BFS from seed in the working graph (after pruning)
    if seed_id in set(pruned_ids):
        # Seed was pruned — everything that was reachable collapses
        reachable = set()
    elif working_graph.has_node(seed_id):
        reachable = set()
        queue = deque([seed_id])
        while queue:
            node = queue.popleft()
            if node in reachable:
                continue
            reachable.add(node)
            for successor in working_graph.successors(node):
                queue.append(successor)
    else:
        reachable = set()

    # Collapsed = nodes that WERE reachable before pruning but are NOT reachable after.
    # Exclude: pruned nodes themselves and nodes that were never reachable (baseline).
    collapsed_nodes_set = (baseline_reachable - reachable) - set(pruned_ids)
    surviving_nodes_set = reachable

    # Group collapsed nodes by BFS distance from any pruned node
    collapsed_with_distance = []
    for node in collapsed_nodes_set:
        min_dist = float("inf")
        for pid in pruned_ids:
            if graph_nx.has_node(pid):
                try:
                    dist = nx.shortest_path_length(graph_nx, node, pid)
                    min_dist = min(min_dist, dist)
                except nx.NetworkXNoPath:
                    pass
        collapsed_with_distance.append({
            "paper_id": node,
            "bfs_level": int(min_dist) if min_dist != float("inf") else 99,
        })

    collapsed_with_distance.sort(key=lambda x: x["bfs_level"])

    # Find survival paths for nodes that were descendants of pruned papers
    original_descendants = set()
    for pid in pruned_ids:
        if graph_nx.has_node(pid):
            original_descendants.update(nx.descendants(graph_nx, pid))

    survival_paths = []
    for node in surviving_nodes_set:
        if node not in original_descendants:
            continue
        # This node survived despite being a descendant of a pruned node
        # Find path back to seed (the only valid root)
        if working_graph.has_node(seed_id):
            try:
                path = nx.shortest_path(working_graph, seed_id, node)
                if path:
                    survival_paths.append({"paper_id": node, "survival_path": path})
            except nx.NetworkXNoPath:
                pass

    # Before/after DNA (simple version — cluster count by field of study)
    dna_before = _simple_dna(graph_nx, all_papers, set())
    dna_after = _simple_dna(graph_nx, all_papers, set(pruned_ids))

    # Use baseline reachable count as the denominator — not total graph nodes.
    # This excludes nodes that were never reachable from seed.
    total = len(baseline_reachable) if baseline_reachable else len(graph_nx.nodes())
    collapsed_count = len(collapsed_nodes_set)

    return PruningResult(
        pruned_ids=pruned_ids,
        collapsed_nodes=collapsed_with_distance,
        surviving_nodes=survival_paths,
        impact_percentage=(collapsed_count / total * 100) if total > 0 else 0.0,
        total_nodes=total,
        collapsed_count=collapsed_count,
        survived_count=len(surviving_nodes_set),
        dna_before=dna_before,
        dna_after=dna_after,
    )


def compute_all_pruning_impacts(graph_nx: nx.DiGraph, seed_id: str = None) -> dict:
    """
    Precompute collapse count for every node in the graph.
    O(n²) — for 300 nodes this runs in under 3 seconds.
    Returns: dict[paper_id → {"collapse_count": int, "impact_pct": float}]
    Used to populate the impact leaderboard.

    Args:
        graph_nx: NetworkX DiGraph from AncestryGraph.graph
        seed_id: seed paper ID (root of the graph). If provided, BFS only
                 starts from seed — giving accurate collapse counts. If None,
                 falls back to the seed being the node with in_degree == 0.
    """
    impacts = {}

    # Determine the seed if not explicitly provided
    if seed_id is None:
        roots = [n for n in graph_nx.nodes() if graph_nx.in_degree(n) == 0]
        seed_id = roots[0] if roots else None

    if seed_id is None:
        return {node: {"collapse_count": 0, "impact_pct": 0.0} for node in graph_nx.nodes()}

    # Compute baseline reachability from seed BEFORE any removals.
    # Nodes unreachable from seed in the original graph must be excluded
    # from collapse counts (they would inflate every node's impact).
    baseline_reachable = set()
    queue = deque([seed_id])
    while queue:
        n = queue.popleft()
        if n in baseline_reachable:
            continue
        baseline_reachable.add(n)
        for s in graph_nx.successors(n):
            queue.append(s)

    total = len(baseline_reachable)

    for node in graph_nx.nodes():
        if node not in baseline_reachable:
            # This node is unreachable from seed — removing it collapses nothing
            collapsed_count = 0
        elif node == seed_id:
            # Removing the seed collapses everything reachable
            collapsed_count = total - 1
        else:
            working = graph_nx.copy()
            working.remove_node(node)

            # BFS only from seed
            reachable = set()
            if working.has_node(seed_id):
                q = deque([seed_id])
                while q:
                    n = q.popleft()
                    if n in reachable:
                        continue
                    reachable.add(n)
                    for s in working.successors(n):
                        q.append(s)

            # Collapsed = baseline reachable nodes that are no longer reachable (minus the removed node)
            collapsed_count = len((baseline_reachable - reachable) - {node})

        impacts[node] = {
            "collapse_count": collapsed_count,
            "impact_pct": round(collapsed_count / total * 100, 1) if total > 0 else 0.0,
        }

    return impacts


def _simple_dna(graph_nx: nx.DiGraph, all_papers: dict, exclude_ids: set) -> dict:
    """
    Compute a simple field-of-study distribution for the graph,
    optionally excluding some papers.
    Returns dict[field_name → percentage].
    """
    field_counts: dict[str, int] = {}
    total = 0
    for paper_id in graph_nx.nodes():
        if paper_id in exclude_ids:
            continue
        paper = all_papers.get(paper_id)
        if not paper:
            continue
        fields = getattr(paper, "fields_of_study", []) or []
        if fields:
            f = fields[0]
            field_counts[f] = field_counts.get(f, 0) + 1
            total += 1
        else:
            field_counts["Unknown"] = field_counts.get("Unknown", 0) + 1
            total += 1

    if total == 0:
        return {}
    return {f: round(c / total * 100, 1) for f, c in field_counts.items()}
