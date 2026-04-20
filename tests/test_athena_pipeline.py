"""
tests/test_athena_pipeline.py -- Phase A pipeline tests

Tests orchestrator routing, context stack assembly, token budget.
Per ATHENA_PHASE_A.md Section 2.1.23: created after Feature #044.
"""
import json
import pytest


class TestContextStack:
    """Context stack assembly tests."""

    def test_assemble_without_graph(self):
        """Context stack without graph omits Layers 1-3."""
        from backend.athena_context import assemble_context_stack
        stack = assemble_context_stack(
            session_id="test",
            graph_data=None,
            user_message="Hello",
            memory=[],
            mode="default"
        )
        # Should have: system prompt (with no-graph addendum) + user message
        assert len(stack) >= 2
        assert stack[0]["role"] == "system"
        assert "No research graph" in stack[0]["content"]
        assert stack[-1]["role"] == "user"
        assert stack[-1]["content"] == "Hello"

    def test_assemble_with_graph(self):
        """Context stack with graph includes Layers 1+."""
        from backend.athena_context import assemble_context_stack
        graph_data = {
            "nodes": [
                {"paper_id": "abc", "title": "Test Paper", "year": 2020,
                 "citation_count": 100, "authors": ["Author A"]},
            ],
            "edges": [],
            "metadata": {"seed_paper_title": "Test Paper"},
        }
        stack = assemble_context_stack(
            session_id="test",
            graph_data=graph_data,
            user_message="Tell me about this",
            memory=[],
            mode="default"
        )
        # Should have: system prompt + graph data + user message (at minimum)
        assert len(stack) >= 3
        assert "No research graph" not in stack[0]["content"]
        # Graph data layer should mention the paper
        graph_layer = [m for m in stack if "GRAPH DATA" in m.get("content", "")]
        assert len(graph_layer) == 1
        assert "Test Paper" in graph_layer[0]["content"]

    def test_assemble_with_memory(self):
        """Context stack includes conversation memory."""
        from backend.athena_context import assemble_context_stack
        memory = [
            {"role": "user", "content": "Previous question"},
            {"role": "assistant", "content": "Previous answer"},
        ]
        stack = assemble_context_stack(
            session_id="test",
            graph_data=None,
            user_message="Follow up",
            memory=memory,
            mode="default"
        )
        contents = [m["content"] for m in stack]
        assert "Previous question" in contents
        assert "Previous answer" in contents
        assert "Follow up" in contents


class TestTokenBudget:
    """Token counting and budget enforcement tests."""

    def test_estimate_tokens(self):
        """Token estimation: ~1 token per 4 chars."""
        from backend.athena_context import estimate_tokens
        assert estimate_tokens("") == 0
        assert estimate_tokens("1234") == 1
        assert estimate_tokens("12345678") == 2
        assert estimate_tokens("a" * 100) == 25

    def test_enforce_budget_no_overflow(self):
        """Under-budget stack is not modified."""
        from backend.athena_context import enforce_budget
        stack = [
            {"role": "system", "content": "System prompt"},
            {"role": "user", "content": "Short question"},
        ]
        result = enforce_budget(stack, max_input_tokens=1000)
        assert len(result) == 2

    def test_enforce_budget_removes_pairs(self):
        """Over-budget stack removes oldest user+assistant pairs."""
        from backend.athena_context import enforce_budget
        original_stack = [
            {"role": "system", "content": "S" * 100},
            {"role": "user", "content": "Q1" * 500},
            {"role": "assistant", "content": "A1" * 500},
            {"role": "user", "content": "Q2" * 500},
            {"role": "assistant", "content": "A2" * 500},
            {"role": "user", "content": "Current question here"},
        ]
        original_len = len(original_stack)
        result = enforce_budget(original_stack, max_input_tokens=500)
        # Should have removed at least one pair (Q1+A1 or Q2+A2)
        assert len(result) < original_len
        # System message always preserved
        assert result[0]["role"] == "system"
        # Current user message always preserved
        assert result[-1]["role"] == "user"
        assert "Current" in result[-1]["content"]


class TestGrounding:
    """Grounding verification tests."""

    def test_verify_grounding_all_grounded(self):
        """Numbers matching computed data are grounded."""
        from backend.athena_grounding import verify_grounding
        text = "There are 601 papers in this lineage"
        data = [{"type": "stat_grid", "data": {"stats": [{"value": "601"}]}}]
        modified, report = verify_grounding(text, data)
        assert report["ungrounded"] == 0

    def test_verify_grounding_ungrounded(self):
        """Numbers NOT in computed data are flagged."""
        from backend.athena_grounding import verify_grounding
        text = "There are 999 papers in this lineage"
        data = [{"type": "stat_grid", "data": {"stats": [{"value": "601"}]}}]
        modified, report = verify_grounding(text, data)
        assert report["ungrounded"] >= 1
        assert "[ungrounded]" in modified

    def test_verify_grounding_empty(self):
        """Empty text returns empty report."""
        from backend.athena_grounding import verify_grounding
        text, report = verify_grounding("", [])
        assert report["total_numbers"] == 0
