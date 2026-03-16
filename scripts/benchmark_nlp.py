#!/usr/bin/env python3
"""
scripts/benchmark_nlp.py — Phase 8 replacement

Measures end-to-end graph build time (not sentences/sec).
Target: full build under 90 seconds.

Exit code: 0 = passed, 1 = failed.
"""
import sys
import os
import time
import asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

TARGET_SECONDS = 90
TEST_PAPER_ID  = "204e3073870fae3d05bcbc2f6a8e263d9b72e776"


def main():
    print("=" * 60)
    print("NLP Benchmark — Phase 8 (graph build time)")
    print("=" * 60)

    # 1. Informational: NLP worker throughput
    nlp_throughput()

    # 2. Pass/fail: graph build time
    from backend.api_client import SmartPaperResolver
    from backend.graph_engine import AncestryGraph
    from backend.utils import await_sync

    print(f"\nBuilding graph for test paper: {TEST_PAPER_ID[:16]}...")

    t0 = time.time()

    # Resolve paper
    resolver = SmartPaperResolver()
    seed = await_sync(resolver.resolve_paper(TEST_PAPER_ID))
    t_resolve = time.time() - t0
    print(f"  Paper resolution: {t_resolve:.1f}s")

    if not seed:
        print("FAIL: Could not resolve test paper.")
        sys.exit(1)

    # Build graph
    t1 = time.time()
    graph = AncestryGraph(
        seed_paper=seed,
        session_id="benchmark",
        max_depth=2,
        max_refs_per_node=30,
    )
    await_sync(graph.build())
    t_build = time.time() - t1
    print(f"  BFS crawl + NLP:  {t_build:.1f}s")

    # Export
    t2 = time.time()
    result = graph.export_to_json()
    t_export = time.time() - t2
    print(f"  Export to JSON:   {t_export:.1f}s")

    total = time.time() - t0
    node_count = len(result.get("nodes", []))
    edge_count = len(result.get("edges", []))

    print(f"\n  Total time:  {total:.1f}s")
    print(f"  Nodes: {node_count}, Edges: {edge_count}")

    if total <= TARGET_SECONDS:
        print(f"\nPASS — {total:.1f}s <= {TARGET_SECONDS}s target")
        sys.exit(0)
    else:
        print(f"\nFAIL — {total:.1f}s > {TARGET_SECONDS}s target")
        print("\nOptimization suggestions:")
        print("  - Check edge_analysis cache hit rate (should be >50% on repeat builds)")
        print("  - Use S2 batch endpoint for references (reduces HTTP roundtrips)")
        print("  - Profile DB query time (ensure pgvector index is built)")
        sys.exit(1)


def nlp_throughput():
    """Informational: measure NLP worker /encode_batch speed."""
    import httpx
    from backend.config import config

    try:
        texts = [f"This is test sentence number {i} for benchmark." for i in range(10)]
        t0 = time.time()
        resp = httpx.post(
            f"{config.NLP_WORKER_URL}/encode_batch",
            json={"texts": texts},
            headers={"X-API-Key": config.WORKER_SECRET},
            timeout=30,
        )
        elapsed = time.time() - t0
        if resp.status_code == 200:
            tps = len(texts) / elapsed
            print(f"NLP worker throughput: {tps:.0f} texts/sec ({len(texts)} texts in {elapsed:.2f}s)")
        else:
            print(f"NLP worker returned {resp.status_code} — throughput not measured")
    except Exception as e:
        print(f"NLP worker not reachable: {e}")


if __name__ == "__main__":
    main()
