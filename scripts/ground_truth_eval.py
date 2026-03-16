#!/usr/bin/env python3
"""
scripts/ground_truth_eval.py — Phase 8 replacement

Evaluate the NLP pipeline against inline ground truth pairs.
Uses edge_analysis table data (must have been built via precompute or live build).

Pass threshold: 80% mutation type accuracy.
Exit code: 0 = passed, 1 = failed.
"""
import sys
import os

# Ensure project root on sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

import backend.db as db

# Inline ground truth — 5 labeled pairs
GROUND_TRUTH = [
    {"citing": "204E3073", "cited": "fc26b9c1", "expected_type": "generalization", "expected_sim": 0.75},
    {"citing": "df2b0e16", "cited": "204E3073", "expected_type": "adoption",       "expected_sim": 0.80},
    {"citing": "2c03df8b", "cited": "5d9f9b49", "expected_type": "generalization", "expected_sim": 0.70},
    {"citing": "9405cc0d", "cited": "df2b0e16", "expected_type": "adoption",       "expected_sim": 0.82},
    {"citing": "1b6d81dd", "cited": "204E3073", "expected_type": "specialization", "expected_sim": 0.72},
]

PASS_THRESHOLD = 0.80


def main():
    print("=" * 60)
    print("Ground Truth Evaluation — Phase 8")
    print("=" * 60)

    evaluated = 0
    skipped   = 0
    correct   = 0
    sim_errors = []

    for pair in GROUND_TRUTH:
        # Try to find edge in DB (partial ID match)
        row = db.fetchone(
            """
            SELECT mutation_type, similarity_score, mutation_confidence
            FROM edge_analysis
            WHERE edge_id LIKE %s
            LIMIT 1
            """,
            (f"%{pair['citing']}%:%{pair['cited']}%",),
        )
        if not row:
            print(f"  SKIP  {pair['citing'][:8]}→{pair['cited'][:8]} (not in DB)")
            skipped += 1
            continue

        evaluated += 1
        actual_type = row["mutation_type"]
        actual_sim  = float(row.get("similarity_score", 0))

        type_match = actual_type == pair["expected_type"]
        if type_match:
            correct += 1
        sim_error = abs(actual_sim - pair["expected_sim"])
        sim_errors.append(sim_error)

        status = "OK" if type_match else "MISS"
        print(f"  [{status}]  {pair['citing'][:8]}→{pair['cited'][:8]}  "
              f"expected={pair['expected_type']}  got={actual_type}  "
              f"sim={actual_sim:.3f} (expected {pair['expected_sim']:.2f})")

    print()
    if evaluated == 0:
        print("FAIL: No ground truth pairs found in DB. Run precompute_gallery.py first.")
        sys.exit(1)

    accuracy = correct / evaluated
    mean_sim_error = sum(sim_errors) / len(sim_errors) if sim_errors else 0

    print(f"Pairs evaluated: {evaluated}/{len(GROUND_TRUTH)}")
    print(f"Skipped:         {skipped}")
    print(f"Mutation type accuracy: {accuracy:.1%} ({correct}/{evaluated})")
    print(f"Similarity MAE:         {mean_sim_error:.3f}")
    print()

    if accuracy >= PASS_THRESHOLD:
        print(f"PASS — accuracy {accuracy:.1%} >= {PASS_THRESHOLD:.0%} threshold")
        sys.exit(0)
    else:
        print(f"FAIL — accuracy {accuracy:.1%} < {PASS_THRESHOLD:.0%} threshold")
        sys.exit(1)


if __name__ == "__main__":
    main()
