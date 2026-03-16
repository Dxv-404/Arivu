#!/usr/bin/env python3
"""
scripts/precompute_gallery.py — Phase 8 replacement

Pre-compute gallery graphs for 7 iconic papers.
Results stored in R2 as precomputed/{slug}.json.
Also stores graph_id and leaderboard_json in the graphs table (GAP-P8-60).

GAP-P8-29: exponential backoff between papers to respect S2 API quotas.

Usage: python scripts/precompute_gallery.py [--slug NAME] [--force]
"""
import sys
import os
import json
import time
import asyncio
import argparse
import logging
import math
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

from backend.config import config
from backend.graph_engine import AncestryGraph
from backend.api_client import SmartPaperResolver
from backend.dna_profiler import DNAProfiler
from backend.diversity_scorer import DiversityScorer
from backend.pruning import compute_pruning_result, compute_all_pruning_impacts
from backend.r2_client import R2Client
from backend.db import init_pool, execute, fetchone
from backend.utils import await_sync, GALLERY_INDEX_PATH

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# Canonical gallery papers — full Semantic Scholar corpus IDs (CLAUDE.md Part 15)
GALLERY_PAPERS = [
    {"slug": "attention", "paper_id": "204e3073870fae3d05bcbc2f6a8e263d9b72e776"},
    {"slug": "alexnet",   "paper_id": "abd1c342495432171beb7ca8fd9551ef13cbd0ff"},
    {"slug": "bert",      "paper_id": "df2b0e26d0599ce3e70df8a9da02e51594e0e992"},
    {"slug": "gans",      "paper_id": "54e325aee6b2d476bbbb88615ac15e251c6e8214"},
    {"slug": "word2vec",  "paper_id": "330da625c15427c6e42ccfa3b747fb29e5835bf0"},
    {"slug": "resnet",    "paper_id": "2c03df8b48bf3fa39054345bafabfeff15bfd11d"},
    {"slug": "gpt2",      "paper_id": "9405cc0d6169988371b2755e573cc28650d14dfe"},
]


def precompute_paper(slug: str, paper_id: str, r2: R2Client, force: bool = False) -> dict:
    """Build and store all precomputed data for one gallery paper."""
    logger.info(f"Processing {slug} ({paper_id[:16]}...)...")

    # Skip if already computed (unless --force)
    if not force and r2.exists(f"precomputed/{slug}.json"):
        logger.info(f"  {slug} already precomputed, skipping (use --force)")
        existing = r2.get_json(f"precomputed/{slug}.json")
        return existing.get("metadata", {}) if existing else {}

    # 1. Resolve paper
    resolver = SmartPaperResolver()
    seed = await_sync(resolver.resolve_paper(paper_id))
    if not seed:
        raise RuntimeError(f"Could not resolve paper {paper_id}")
    logger.info(f"  Resolved: {seed.title}")

    # 2. Build graph
    t0 = time.time()
    graph = AncestryGraph(
        seed_paper=seed,
        session_id=f"gallery_{slug}",
        max_depth=2,
        max_refs_per_node=30,
    )
    await_sync(graph.build())
    build_time = time.time() - t0
    logger.info(f"  Graph built in {build_time:.1f}s: {len(graph.nodes)} nodes")

    # 3. Export full graph JSON
    graph_json = graph.export_to_json()

    # 4. Add precomputed pruning for the seed paper (needed for landing demo)
    seed_pruning = compute_pruning_result(
        graph.graph, [paper_id], graph.nodes, graph.seed_paper_id
    )
    graph_json["precomputed_pruning"] = {paper_id: seed_pruning.to_dict()}

    # 5. Compute leaderboard (GAP-P8-60)
    all_impacts = compute_all_pruning_impacts(graph.graph, graph.seed_paper_id)
    leaderboard = sorted(
        [{"paper_id": pid, **data} for pid, data in all_impacts.items()],
        key=lambda x: x.get("collapse_count", 0),
        reverse=True,
    )[:10]
    graph_json["leaderboard"] = leaderboard

    # 6. DNA profile
    paper_ids = list(graph.nodes.keys())
    dna_profiler = DNAProfiler()
    dna = dna_profiler.compute_profile(paper_ids, graph.seed_paper_id, graph.nodes)
    graph_json["dna_profile"] = dna.to_dict() if hasattr(dna, "to_dict") else dna

    # 7. Diversity score
    diversity = DiversityScorer().compute_score(paper_ids, graph.nodes)
    graph_json["diversity_score"] = diversity.to_dict() if hasattr(diversity, "to_dict") else diversity

    # 8. Upload full graph to R2
    r2.put_json(f"precomputed/{slug}.json", graph_json)
    logger.info(f"  Full graph uploaded to R2")

    # 9. Build preview graph (top 20 nodes by citation count)
    top_nodes = sorted(
        graph_json["nodes"],
        key=lambda n: n.get("citation_count", 0),
        reverse=True,
    )[:20]
    top_ids = {n["id"] for n in top_nodes}
    preview = {
        "nodes": top_nodes,
        "edges": [
            e for e in graph_json["edges"]
            if e["source"] in top_ids and e["target"] in top_ids
        ],
        "metadata": graph_json["metadata"],
    }
    r2.put_json(f"previews/{slug}/graph.json", preview)
    logger.info(f"  Preview graph uploaded")

    # 10. Generate mini SVG preview
    mini_svg = generate_mini_svg(preview)
    r2.put(f"previews/{slug}.svg", mini_svg.encode("utf-8"), "image/svg+xml")
    logger.info(f"  Mini SVG uploaded")

    # 11. Store graph_id and leaderboard_json in graphs table (GAP-P8-60)
    graph_id = graph_json.get("metadata", {}).get("graph_id", "")
    if graph_id:
        try:
            existing_row = fetchone(
                "SELECT session_id FROM graphs WHERE graph_id = %s", (graph_id,)
            )
            leaderboard_json_str = json.dumps(leaderboard)
            if existing_row:
                execute(
                    "UPDATE graphs SET leaderboard_json = %s, last_accessed = NOW() WHERE graph_id = %s",
                    (leaderboard_json_str, graph_id),
                )
            else:
                execute(
                    """INSERT INTO graphs (session_id, seed_paper_id, graph_id, leaderboard_json, last_accessed, computed_at)
                       VALUES (%s, %s, %s, %s, NOW(), NOW())
                       ON CONFLICT DO NOTHING""",
                    (f"gallery_{slug}", paper_id, graph_id, leaderboard_json_str),
                )
            logger.info(f"  graphs table updated with graph_id and leaderboard_json")
        except Exception as e:
            logger.warning(f"  Failed to update graphs table: {e}")

    # 12. Generate genealogy text (requires GROQ_API_KEY)
    if config.GROQ_ENABLED:
        try:
            from backend.llm_client import get_llm_client
            llm = get_llm_client()
            genealogy_result = llm.generate_genealogy_story(graph_json)
            genealogy_text = (
                genealogy_result.get("narrative", "")
                if isinstance(genealogy_result, dict)
                else str(genealogy_result)
            )
            r2.put_text(f"precomputed/{slug}/genealogy.md", genealogy_text)
            logger.info(f"  Genealogy text uploaded")
        except Exception as e:
            logger.warning(f"  Genealogy generation failed: {e}")

    stats = {
        "papers": len(graph_json["nodes"]),
        "edges": len(graph_json["edges"]),
        "fields": len(set(
            f for n in graph_json["nodes"] for f in n.get("fields_of_study", [])
        )),
        "depth": 2,
        "build_time_seconds": round(build_time, 1),
    }

    # Update gallery_index.json
    _update_gallery_index(slug, stats)

    logger.info(f"  {slug} complete: {stats}")
    return stats


def _update_gallery_index(slug: str, stats: dict) -> None:
    """Update gallery_index.json with stats for a slug."""
    try:
        if GALLERY_INDEX_PATH.exists():
            gallery = json.loads(GALLERY_INDEX_PATH.read_text())
            for entry in gallery:
                if entry.get("slug") == slug:
                    entry.setdefault("stats", {}).update({
                        "papers": stats["papers"],
                        "edges": stats["edges"],
                    })
            GALLERY_INDEX_PATH.write_text(json.dumps(gallery, indent=2))
            logger.info(f"  gallery_index.json updated for {slug}")
    except Exception as e:
        logger.warning(f"  Failed to update gallery_index.json: {e}")


def generate_mini_svg(preview_graph: dict, width: int = 200, height: int = 150) -> str:
    """Generate a tiny SVG preview of the graph. No external dependencies."""
    nodes = preview_graph.get("nodes", [])
    edges = preview_graph.get("edges", [])

    if not nodes:
        return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}"></svg>'

    positions = {}
    n = len(nodes)
    cx, cy = width / 2, height / 2
    r = min(width, height) * 0.38

    for i, node in enumerate(nodes):
        angle = (2 * math.pi * i / n) - math.pi / 2
        positions[node["id"]] = (cx + r * math.cos(angle), cy + r * math.sin(angle))

    svg_parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'style="background:#0a0e17">'
    ]

    for edge in edges[:50]:
        src = positions.get(edge["source"])
        tgt = positions.get(edge["target"])
        if src and tgt:
            svg_parts.append(
                f'<line x1="{src[0]:.1f}" y1="{src[1]:.1f}" '
                f'x2="{tgt[0]:.1f}" y2="{tgt[1]:.1f}" '
                f'stroke="#475569" stroke-width="0.5" stroke-opacity="0.4"/>'
            )

    for node in nodes:
        pos = positions.get(node["id"])
        if not pos:
            continue
        size = 1.5 + math.log10(node.get("citation_count", 1) + 1) * 1.2
        color = "#3B82F6" if "Computer" in str(node.get("fields_of_study", [])) else "#D4A843"
        svg_parts.append(
            f'<circle cx="{pos[0]:.1f}" cy="{pos[1]:.1f}" r="{size:.1f}" '
            f'fill="{color}" opacity="0.8"/>'
        )

    svg_parts.append("</svg>")
    return "\n".join(svg_parts)


def main():
    parser = argparse.ArgumentParser(description="Precompute Arivu gallery entries")
    parser.add_argument("--slug", help='Only process this slug (e.g., "attention")')
    parser.add_argument("--force", action="store_true", help="Recompute even if exists")
    args = parser.parse_args()

    # Initialize
    init_pool(config.DATABASE_URL, config.DB_POOL_MIN, config.DB_POOL_MAX)
    r2 = R2Client(config)

    papers_to_process = GALLERY_PAPERS
    if args.slug:
        papers_to_process = [p for p in GALLERY_PAPERS if p["slug"] == args.slug]
        if not papers_to_process:
            logger.error(f"Unknown slug: {args.slug}")
            sys.exit(1)

    results = {}
    backoff = 2  # GAP-P8-29: exponential backoff between papers

    for i, paper in enumerate(papers_to_process):
        try:
            stats = precompute_paper(paper["slug"], paper["paper_id"], r2, force=args.force)
            results[paper["slug"]] = {"status": "success", "stats": stats}
            backoff = 2  # Reset on success
        except Exception as e:
            logger.error(f"Failed to precompute {paper['slug']}: {e}", exc_info=True)
            results[paper["slug"]] = {"status": "error", "error": str(e)}
            backoff = min(backoff * 2, 60)  # Exponential backoff on failure

        # GAP-P8-29: wait between papers to respect S2 API quotas
        if i < len(papers_to_process) - 1:
            logger.info(f"  Waiting {backoff}s before next paper...")
            time.sleep(backoff)

    # Summary
    logger.info("\n" + "=" * 50)
    logger.info("PRECOMPUTE SUMMARY")
    ok_count = 0
    for slug, result in results.items():
        status = "OK" if result["status"] == "success" else "FAIL"
        if result["status"] == "success":
            ok_count += 1
        logger.info(f"  {status} {slug}: {result.get('stats', result.get('error', ''))}")
    logger.info(f"\n{ok_count}/{len(results)} papers precomputed successfully.")


if __name__ == "__main__":
    main()
