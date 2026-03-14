"""
tests/test_phase4.py

Phase 4 deployment validation tests. All tests are offline — no live
Neon, R2, or NLP worker required.

Run: pytest tests/test_phase4.py -v
"""
import json
import os
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock


# ─── ProductionQualityMonitor ─────────────────────────────────────────────────

class TestProductionQualityMonitor:

    def _make_graph(self, n_edges=20, similarity_std=0.15,
                    incidental_rate=0.2, with_abstracts=0.9) -> dict:
        import math, random
        rng = random.Random(42)
        nodes = [{"id": f"p{i}", "title": f"Paper {i}",
                  "citation_count": rng.randint(10, 1000),
                  "abstract": "Test abstract" if rng.random() < with_abstracts else None,
                  "year": 2010 + i}
                 for i in range(max(n_edges // 2, 5))]
        mutation_types = ["adoption", "generalization", "specialization",
                          "hybridization", "contradiction", "incidental"]
        edges = []
        for i in range(n_edges):
            mtype = "incidental" if rng.random() < incidental_rate else rng.choice(mutation_types[:5])
            sim   = min(1.0, max(0.0, 0.5 + rng.gauss(0, similarity_std)))
            edges.append({"source": f"p{i % max(len(nodes), 1)}",
                          "target": f"p{(i+1) % max(len(nodes), 1)}",
                          "similarity_score": round(sim, 3),
                          "mutation_type": mtype,
                          "final_confidence": round(rng.uniform(0.3, 1.0), 3)})
        return {"nodes": nodes, "edges": edges}

    def test_healthy_graph_high_score(self):
        from backend.quality_monitor import ProductionQualityMonitor
        monitor = ProductionQualityMonitor()
        result  = monitor.analyze_graph_quality(
            self._make_graph(n_edges=30, similarity_std=0.2, incidental_rate=0.1))
        assert 0.0 <= result["quality_score"] <= 1.0
        assert isinstance(result["metrics"], dict)
        assert isinstance(result["issues"], list)
        assert "timestamp" in result

    def test_empty_graph_zero_score(self):
        from backend.quality_monitor import ProductionQualityMonitor
        monitor = ProductionQualityMonitor()
        result  = monitor.analyze_graph_quality({"nodes": [], "edges": []})
        assert result["quality_score"] == 0.0
        assert len(result["issues"]) >= 1

    def test_low_variance_similarity_flagged(self):
        from backend.quality_monitor import ProductionQualityMonitor
        monitor = ProductionQualityMonitor()
        graph = {"nodes": [{"id": f"p{i}", "abstract": "x"} for i in range(10)],
                 "edges": [{"source": "p0", "target": f"p{i}",
                            "similarity_score": 0.5,
                            "mutation_type": "adoption",
                            "final_confidence": 0.8} for i in range(1, 20)]}
        result = monitor.analyze_graph_quality(graph)
        assert any("VARIANCE" in i for i in result["issues"])

    def test_high_incidental_rate_flagged(self):
        from backend.quality_monitor import ProductionQualityMonitor
        monitor = ProductionQualityMonitor()
        result  = monitor.analyze_graph_quality(self._make_graph(n_edges=20, incidental_rate=0.95))
        assert any("INCIDENTAL" in i for i in result["issues"])

    def test_check_thresholds_returns_list(self):
        from backend.quality_monitor import ProductionQualityMonitor
        monitor = ProductionQualityMonitor()
        result  = {"quality_score": 0.2,
                   "metrics": {"abstract_coverage": 0.3, "low_confidence_rate": 0.8}}
        alerts  = monitor.check_thresholds(result)
        assert isinstance(alerts, list)
        assert len(alerts) >= 2

    def test_check_thresholds_healthy_returns_empty(self):
        from backend.quality_monitor import ProductionQualityMonitor
        monitor = ProductionQualityMonitor()
        result  = {"quality_score": 0.9,
                   "metrics": {"abstract_coverage": 0.9, "low_confidence_rate": 0.1}}
        assert monitor.check_thresholds(result) == []

    def test_is_bimodal_with_clear_bimodal(self):
        from backend.quality_monitor import ProductionQualityMonitor
        values = [0.05, 0.1, 0.08, 0.12, 0.06, 0.85, 0.9, 0.88, 0.92, 0.87, 0.91]
        assert ProductionQualityMonitor()._is_bimodal(values) is True

    def test_is_bimodal_uniform_not_bimodal(self):
        from backend.quality_monitor import ProductionQualityMonitor
        # Values concentrated in the mid-range — not bimodal
        values = [0.35, 0.40, 0.42, 0.45, 0.48, 0.50, 0.52, 0.55, 0.58, 0.60]
        assert ProductionQualityMonitor()._is_bimodal(values) is False


# ─── Config ───────────────────────────────────────────────────────────────────

class TestConfig:

    def test_validate_raises_without_database_url(self):
        import backend.config as cfg_mod
        original = cfg_mod.Config.DATABASE_URL
        cfg_mod.Config.DATABASE_URL = ""
        try:
            with pytest.raises(RuntimeError, match="DATABASE_URL"):
                cfg_mod.Config.validate()
        finally:
            cfg_mod.Config.DATABASE_URL = original

    def test_validate_passes_with_database_url(self):
        import backend.config as cfg_mod
        original = cfg_mod.Config.DATABASE_URL
        cfg_mod.Config.DATABASE_URL = "postgresql://localhost/test"
        try:
            cfg_mod.Config.validate()  # must not raise
        finally:
            cfg_mod.Config.DATABASE_URL = original

    def test_config_has_required_attributes(self):
        from backend.config import Config
        required = [
            "SECRET_KEY", "DEBUG", "DATABASE_URL",
            "S2_API_KEY", "GROQ_API_KEY", "CORE_API_KEY",
            "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
            "R2_BUCKET_NAME", "R2_ENDPOINT_URL",
            "NLP_WORKER_URL", "WORKER_SECRET",
            "SENTRY_DSN", "KOYEB_PUBLIC_DOMAIN",
            "DB_POOL_MAX", "DB_POOL_MIN",
        ]
        for attr in required:
            assert hasattr(Config, attr), f"Config missing: {attr}"

    def test_backward_compat_alias(self):
        """config = Config alias must work for Phase 1/2/3 imports."""
        from backend.config import config, Config
        assert config is Config


# ─── gallery_index.json ───────────────────────────────────────────────────────

class TestGalleryIndex:
    GALLERY_PATH = Path(__file__).parent.parent / "data" / "gallery_index.json"

    def test_file_exists(self):
        assert self.GALLERY_PATH.exists(), (
            f"data/gallery_index.json not found at {self.GALLERY_PATH}. Create it per §9.")

    def test_has_seven_entries(self):
        with open(self.GALLERY_PATH) as f:
            data = json.load(f)
        assert len(data) == 7, f"Expected 7 entries, got {len(data)}"

    def test_required_fields_present(self):
        with open(self.GALLERY_PATH) as f:
            data = json.load(f)
        required = ["slug", "title", "authors", "year", "field", "paper_id", "hook", "stats"]
        for entry in data:
            for field in required:
                assert field in entry, f"Entry '{entry.get('slug')}' missing: {field}"

    def test_slugs_match_expected(self):
        with open(self.GALLERY_PATH) as f:
            data = json.load(f)
        expected = {"attention", "alexnet", "bert", "gans", "word2vec", "resnet", "gpt2"}
        actual   = {e["slug"] for e in data}
        assert actual == expected, f"Missing: {expected-actual}. Extra: {actual-expected}"

    def test_paper_ids_are_nonempty_hex_strings(self):
        with open(self.GALLERY_PATH) as f:
            data = json.load(f)
        for entry in data:
            pid = entry["paper_id"]
            assert isinstance(pid, str) and len(pid) > 10, (
                f"Entry '{entry['slug']}' has invalid paper_id: {pid!r}")

    def test_stats_shape(self):
        with open(self.GALLERY_PATH) as f:
            data = json.load(f)
        for entry in data:
            stats = entry.get("stats", {})
            assert "papers" in stats and "edges" in stats, (
                f"Entry '{entry['slug']}' stats missing 'papers' or 'edges'")


# ─── semantic-zoom.js ─────────────────────────────────────────────────────────

class TestSemanticZoomJS:
    JS_PATH = Path(__file__).parent.parent / "static" / "js" / "semantic-zoom.js"

    def test_file_exists(self):
        assert self.JS_PATH.exists(), "static/js/semantic-zoom.js not found. Create it per §8."

    def test_contains_class_definition(self):
        assert "class SemanticZoomRenderer" in self.JS_PATH.read_text()

    def test_has_required_methods(self):
        content = self.JS_PATH.read_text()
        for method in ["renderClusters", "removeClusterOverlay", "updateClusterPositions"]:
            assert method in content, f"SemanticZoomRenderer missing method: {method}"


# ─── Sentry init ──────────────────────────────────────────────────────────────

class TestSentryInit:

    def test_sentry_init_no_dsn_does_not_raise(self):
        """_init_sentry must not raise if SENTRY_DSN is not set."""
        import backend.config as cfg_mod
        original = cfg_mod.Config.SENTRY_DSN
        cfg_mod.Config.SENTRY_DSN = ""
        try:
            from flask import Flask
            test_app = Flask(__name__)
            import app as app_mod
            if hasattr(app_mod, "_init_sentry"):
                app_mod._init_sentry(test_app)
        finally:
            cfg_mod.Config.SENTRY_DSN = original

    def test_add_security_headers_present(self):
        """add_security_headers must be a module-level function in app.py."""
        import app as app_mod
        assert hasattr(app_mod, "add_security_headers"), (
            "app.py must define add_security_headers() at module level (not inside create_app)")

    def test_security_headers_contain_csp(self):
        """add_security_headers must attach Content-Security-Policy."""
        import app as app_mod
        from flask import Flask
        test_app = Flask(__name__)
        with test_app.test_request_context("/"):
            from flask import Response
            resp = app_mod.add_security_headers(Response())
            assert "Content-Security-Policy" in resp.headers
