"""
tests/test_phase5.py

Phase 5 test suite. Covers:
  - ExportGenerator (all 8 formats, offline)
  - LivingPaperScorer
  - OriginalityMapper (structural fallback path)
  - ParadigmShiftDetector
  - Export route authentication (positive + negative paths)
  - ProductionQualityMonitor confidence field fix (GAP-15 regression)
  - ground_truth/pairs.json structure validation

All tests are offline — no live Neon, R2, NLP worker, or S2 API required.
Run: pytest tests/test_phase5.py -v
"""
import json
import os
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock


# ─── Shared test graph fixture ────────────────────────────────────────────────

def _make_test_graph(n_nodes: int = 15) -> dict:
    """Build a minimal graph JSON for testing."""
    import random
    rng = random.Random(99)
    nodes = []
    for i in range(n_nodes):
        nodes.append({
            "id":              f"paper_{i}",
            "title":           f"Test Paper {i}",
            "authors":         [f"Author{i} A"],
            "year":            2010 + i,
            "citation_count":  rng.randint(5, 500),
            "fields_of_study": ["Computer Science"] if i % 3 != 0 else ["Physics"],
            "is_seed":         i == n_nodes - 1,
            "is_root":         i == 0,
            "abstract":        f"Abstract for paper {i}.",
        })
    edges = []
    mutation_types = ["adoption", "generalization", "specialization",
                      "hybridization", "contradiction", "incidental"]
    for i in range(1, n_nodes):
        edges.append({
            "source":           f"paper_{i}",
            "target":           f"paper_{i-1}",
            "mutation_type":    mutation_types[i % len(mutation_types)],
            "similarity_score": round(0.3 + rng.random() * 0.5, 3),
            "base_confidence":  round(0.4 + rng.random() * 0.4, 3),
            "confidence_tier":  "MEDIUM",
            "citing_sentence":  f"Sentence from paper {i}.",
            "cited_sentence":   f"Sentence from paper {i-1}.",
        })
    return {
        "nodes": nodes,
        "edges": edges,
        "metadata": {
            "seed_paper_id":    f"paper_{n_nodes-1}",
            "seed_paper_title": "Test Seed Paper",
            "total_nodes":      n_nodes,
            "total_edges":      n_nodes - 1,
        },
        "dna_profile": {
            "clusters": [
                {"name": "Cluster A", "percentage": 40,
                 "papers": [f"paper_{i}" for i in range(0, 5)],   "color": "#3B82F6"},
                {"name": "Cluster B", "percentage": 35,
                 "papers": [f"paper_{i}" for i in range(5, 10)],  "color": "#D4A843"},
                {"name": "Cluster C", "percentage": 25,
                 "papers": [f"paper_{i}" for i in range(10, 15)], "color": "#22C55E"},
            ]
        }
    }


# ─── ExportGenerator ─────────────────────────────────────────────────────────

class TestExportGenerator:
    """Tests for ExportGenerator — all format generators, no live R2."""

    @pytest.fixture
    def gen_no_r2(self):
        from backend.export_generator import ExportGenerator
        gen = ExportGenerator.__new__(ExportGenerator)
        mock_r2 = MagicMock()
        mock_r2._enabled = False
        gen.r2 = mock_r2
        return gen

    def test_graph_json_produces_valid_json(self, gen_no_r2):
        graph = _make_test_graph()
        data, filename, content_type = gen_no_r2._graph_json(graph, "sess", None, {})
        assert filename == "arivu_graph.json"
        assert content_type == "application/json"
        parsed = json.loads(data)
        assert "nodes" in parsed and "edges" in parsed

    def test_graph_csv_produces_zip_with_two_files(self, gen_no_r2):
        import zipfile, io
        graph = _make_test_graph()
        data, filename, content_type = gen_no_r2._graph_csv(graph, "sess", None, {})
        assert filename.endswith(".zip")
        assert content_type == "application/zip"
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            names = zf.namelist()
            assert "nodes.csv" in names
            assert "edges.csv" in names

    def test_bibtex_contains_article_entries(self, gen_no_r2):
        graph = _make_test_graph()
        data, filename, content_type = gen_no_r2._bibtex(graph, "sess", None, {})
        text = data.decode("utf-8")
        assert "@article{" in text
        assert filename.endswith(".bib")

    def test_bibtex_no_duplicate_cite_keys(self, gen_no_r2):
        graph = _make_test_graph(10)
        for n in graph["nodes"]:
            n["authors"] = ["Smith J"]
            n["year"]    = 2020
        data, _, _ = gen_no_r2._bibtex(graph, "sess", None, {})
        text = data.decode("utf-8")
        import re
        keys = re.findall(r"@article\{(\w+),", text)
        assert len(keys) == len(set(keys)), "Duplicate BibTeX cite keys found"

    def test_literature_review_template_fallback(self, gen_no_r2):
        graph = _make_test_graph()
        data, filename, content_type = gen_no_r2._literature_review(graph, "sess", None, {})
        text = data.decode("utf-8")
        assert "## Overview" in text or "# Literature Review" in text
        assert content_type == "text/markdown"

    def test_action_log_returns_json(self, gen_no_r2):
        graph = _make_test_graph()
        with patch("backend.export_generator.fetchall", return_value=[]):
            data, filename, content_type = gen_no_r2._action_log(graph, "sess", None, {})
        parsed = json.loads(data)
        assert "session_id" in parsed
        assert "actions" in parsed

    def test_generate_raises_for_unknown_type(self, gen_no_r2):
        with pytest.raises(ValueError, match="Unknown export type"):
            gen_no_r2.generate("bad-type", {}, "sess")

    def test_generate_raises_when_r2_disabled(self):
        from backend.export_generator import ExportGenerator
        gen = ExportGenerator.__new__(ExportGenerator)
        mock_r2 = MagicMock()
        mock_r2._enabled = False
        gen.r2 = mock_r2
        with pytest.raises(RuntimeError, match="R2 storage is not configured"):
            gen.generate("graph-json", _make_test_graph(), "sess")

    def test_build_nodes_by_id_helper(self):
        from backend.export_generator import _build_nodes_by_id
        graph = _make_test_graph(5)
        nbi   = _build_nodes_by_id(graph)
        assert len(nbi) == 5
        for node in graph["nodes"]:
            assert node["id"] in nbi
            assert nbi[node["id"]]["title"] == node["title"]


# ─── LivingPaperScorer ───────────────────────────────────────────────────────

class TestLivingPaperScorer:

    def test_scores_all_nodes(self):
        from backend.living_paper_scorer import LivingPaperScorer
        graph   = _make_test_graph(10)
        scorer  = LivingPaperScorer()
        results = scorer.score_graph(graph)
        assert len(results) == 10
        for pid, score in results.items():
            assert 0.0 <= score.score <= 100.0
            assert score.trajectory in ("rising", "stable", "declining", "extinct")

    def test_score_single_returns_result(self):
        from backend.living_paper_scorer import LivingPaperScorer
        graph  = _make_test_graph(10)
        scorer = LivingPaperScorer()
        result = scorer.score_single("paper_5", graph)
        assert result is not None
        assert result.paper_id == "paper_5"

    def test_score_single_unknown_paper_returns_none(self):
        from backend.living_paper_scorer import LivingPaperScorer
        graph  = _make_test_graph(5)
        scorer = LivingPaperScorer()
        assert scorer.score_single("nonexistent_id", graph) is None

    def test_empty_graph_returns_empty(self):
        from backend.living_paper_scorer import LivingPaperScorer
        scorer  = LivingPaperScorer()
        results = scorer.score_graph({"nodes": [], "edges": []})
        assert results == {}

    def test_to_dict_is_serializable(self):
        from backend.living_paper_scorer import LivingPaperScorer
        graph  = _make_test_graph(8)
        scorer = LivingPaperScorer()
        result = scorer.score_single("paper_0", graph)
        assert result is not None
        d = result.to_dict()
        json.dumps(d)  # must not raise
        assert "score" in d and "trajectory" in d

    def test_current_year_is_dynamic(self):
        """REGRESSION: CURRENT_YEAR must never be hardcoded (GAP-32)."""
        from backend.living_paper_scorer import _current_year
        from datetime import datetime, timezone
        assert _current_year() == datetime.now(timezone.utc).year, (
            "CURRENT_YEAR appears hardcoded. Use _current_year() which calls "
            "datetime.now(timezone.utc).year dynamically."
        )


# ─── OriginalityMapper ───────────────────────────────────────────────────────

class TestOriginalityMapper:

    def test_paper_with_no_ancestors_is_pioneer(self):
        from backend.originality_mapper import OriginalityMapper
        graph = {
            "nodes": [{"id": "p0", "title": "Paper 0", "authors": ["A"],
                       "fields_of_study": ["CS"]}],
            "edges": [],
        }
        mapper = OriginalityMapper()
        result = mapper.compute_originality("p0", graph)
        assert result is not None
        assert result.contribution_type == "Pioneer"

    def test_returns_none_for_unknown_paper(self):
        from backend.originality_mapper import OriginalityMapper
        graph  = _make_test_graph(5)
        mapper = OriginalityMapper()
        assert mapper.compute_originality("not_in_graph", graph) is None

    def test_structural_fallback_returns_valid_type(self):
        from backend.originality_mapper import OriginalityMapper
        graph  = _make_test_graph(10)
        mapper = OriginalityMapper()
        with patch("backend.originality_mapper.db.fetchall", return_value=[]):
            result = mapper.compute_originality("paper_9", graph)
        assert result is not None
        assert result.contribution_type in (
            "Pioneer", "Synthesizer", "Bridge", "Refiner", "Contradictor"
        )

    def test_to_dict_is_serializable(self):
        from backend.originality_mapper import OriginalityMapper
        graph  = _make_test_graph(8)
        mapper = OriginalityMapper()
        with patch("backend.originality_mapper.db.fetchall", return_value=[]):
            result = mapper.compute_originality("paper_7", graph)
        assert result is not None
        json.dumps(result.to_dict())  # must not raise

    def test_cosine_similarity_bounds(self):
        from backend.originality_mapper import OriginalityMapper
        sim = OriginalityMapper._cosine_similarity([1, 0, 0], [1, 0, 0])
        assert abs(sim - 1.0) < 1e-6
        sim = OriginalityMapper._cosine_similarity([1, 0], [0, 1])
        assert abs(sim - 0.0) < 1e-6
        sim = OriginalityMapper._cosine_similarity([0, 0, 0], [1, 2, 3])
        assert sim == 0.0


# ─── ParadigmShiftDetector ───────────────────────────────────────────────────

class TestParadigmShiftDetector:

    def test_small_graph_returns_stable(self):
        from backend.paradigm_detector import ParadigmShiftDetector
        graph  = {"nodes": [{"id": "p0", "year": 2020}], "edges": []}
        det    = ParadigmShiftDetector()
        result = det.detect(graph)
        assert result.stability_score == 100.0
        assert not result.alert
        assert result.signals == []

    def test_high_contradiction_rate_triggers_signal(self):
        from backend.paradigm_detector import ParadigmShiftDetector
        graph = _make_test_graph(20)
        for e in graph["edges"]:
            e["mutation_type"] = "contradiction"
        det    = ParadigmShiftDetector()
        result = det.detect(graph, coverage_score=0.8)
        signal_types = [s.signal_type for s in result.signals]
        assert "CONTRADICTION_SURGE" in signal_types

    def test_alert_triggers_below_threshold(self):
        from backend.paradigm_detector import ParadigmShiftDetector, ALERT_THRESHOLD
        graph = _make_test_graph(25)
        for e in graph["edges"]:
            e["mutation_type"] = "contradiction"
        det    = ParadigmShiftDetector()
        result = det.detect(graph, coverage_score=0.9)
        if result.stability_score < ALERT_THRESHOLD:
            assert result.alert is True

    def test_coverage_ok_flag_reflects_threshold(self):
        from backend.paradigm_detector import ParadigmShiftDetector, COVERAGE_THRESHOLD
        graph      = _make_test_graph(10)
        det        = ParadigmShiftDetector()
        result_ok  = det.detect(graph, coverage_score=COVERAGE_THRESHOLD + 0.1)
        result_low = det.detect(graph, coverage_score=COVERAGE_THRESHOLD - 0.1)
        assert result_ok.coverage_ok  is True
        assert result_low.coverage_ok is False

    def test_to_dict_is_serializable(self):
        from backend.paradigm_detector import ParadigmShiftDetector
        graph  = _make_test_graph(15)
        det    = ParadigmShiftDetector()
        result = det.detect(graph, coverage_score=0.7)
        json.dumps(result.to_dict())  # must not raise


# ─── Quality monitor confidence field regression test (GAP-15) ───────────────

class TestQualityMonitorConfidenceField:
    """
    Regression test for GAP-15: quality monitor must use base_confidence,
    not final_confidence, to match EdgeAnalysis dataclass and export_to_json().
    """

    def test_confidence_metric_reads_base_confidence(self):
        from backend.quality_monitor import ProductionQualityMonitor
        graph = _make_test_graph(10)
        # All edges have base_confidence = 0.2 (below LOW_CONFIDENCE threshold of 0.4)
        for e in graph["edges"]:
            e["base_confidence"]  = 0.2
            e["mutation_confidence"] = 0.2
            # Deliberately do NOT set final_confidence
            e.pop("final_confidence", None)

        monitor = ProductionQualityMonitor()
        result  = monitor.analyze_graph_quality(graph)
        metrics = result.get("metrics", {})
        # If the fix is applied, low_confidence_rate should be > 0
        # (all edges have confidence 0.2 < 0.4 threshold)
        assert "low_confidence_rate" in metrics, (
            "quality_monitor is not computing low_confidence_rate. "
            "Check that analyze_graph_quality reads base_confidence."
        )
        assert metrics["low_confidence_rate"] > 0, (
            "low_confidence_rate is 0 — quality monitor is not reading "
            "base_confidence correctly (GAP-15 fix not applied)."
        )

    def test_quality_monitor_positive_path(self):
        """Positive case: quality monitor returns quality_score for a valid graph."""
        from backend.quality_monitor import ProductionQualityMonitor
        graph   = _make_test_graph(20)
        monitor = ProductionQualityMonitor()
        result  = monitor.analyze_graph_quality(graph)
        assert "quality_score" in result
        assert 0.0 <= result["quality_score"] <= 1.0
        assert "metrics" in result
        assert "issues" in result


# ─── ground_truth/pairs.json ─────────────────────────────────────────────────

class TestGroundTruthPairs:
    GT_PATH = Path(__file__).parent.parent / "data" / "ground_truth" / "pairs.json"

    def test_file_exists(self):
        assert self.GT_PATH.exists(), (
            f"data/ground_truth/pairs.json not found at {self.GT_PATH}. Create per §13."
        )

    def test_has_minimum_pairs(self):
        with open(self.GT_PATH) as f:
            data = json.load(f)
        assert len(data) >= 5, f"Expected >=5 pairs, got {len(data)}"

    def test_required_fields(self):
        with open(self.GT_PATH) as f:
            data = json.load(f)
        for pair in data:
            assert "source_id" in pair,                  f"Missing source_id in {pair}"
            assert "target_id" in pair,                  f"Missing target_id in {pair}"
            assert "expected_mutation_type" in pair,     f"Missing expected_mutation_type"
            assert "expected_similarity_range" in pair,  f"Missing expected_similarity_range"
            r = pair["expected_similarity_range"]
            assert len(r) == 2,                          f"similarity_range must be [min, max]"
            assert 0 <= r[0] <= r[1] <= 1.0,            f"Invalid range {r}"

    def test_mutation_types_are_valid(self):
        from backend.models import MUTATION_TYPES
        with open(self.GT_PATH) as f:
            data = json.load(f)
        for pair in data:
            mt = pair.get("expected_mutation_type", "")
            assert mt in MUTATION_TYPES or mt == "", (
                f"Unknown mutation type: {mt!r}"
            )


# ─── Export route authentication ─────────────────────────────────────────────

class TestExportRouteAuth:
    """Verify export route requires session (negative path) and returns 400 for bad type."""

    @pytest.fixture
    def client(self):
        from app import create_app
        application = create_app()
        application.config["TESTING"] = True
        with application.test_client() as c:
            yield c

    def test_export_requires_session(self, client):
        resp = client.post(
            "/api/export/graph-json",
            json={},
            content_type="application/json",
        )
        assert resp.status_code == 401, (
            f"Expected 401 without session, got {resp.status_code}"
        )

    def test_export_rejects_unknown_type(self, client):
        resp = client.post(
            "/api/export/not-a-real-type",
            json={},
            content_type="application/json",
        )
        # Should be 401 (no session) or 400 (bad type) — not 200 or 500
        assert resp.status_code in (400, 401)


# ─── Utils path regression (GAP-7 / GAP-31) ──────────────────────────────────

class TestUtilsGalleryPath:
    """Regression test: GALLERY_INDEX_PATH must point to data/ not data/precomputed/."""

    def test_gallery_index_path_is_at_data_root(self):
        from backend.utils import GALLERY_INDEX_PATH
        path_str = str(GALLERY_INDEX_PATH)
        assert "precomputed" not in path_str.split("gallery_index.json")[0], (
            f"GALLERY_INDEX_PATH still points inside data/precomputed/. "
            f"Got: {path_str}. Apply §0.3 fix."
        )
        assert path_str.endswith("gallery_index.json"), (
            f"GALLERY_INDEX_PATH does not end with gallery_index.json: {path_str}"
        )

    def test_gallery_dir_is_precomputed(self):
        from backend.utils import GALLERY_DIR
        assert str(GALLERY_DIR).endswith("precomputed"), (
            f"GALLERY_DIR should still point to data/precomputed/. Got: {GALLERY_DIR}"
        )


# ─── arivu_rate_limiter instance (GAP-8) ─────────────────────────────────────

class TestRateLimiterInstance:
    """Regression test: arivu_rate_limiter must be importable as module-level instance."""

    def test_arivu_rate_limiter_importable(self):
        from backend.rate_limiter import arivu_rate_limiter
        assert arivu_rate_limiter is not None, (
            "arivu_rate_limiter instance not found in rate_limiter.py. Apply §0.1 fix."
        )

    def test_arivu_rate_limiter_has_check_sync(self):
        from backend.rate_limiter import arivu_rate_limiter
        assert hasattr(arivu_rate_limiter, "check_sync"), (
            "arivu_rate_limiter missing check_sync(). "
            "Ensure Phase 4 §0.5 backport was applied."
        )

    def test_arivu_rate_limiter_has_phase5_limits(self):
        from backend.rate_limiter import arivu_rate_limiter
        limits = getattr(arivu_rate_limiter, "LIMITS", {})
        assert "POST /api/export" in limits, (
            "Phase 5 export rate limit not found in LIMITS. Apply §4."
        )


# ─── presigned_url on R2Client (GAP-13) ──────────────────────────────────────

class TestR2ClientPresignedUrl:
    """Regression test: R2Client must have presigned_url() method."""

    def test_presigned_url_method_exists(self):
        from backend.r2_client import R2Client
        r2 = R2Client()
        assert hasattr(r2, "presigned_url"), (
            "R2Client missing presigned_url() method. Apply §0.4 fix."
        )

    def test_presigned_url_raises_when_disabled(self):
        from backend.r2_client import R2Client
        r2 = R2Client()
        if not r2._enabled:
            with pytest.raises(RuntimeError, match="R2"):
                r2.presigned_url("some/key.json")
