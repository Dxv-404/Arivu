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
    working_graph = graph_nx.copy()

    for pid in pruned_ids:
        if working_graph.has_node(pid):
            working_graph.remove_node(pid)

    # Find root nodes in working graph
    # In Arivu's DAG: edges go FROM citing paper TO cited paper.
    # Roots are papers with no predecessors in the working graph.
    roots = [n for n in working_graph.nodes() if working_graph.in_degree(n) == 0]

    # BFS from roots to find all reachable nodes
    reachable = set()
    queue = deque(roots)
    while queue:
        node = queue.popleft()
        if node in reachable:
            continue
        reachable.add(node)
        for successor in working_graph.successors(node):
            queue.append(successor)

    # Nodes in original graph (minus pruned) not reachable = collapsed
    all_nodes = set(graph_nx.nodes()) - set(pruned_ids)
    collapsed_nodes_set = all_nodes - reachable
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
        for root in roots:
            try:
                path = nx.shortest_path(working_graph, node, root)
                if path:
                    survival_paths.append({"paper_id": node, "survival_path": path})
                    break
            except nx.NetworkXNoPath:
                continue

    # Before/after DNA (simple version — cluster count by field of study)
    dna_before = _simple_dna(graph_nx, all_papers, set())
    dna_after = _simple_dna(graph_nx, all_papers, set(pruned_ids))

    total = len(graph_nx.nodes())
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


def compute_all_pruning_impacts(graph_nx: nx.DiGraph) -> dict:
    """
    Precompute collapse count for every node in the graph.
    O(n²) — for 300 nodes this runs in under 3 seconds.
    Returns: dict[paper_id → {"collapse_count": int, "impact_pct": float}]
    Used to populate the impact leaderboard.
    """
    impacts = {}
    total = len(graph_nx.nodes())

    for node in graph_nx.nodes():
        working = graph_nx.copy()
        working.remove_node(node)

        roots = [n for n in working.nodes() if working.in_degree(n) == 0]
        reachable = set()
        queue = deque(roots)
        while queue:
            n = queue.popleft()
            if n in reachable:
                continue
            reachable.add(n)
            for s in working.successors(n):
                queue.append(s)

        collapsed = (set(graph_nx.nodes()) - {node}) - reachable
        impacts[node] = {
            "collapse_count": len(collapsed),
            "impact_pct": round(len(collapsed) / total * 100, 1) if total > 0 else 0.0,
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
