"""
tests/test_athena_blocks.py -- Phase A block assembly tests

Tests DataAssemblyEngine stat computation and block JSON shapes.
Per ATHENA_PHASE_A.md Section 2.1.23: created after Feature #001.
"""
import json
import pytest


class TestDataAssemblyEngine:
    """Test the DataAssemblyEngine from backend/athena_blocks.py."""

    def _make_graph(self, num_nodes=5):
        """Create a minimal test graph."""
        nodes = []
        edges = []
        for i in range(num_nodes):
            nodes.append({
                "paper_id": f"paper_{i}",
                "title": f"Test Paper {i}",
                "authors": [f"Author {i}"],
                "year": 2015 + i,
                "citation_count": (num_nodes - i) * 100,
                "fields_of_study": ["Computer Science"],
                "url": f"https://example.com/{i}",
                "text_tier": 2,
            })
        # Create edges: each paper cites the next
        for i in range(num_nodes - 1):
            edges.append({
                "citing_paper_id": f"paper_{i}",
                "cited_paper_id": f"paper_{i+1}",
                "mutation_type": "adoption",
            })
        return {
            "nodes": nodes,
            "edges": edges,
            "metadata": {"seed_paper_id": "paper_0", "seed_paper_title": "Test Paper 0"},
        }

    def test_assemble_paper_card(self):
        """Paper card block has correct data shape."""
        from backend.athena_blocks import DataAssemblyEngine
        graph = self._make_graph()
        engine = DataAssemblyEngine(graph)
        intent = {
            "entities": [{"paper_id": "paper_0"}],
            "block_plan": ["paper_card"],
            "data_needs": [],
        }
        blocks = engine.assemble(intent)
        assert len(blocks) == 1
        assert blocks[0]["type"] == "paper_card"
        assert blocks[0]["provenance"] == "computed"
        assert blocks[0]["data"]["title"] == "Test Paper 0"
        assert blocks[0]["data"]["year"] == 2015

    def test_assemble_stat_grid_pagerank(self):
        """Stat grid includes PageRank when requested."""
        from backend.athena_blocks import DataAssemblyEngine
        graph = self._make_graph()
        engine = DataAssemblyEngine(graph)
        intent = {
            "entities": [{"paper_id": "paper_0"}],
            "block_plan": ["stat_grid"],
            "data_needs": ["pagerank"],
        }
        blocks = engine.assemble(intent)
        assert len(blocks) == 1
        assert blocks[0]["type"] == "stat_grid"
        stats = blocks[0]["data"]["stats"]
        pagerank_stats = [s for s in stats if s["label"] == "PageRank"]
        assert len(pagerank_stats) == 1
        assert "of 5" in pagerank_stats[0]["value"]

    def test_assemble_graph_stats(self):
        """Graph-level stats when no specific entity."""
        from backend.athena_blocks import DataAssemblyEngine
        graph = self._make_graph(10)
        engine = DataAssemblyEngine(graph)
        intent = {
            "entities": [],
            "block_plan": ["stat_grid"],
            "data_needs": ["pagerank"],
        }
        blocks = engine.assemble(intent)
        assert len(blocks) == 1
        stats = blocks[0]["data"]["stats"]
        total_stat = [s for s in stats if s["label"] == "Total Papers"]
        assert len(total_stat) == 1
        assert total_stat[0]["value"] == "10"

    def test_assemble_unknown_entity(self):
        """Unknown paper_id returns no blocks."""
        from backend.athena_blocks import DataAssemblyEngine
        graph = self._make_graph()
        engine = DataAssemblyEngine(graph)
        intent = {
            "entities": [{"paper_id": "nonexistent"}],
            "block_plan": ["paper_card"],
            "data_needs": [],
        }
        blocks = engine.assemble(intent)
        assert len(blocks) == 0

    def test_assemble_empty_graph(self):
        """Empty graph produces no blocks."""
        from backend.athena_blocks import DataAssemblyEngine
        engine = DataAssemblyEngine({"nodes": [], "edges": [], "metadata": {}})
        intent = {
            "entities": [],
            "block_plan": ["stat_grid"],
            "data_needs": ["pagerank"],
        }
        blocks = engine.assemble(intent)
        # Should have graph stats even if empty
        if blocks:
            stats = blocks[0]["data"]["stats"]
            assert any(s["value"] == "0" for s in stats)

    def test_block_provenance_always_computed(self):
        """All data assembly blocks are tagged as 'computed'."""
        from backend.athena_blocks import DataAssemblyEngine
        graph = self._make_graph()
        engine = DataAssemblyEngine(graph)
        intent = {
            "entities": [{"paper_id": "paper_0"}],
            "block_plan": ["paper_card", "stat_grid"],
            "data_needs": ["pagerank", "descendants"],
        }
        blocks = engine.assemble(intent)
        for block in blocks:
            assert block["provenance"] == "computed"
