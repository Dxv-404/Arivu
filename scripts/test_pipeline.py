#!/usr/bin/env python3
"""
scripts/test_pipeline.py — Phase 2 integration test.

Tests the full paper resolution and graph build pipeline end-to-end.
Requires:
    - DATABASE_URL set in .env
    - NLP worker running at config.NLP_WORKER_URL
    - Network access to Semantic Scholar

Run: python scripts/test_pipeline.py
Exit 0 = all tests passed. Exit 1 = any test failed.
"""
import asyncio
import logging
import sys
import time

# Load .env before any config import
from dotenv import load_dotenv
load_dotenv()

sys.path.insert(0, ".")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("test_pipeline")

ATTENTION_DOI = "10.48550/arXiv.1706.03762"   # "Attention Is All You Need"
ATTENTION_ARXIV = "1706.03762"


async def run_tests() -> int:
    """Returns number of failures."""
    from backend.config import config
    from backend.api_client import SmartPaperResolver
    from backend.normalizer import normalize_user_input
    from backend.deduplicator import PaperDeduplicator
    import backend.db as db

    failures = 0
    passed = 0

    logger.info("=" * 60)
    logger.info("ARIVU PHASE 2 INTEGRATION TEST")
    logger.info("=" * 60)

    # ── Test 1: NLP worker health ─────────────────────────────────────────────
    logger.info("\n[1] NLP Worker Health")
    try:
        import httpx
        async with httpx.AsyncClient(timeout=10) as c:
            resp = await c.get(f"{config.NLP_WORKER_URL}/health")
            resp.raise_for_status()
            data = resp.json()
            assert data.get("status") == "ok", f"Expected status=ok, got: {data}"
            logger.info(f"  ✓ NLP worker healthy — model: {data.get('model')}")
            passed += 1
    except Exception as e:
        logger.error(f"  ✗ NLP worker unreachable: {e}")
        logger.error(f"    Start it with: cd nlp_worker && uvicorn app:app --port 7860")
        failures += 1

    # ── Test 2: Input normalization ───────────────────────────────────────────
    logger.info("\n[2] Input Normalization")
    test_cases = [
        ("10.1145/3292500.3330683", "doi"),
        ("1706.03762", "arxiv"),
        ("https://arxiv.org/abs/1706.03762", "arxiv"),
        ("https://www.semanticscholar.org/paper/Title/" + "a" * 40, "s2"),
        ("12345678", "pubmed"),
        ("Attention Is All You Need", "title"),
    ]
    for inp, expected_type in test_cases:
        _, id_type = normalize_user_input(inp)
        if id_type == expected_type:
            logger.info(f"  ✓ '{inp[:40]}' → {id_type}")
            passed += 1
        else:
            logger.error(f"  ✗ '{inp[:40]}' → {id_type} (expected {expected_type})")
            failures += 1

    # ── Test 3: Paper resolution ──────────────────────────────────────────────
    logger.info("\n[3] Paper Resolution (requires network)")
    resolver = SmartPaperResolver()
    seed_paper = None

    try:
        seed_paper = await resolver.resolve(ATTENTION_ARXIV, "arxiv")
        assert seed_paper.paper_id, "paper_id is empty"
        assert seed_paper.title, "title is empty"
        assert "Attention" in seed_paper.title or "attention" in seed_paper.title.lower(), \
            f"Unexpected title: {seed_paper.title}"
        logger.info(f"  ✓ Resolved: '{seed_paper.title[:60]}'")
        logger.info(f"    paper_id={seed_paper.paper_id[:12]}… year={seed_paper.year}")
        logger.info(f"    abstract={'yes' if seed_paper.abstract else 'no'}")
        passed += 1
    except Exception as e:
        logger.error(f"  ✗ Resolution failed: {e}")
        failures += 1

    # ── Test 4: Reference fetching ────────────────────────────────────────────
    logger.info("\n[4] Reference Fetching")
    if seed_paper:
        try:
            refs = await resolver.get_references(seed_paper.paper_id, limit=20)
            assert len(refs) > 0, "No references returned"
            logger.info(f"  ✓ Got {len(refs)} references for '{seed_paper.title[:40]}'")
            logger.info(f"    Sample: '{refs[0].title[:50]}'")
            passed += 1
        except Exception as e:
            logger.error(f"  ✗ Reference fetch failed: {e}")
            failures += 1
    else:
        logger.warning("  ⚠ Skipped — seed paper not resolved")

    # ── Test 5: NLP similarity ────────────────────────────────────────────────
    logger.info("\n[5] NLP Similarity (NLP worker)")
    try:
        import httpx
        from backend.config import config
        headers = {}
        if config.NLP_WORKER_SECRET:
            headers["Authorization"] = f"Bearer {config.NLP_WORKER_SECRET}"

        async with httpx.AsyncClient(timeout=30) as c:
            resp = await c.post(
                f"{config.NLP_WORKER_URL}/similarity_matrix",
                headers=headers,
                json={
                    "texts_a": [
                        "We propose a new attention mechanism that allows the model "
                        "to focus on relevant parts of the input sequence."
                    ],
                    "texts_b": [
                        "Multi-head attention allows the model to jointly attend to "
                        "information from different representation subspaces."
                    ],
                },
            )
            resp.raise_for_status()
            data = resp.json()
            score = data["max_pair"]["score"]
            assert score > 0.5, f"Expected similarity > 0.5, got {score:.3f}"
            logger.info(f"  ✓ Attention pair similarity: {score:.3f}")
            passed += 1
    except Exception as e:
        logger.error(f"  ✗ NLP similarity test failed: {e}")
        failures += 1

    # ── Test 6: Graph build (shallow) ─────────────────────────────────────────
    logger.info("\n[6] Graph Build (depth=1, quick_overview)")
    if seed_paper:
        try:
            from backend.graph_engine import AncestryGraph
            import backend.db as _db
            # Temporarily override max depth
            engine = AncestryGraph()
            job_id = "test-" + str(int(time.time()))
            # Create minimal build_jobs row so _emit() doesn't fail
            _db.execute(
                "INSERT INTO build_jobs (job_id, paper_id, session_id, status, created_at) "
                "VALUES (%s, %s, 'test', 'pending', NOW()) ON CONFLICT DO NOTHING",
                (job_id, seed_paper.paper_id),
            )
            graph_json = await engine.build_graph(
                seed_paper.paper_id,
                user_goal="quick_overview",
                job_id=job_id,
            )
            n_nodes = graph_json["metadata"]["total_nodes"]
            n_edges = graph_json["metadata"]["total_edges"]
            assert n_nodes >= 2, f"Graph too small: {n_nodes} nodes"
            assert n_edges >= 1, f"Graph has no edges"
            logger.info(f"  ✓ Graph built: {n_nodes} nodes, {n_edges} edges")
            # Verify all required metadata fields
            meta = graph_json["metadata"]
            for field in ("seed_paper_id", "seed_paper_title", "total_nodes",
                          "total_edges", "model_version", "graph_id"):
                assert field in meta, f"Missing metadata field: {field}"
            logger.info(f"  ✓ All metadata fields present")
            passed += 2
        except Exception as e:
            logger.error(f"  ✗ Graph build failed: {e}", exc_info=True)
            failures += 1
    else:
        logger.warning("  ⚠ Skipped — seed paper not resolved")

    # ── Summary ───────────────────────────────────────────────────────────────
    total = passed + failures
    logger.info("\n" + "=" * 60)
    logger.info(f"RESULTS: {passed}/{total} passed, {failures} failed")

    if failures:
        logger.error("\nFailed tests:")
        return failures
    else:
        logger.info("All tests passed! Phase 2 complete.")
        return 0


if __name__ == "__main__":
    code = asyncio.run(run_tests())
    sys.exit(code)
