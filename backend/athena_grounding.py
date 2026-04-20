"""
backend/athena_grounding.py

Grounding verification for Athena responses.
Checks LLM-generated numbers against computed graph data.
Per ATHENA_CLAUDE.md Section 2.5 and 2.9.

Marks ungrounded claims so the frontend can render them with
different provenance indicators (empty dot instead of filled dot).
"""

import re
import json
import logging

logger = logging.getLogger(__name__)


def verify_grounding(llm_text, computed_data):
    """Check every number in LLM response against computed data. <10ms.

    Args:
        llm_text: The LLM-generated prose string
        computed_data: List of computed block dicts from DataAssemblyEngine

    Returns:
        Tuple of (modified_text, grounding_report)
    """
    if not llm_text or not computed_data:
        return llm_text or "", {"total_numbers": 0, "grounded": 0, "ungrounded": 0, "ungrounded_details": []}

    # Extract all numbers from computed data
    computed_numbers = set()
    data_str = json.dumps(computed_data) if not isinstance(computed_data, str) else computed_data
    for match in re.finditer(r'[\d]+\.?\d*', data_str):
        computed_numbers.add(match.group())

    # Extract numbers from LLM text with surrounding context
    ungrounded = []
    number_pattern = re.compile(r'(\d+\.?\d*)\s*(%|papers?|nodes?|edges?|years?|rank|score|citations?)')
    for match in number_pattern.finditer(llm_text):
        number = match.group(1)
        if number not in computed_numbers:
            ungrounded.append({
                "number": number,
                "context": llm_text[max(0, match.start() - 20):match.end() + 20],
                "position": match.start()
            })

    # Mark ungrounded claims with [ungrounded] tag for frontend
    modified = llm_text
    for item in reversed(ungrounded):
        pos = item["position"]
        modified = modified[:pos] + "[ungrounded]" + modified[pos:]

    total_numbers = len(number_pattern.findall(llm_text))
    report = {
        "total_numbers": total_numbers,
        "grounded": total_numbers - len(ungrounded),
        "ungrounded": len(ungrounded),
        "ungrounded_details": ungrounded
    }

    return modified, report
