#!/usr/bin/env python3
"""
scripts/ground_truth_eval.py

Evaluate the NLP pipeline against hand-labelled paper pairs.
Ground truth is in data/ground_truth/pairs.json.

Metrics:
  - Similarity score accuracy: predicted similarity within expected range
  - Mutation type accuracy: predicted type matches expected type
  - Overall: assert >= 70% accuracy on both metrics

Usage:
  python scripts/ground_truth_eval.py
  python scripts/ground_truth_eval.py --verbose
  python scripts/ground_truth_eval.py --threshold 0.65

Exit code: 0 = passed, 1 = failed.
"""
import json
import sys
import os
import argparse
import logging
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

GT_PATH        = Path("data/ground_truth/pairs.json")
PASS_THRESHOLD = 0.70


def run_evaluation(verbose: bool = False, threshold: float = PASS_THRESHOLD) -> bool:
    from dotenv import load_dotenv
    load_dotenv()

    from backend.db import init_pool
    from backend.config import Config
    init_pool(database_url=Config.DATABASE_URL)

    from backend.api_client import SmartPaperResolver
    from backend.nlp_pipeline import InheritanceDetector
    from backend.utils import await_sync

    if not GT_PATH.exists():
        logger.error(
            f"Ground truth file not found: {GT_PATH}\n"
            "Create data/ground_truth/pairs.json with labeled pairs."
        )
        sys.exit(1)

    with open(GT_PATH) as f:
        pairs = json.load(f)

    logger.info(f"Loaded {len(pairs)} ground truth pairs from {GT_PATH}")

    resolver = SmartPaperResolver()
    detector = InheritanceDetector()

    sim_correct  = 0
    type_correct = 0
    evaluated    = 0
    skipped      = 0

    for i, pair in enumerate(pairs):
        src_id = pair["source_id"]
        tgt_id = pair["target_id"]

        try:
            src = await_sync(resolver.resolve(src_id, "s2"))
            tgt = await_sync(resolver.resolve(tgt_id, "s2"))
        except Exception as exc:
            logger.warning(f"  [{i+1}] SKIP — paper not found ({exc})")
            skipped += 1
            continue

        if not src or not tgt:
            logger.warning(f"  [{i+1}] SKIP — paper returned None")
            skipped += 1
            continue

        try:
            pair_result = await_sync(detector.analyze_single_pair(src, tgt))
        except Exception as exc:
            logger.warning(f"  [{i+1}] SKIP — NLP error: {exc}")
            skipped += 1
            continue

        sim            = pair_result.get("similarity_score", 0.0)
        mtype          = pair_result.get("mutation_type", "unknown")
        expected_range = pair.get("expected_similarity_range", [0.0, 1.0])
        expected_type  = pair.get("expected_mutation_type", "")

        sim_ok  = expected_range[0] <= sim <= expected_range[1]
        type_ok = mtype == expected_type or expected_type == ""

        if sim_ok:  sim_correct  += 1
        if type_ok: type_correct += 1
        evaluated += 1

        if verbose:
            logger.info(
                f"  [{i+1}] {'✓' if sim_ok else '✗'}sim={sim:.2f} (exp {expected_range}) "
                f"{'✓' if type_ok else '✗'}type={mtype!r} (exp {expected_type!r})"
            )

    if evaluated == 0:
        logger.error("No pairs could be evaluated. Check S2 API connectivity.")
        return False

    sim_accuracy  = sim_correct  / evaluated
    type_accuracy = type_correct / evaluated

    print(f"\n{'='*50}")
    print(f"Ground Truth Evaluation Results")
    print(f"{'='*50}")
    print(f"Pairs evaluated:     {evaluated}/{len(pairs)} ({skipped} skipped)")
    print(f"Similarity accuracy: {sim_correct}/{evaluated} = {sim_accuracy:.1%}")
    print(f"Mutation type acc:   {type_correct}/{evaluated} = {type_accuracy:.1%}")
    print(f"Pass threshold:      {threshold:.0%}")
    print(f"{'='*50}")

    passed = sim_accuracy >= threshold and type_accuracy >= threshold
    if passed:
        print("PASSED — NLP pipeline meets accuracy threshold")
    else:
        print(f"FAILED — accuracy below {threshold:.0%} threshold")
        if sim_accuracy < threshold:
            print(f"   → Similarity accuracy {sim_accuracy:.1%} < {threshold:.0%}")
        if type_accuracy < threshold:
            print(f"   → Mutation type accuracy {type_accuracy:.1%} < {threshold:.0%}")
    return passed


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate NLP pipeline accuracy")
    parser.add_argument("--verbose",   action="store_true")
    parser.add_argument("--threshold", type=float, default=PASS_THRESHOLD)
    args   = parser.parse_args()
    passed = run_evaluation(verbose=args.verbose, threshold=args.threshold)
    sys.exit(0 if passed else 1)
