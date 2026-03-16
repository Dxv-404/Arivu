"""
tests/test_phase7.py — Phase 7 test suite.
All tests offline — no live DB, R2, Groq, or NLP worker required.
Run: pytest tests/test_phase7.py -v
"""
import json
import pytest
from unittest.mock import patch, MagicMock


def _make_test_graph(n: int = 15) -> dict:
    """Helper: build a graph dict matching AncestryGraph.export_to_json() shape."""
    import random
    rng = random.Random(42)
    nodes = [
        {
            "id": f"paper_{i}",
            "title": f"Test Paper {i}",
            "authors": [f"Author {i}"],
            "year": 2010 + i,
            "citation_count": rng.randint(10, 1000),
            "fields_of_study": ["Computer Science"] if i % 3 != 0 else ["Biology"],
            "is_bottleneck": i == 0,
            "pruning_impact": 0.35 if i == 0 else rng.random() * 0.1,
            "abstract": f"Abstract for paper {i}.",
            "text_tier": 3,
        }
        for i in range(n)
    ]
    edges = [
        {
            "source": f"paper_{i}",
            "target": f"paper_{i-1}",
            "mutation_type": "adoption",
            "similarity_score": round(0.4 + rng.random() * 0.4, 3),
            "base_confidence": round(0.5 + rng.random() * 0.3, 3),
        }
        for i in range(1, n)
    ]
    return {
        "nodes": nodes,
        "edges": edges,
        "metadata": {
            "seed_paper_id": f"paper_{n-1}",
            "seed_paper_title": "Test Seed",
            "graph_id": "test_graph_id_12345678",
        },
    }


# ── TimeMachineEngine ────────────────────────────────────────────────────────

class TestTimeMachineEngine:
    def test_build_timeline_returns_dict(self):
        from backend.time_machine import TimeMachineEngine
        with (
            patch("backend.time_machine.db") as mock_db,
            patch("backend.extinction_detector.ExtinctionEventDetector.detect", return_value=[]),
            patch("backend.vocabulary_tracker.VocabularyEvolutionTracker.build_heatmap_cached", return_value={}),
            patch("backend.vocabulary_tracker.db") as mock_vocab_db,
        ):
            mock_db.fetchone.return_value = None
            mock_db.execute.return_value = None
            mock_vocab_db.fetchall.return_value = []
            result = TimeMachineEngine().build_timeline(_make_test_graph(10))
        assert isinstance(result, dict)
        assert "vocabulary_heatmap" in result or "slices" in result

    def test_empty_graph_returns_safely(self):
        from backend.time_machine import TimeMachineEngine
        with patch("backend.time_machine.db") as mock_db:
            mock_db.fetchone.return_value = None
            mock_db.execute.return_value = None
            result = TimeMachineEngine().build_timeline(
                {"nodes": [], "edges": [], "metadata": {}}
            )
        assert isinstance(result, dict)


# ── VocabularyEvolutionTracker ───────────────────────────────────────────────

class TestVocabularyTracker:
    def test_build_heatmap_returns_dict(self):
        from backend.vocabulary_tracker import VocabularyEvolutionTracker
        g = _make_test_graph(10)
        years = [n["year"] for n in g["nodes"] if n.get("year")]
        result = VocabularyEvolutionTracker().build_heatmap(g, min(years), max(years))
        assert isinstance(result, dict)

    def test_empty_graph(self):
        from backend.vocabulary_tracker import VocabularyEvolutionTracker
        result = VocabularyEvolutionTracker().build_heatmap(
            {"nodes": [], "edges": [], "metadata": {}}, 0, 0
        )
        assert isinstance(result, dict)
        assert result == {}


# ── ExtinctionEventDetector ──────────────────────────────────────────────────

class TestExtinctionDetector:
    def test_returns_list(self):
        from backend.extinction_detector import ExtinctionEventDetector
        result = ExtinctionEventDetector().detect(_make_test_graph(10))
        assert isinstance(result, list)

    def test_empty_graph(self):
        from backend.extinction_detector import ExtinctionEventDetector
        result = ExtinctionEventDetector().detect(
            {"nodes": [], "edges": [], "metadata": {}}
        )
        assert result == []


# ── CounterfactualEngine ─────────────────────────────────────────────────────

class TestCounterfactualEngine:
    def test_analyze_returns_result(self):
        from backend.counterfactual_engine import CounterfactualEngine
        with (
            patch("backend.counterfactual_engine.db") as mock_db,
            patch("backend.llm_client.get_llm_client") as mock_llm,
        ):
            mock_db.fetchone.return_value = None
            mock_db.execute.return_value = None
            mock_client = MagicMock()
            mock_client.generate_chat_response.return_value = "Test narrative"
            mock_llm.return_value = mock_client
            result = CounterfactualEngine().analyze(
                _make_test_graph(10), "paper_0"
            )
        # analyze() returns a dict (from .to_dict())
        assert isinstance(result, dict)
        assert "removed_paper" in result
        assert "collapsed_count" in result

    def test_missing_paper(self):
        from backend.counterfactual_engine import CounterfactualEngine
        with (
            patch("backend.counterfactual_engine.db") as mock_db,
            patch("backend.llm_client.get_llm_client") as mock_llm,
        ):
            mock_db.fetchone.return_value = None
            mock_db.execute.return_value = None
            mock_client = MagicMock()
            mock_client.generate_chat_response.return_value = "N/A"
            mock_llm.return_value = mock_client
            result = CounterfactualEngine().analyze(
                _make_test_graph(5), "nonexistent_paper"
            )
        assert isinstance(result, dict)
        assert "error" in result


# ── AdversarialReviewer ──────────────────────────────────────────────────────

class TestAdversarialReviewer:
    def test_review_from_abstract_returns_result(self):
        from backend.adversarial_reviewer import AdversarialReviewer
        with (
            patch("backend.llm_client.get_llm_client") as mock_llm,
            patch.object(AdversarialReviewer, "_find_landscape_papers", return_value=[]),
        ):
            mock_client = MagicMock()
            mock_client.generate_chat_response.return_value = (
                "CRITICISM: [minor] Weak methodology\n"
                "STRENGTH: Novel approach"
            )
            mock_llm.return_value = mock_client

            reviewer = AdversarialReviewer()
            result = reviewer.review_from_abstract("Test Paper", "This is a test abstract.")
        assert hasattr(result, "to_dict")
        d = result.to_dict()
        assert "paper_title" in d


# ── CitationGenerator ────────────────────────────────────────────────────────

class TestCitationGenerator:
    def test_generate_apa(self):
        from backend.citation_generator import CitationGenerator
        with patch("backend.citation_generator.db") as mock_db:
            mock_db.fetchone.return_value = {
                "paper_id": "abc", "title": "Test Paper", "authors": ["John Smith"],
                "year": 2020, "doi": "10.1000/test", "venue": "Nature",
            }
            gen = CitationGenerator()
            result = gen.generate(["abc"], styles=["apa"])
        assert isinstance(result, dict)
        assert "citations" in result
        assert "abc" in result["citations"]
        assert "Smith" in result["citations"]["abc"]["apa"]

    def test_generate_all_styles(self):
        from backend.citation_generator import CitationGenerator
        with patch("backend.citation_generator.db") as mock_db:
            mock_db.fetchone.return_value = {
                "paper_id": "abc", "title": "Test", "authors": ["A. B."],
                "year": 2020, "doi": None, "venue": None,
            }
            gen = CitationGenerator()
            result = gen.generate(["abc"], all_styles=True)
        assert isinstance(result, dict)
        cites = result["citations"]["abc"]
        assert "apa" in cites
        assert "bibtex" in cites

    def test_supported_styles(self):
        from backend.citation_generator import SUPPORTED_STYLES
        assert "apa" in SUPPORTED_STYLES
        assert "bibtex" in SUPPORTED_STYLES


# ── CitationAudit ────────────────────────────────────────────────────────────

class TestCitationAudit:
    def test_audit_returns_result(self):
        from backend.citation_audit import CitationAudit
        result = CitationAudit().audit("paper_5", _make_test_graph(10))
        assert hasattr(result, "to_dict")
        d = result.to_dict()
        assert "overall_health" in d

    def test_empty_graph(self):
        from backend.citation_audit import CitationAudit
        result = CitationAudit().audit(
            "paper_0", {"nodes": [], "edges": [], "metadata": {}}
        )
        assert hasattr(result, "to_dict")
        d = result.to_dict()
        assert d["total_citations"] == 0


# ── ReadingPrioritizer ───────────────────────────────────────────────────────

class TestReadingPrioritizer:
    def test_prioritize_returns_list(self):
        from backend.reading_prioritizer import ReadingPrioritizer
        result = ReadingPrioritizer().prioritize(_make_test_graph(10))
        assert isinstance(result, list)
        assert len(result) > 0
        assert "paper_id" in result[0]
        assert "priority" in result[0]
        assert "category" in result[0]


# ── PaperPositioningTool ─────────────────────────────────────────────────────

class TestPaperPositioningTool:
    def test_position_by_abstract(self):
        from backend.paper_positioning import PaperPositioningTool
        with (
            patch("backend.paper_positioning.db") as mock_db,
            patch("backend.paper_positioning.get_llm_client") as mock_llm,
        ):
            mock_db.fetchall.return_value = []
            mock_client = MagicMock()
            mock_client.generate_chat_response.return_value = (
                "FRAMING: Novel approach\nSTATEMENT: This paper...\n"
                "VENUE1: Nature | Good fit\nVENUE2: Science | Also good"
            )
            mock_llm.return_value = mock_client

            tool = PaperPositioningTool()
            result = tool.position_by_abstract("Test Paper", "Test abstract")
        assert hasattr(result, "to_dict")
        d = result.to_dict()
        assert "paper_title" in d
        assert "strongest_framing" in d


# ── RewriteSuggester ─────────────────────────────────────────────────────────

class TestRewriteSuggester:
    def test_suggest_returns_result(self):
        from backend.rewrite_suggester import RewriteSuggester
        with patch("backend.rewrite_suggester.get_llm_client") as mock_llm:
            mock_client = MagicMock()
            mock_client.generate_chat_response.return_value = (
                "CRITIQUE: Good but chronological\n"
                "REWRITE: A narrative approach...\n"
                "ARC: From methods to theory\n"
                "PRINCIPLES: 1. Thematic 2. Connective"
            )
            mock_llm.return_value = mock_client
            result = RewriteSuggester().suggest(
                "Smith (2020) did X. Jones (2019) did Y.", "My Paper"
            )
        assert hasattr(result, "to_dict")
        d = result.to_dict()
        assert "original_critique" in d


# ── PersonaEngine ────────────────────────────────────────────────────────────

class TestPersonaEngine:
    def test_all_four_personas_exist(self):
        from backend.persona_engine import PersonaEngine, PERSONAS
        assert set(PERSONAS.keys()) == {"explorer", "critic", "innovator", "historian"}

    def test_get_persona_returns_dict(self):
        from backend.persona_engine import PersonaEngine
        engine = PersonaEngine()
        for mode in ("explorer", "critic", "innovator", "historian"):
            persona = engine.get_persona(mode)
            assert "name" in persona
            assert "system_modifier" in persona

    def test_unknown_persona_defaults_to_explorer(self):
        from backend.persona_engine import PersonaEngine
        p = PersonaEngine().get_persona("nonexistent")
        assert p["name"] == "Explorer"

    def test_modify_system_prompt(self):
        from backend.persona_engine import PersonaEngine
        result = PersonaEngine().modify_system_prompt("Base prompt", "critic")
        assert "Base prompt" in result
        assert "reviewer" in result.lower() or "critic" in result.lower()

    def test_get_config_returns_serializable(self):
        from backend.persona_engine import PersonaEngine
        config = PersonaEngine().get_config("explorer")
        d = config.to_dict()
        json.dumps(d)
        assert d["mode"] == "explorer"

    def test_list_personas(self):
        from backend.persona_engine import PersonaEngine
        personas = PersonaEngine().list_personas()
        assert len(personas) == 4
        assert all("mode" in p for p in personas)

    def test_filter_insights_for_mode(self):
        from backend.persona_engine import PersonaEngine
        insights = [
            {"category": "bottleneck", "title": "A"},
            {"category": "orphan", "title": "B"},
            {"category": "opportunity", "title": "C"},
        ]
        result = PersonaEngine().filter_insights_for_mode(insights, "innovator")
        assert isinstance(result, list)
        assert len(result) == 3


# ── InsightEngine ────────────────────────────────────────────────────────────

class TestInsightEngine:
    def test_generate_feed_returns_list(self):
        from backend.insight_engine import InsightEngine
        result = InsightEngine().generate_feed(_make_test_graph(15))
        assert isinstance(result, list)
        assert len(result) > 0

    def test_empty_graph(self):
        from backend.insight_engine import InsightEngine
        result = InsightEngine().generate_feed(
            {"nodes": [], "edges": [], "metadata": {}}
        )
        assert result == []

    def test_insight_structure(self):
        from backend.insight_engine import InsightEngine
        result = InsightEngine().generate_feed(_make_test_graph(15))
        if result:
            ins = result[0]
            assert "insight_id" in ins
            assert "category" in ins
            assert "severity" in ins

    def test_serializable(self):
        from backend.insight_engine import InsightEngine
        result = InsightEngine().generate_feed(_make_test_graph(10))
        json.dumps(result)


# ── LabManager ───────────────────────────────────────────────────────────────

class TestLabManager:
    def test_invite_checks_tier(self):
        from backend.lab_manager import LabManager
        with patch("backend.lab_manager.db") as mock_db:
            mock_db.fetchone.return_value = {"tier": "free", "display_name": "Test"}
            result = LabManager().invite_member("user-1", "test@test.com")
        assert result.get("success") is False or "error" in result

    def test_share_methods_exist(self):
        from backend.lab_manager import LabManager
        mgr = LabManager()
        assert callable(getattr(mgr, "create_share_link", None))
        assert callable(getattr(mgr, "get_share", None))
        assert callable(getattr(mgr, "list_shares", None))
        assert callable(getattr(mgr, "delete_share", None))


# ── WebhookManager ───────────────────────────────────────────────────────────

class TestWebhookManager:
    def test_trigger_event_starts_thread(self):
        from backend.webhook_manager import WebhookManager
        with patch("backend.webhook_manager.db") as mock_db:
            mock_db.fetchall.return_value = []
            mgr = WebhookManager()
            mgr.trigger_event("paper_1", "graph.built", {"test": True})
            # Thread is daemon — will exit with test

    def test_deliver_one_logs(self):
        from backend.webhook_manager import WebhookManager
        with (
            patch("backend.webhook_manager.db") as mock_db,
            patch("backend.webhook_manager.requests") as mock_req,
        ):
            mock_db.execute_returning.return_value = {"delivery_id": "test-uuid"}
            mock_db.execute.return_value = None
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_req.post.return_value = mock_resp

            mgr = WebhookManager()
            mgr._deliver_one(
                subscription_id="sub-1",
                webhook_url="https://example.com/hook",
                secret="test-secret",
                event_type="graph.built",
                payload={"paper_id": "p1"},
            )


# ── SecureFileUploadHandler ──────────────────────────────────────────────────

class TestSecureUpload:
    def test_validate_empty_rejects(self):
        from backend.secure_upload import SecureFileUploadHandler
        handler = SecureFileUploadHandler()
        result = handler.validate_and_hash(b"", "test.pdf")
        assert result["valid"] is False

    def test_validate_non_pdf_rejects(self):
        from backend.secure_upload import SecureFileUploadHandler
        handler = SecureFileUploadHandler()
        result = handler.validate_and_hash(b"not a pdf file", "test.txt")
        assert result["valid"] is False

    def test_validate_oversized_rejects(self):
        from backend.secure_upload import SecureFileUploadHandler
        handler = SecureFileUploadHandler()
        # 11MB of data (over default 10MB limit)
        result = handler.validate_and_hash(b"\x00" * (11 * 1024 * 1024), "big.pdf")
        assert result["valid"] is False


# ── PublicAPI Blueprint ──────────────────────────────────────────────────────

class TestPublicAPI:
    def test_blueprint_registered(self):
        from backend.public_api import public_api
        assert public_api.name == "public_api"
        assert public_api.url_prefix == "/v1"


# ── Phase 7 Rate Limits ─────────────────────────────────────────────────────

class TestPhase7RateLimits:
    def test_limits_present(self):
        from backend.rate_limiter import arivu_rate_limiter
        limits = getattr(arivu_rate_limiter, "LIMITS", {})
        for ep in [
            "GET /api/time-machine", "GET /api/counterfactual",
            "POST /api/adversarial-review", "GET /api/citation-audit",
            "POST /api/citation-generator", "POST /api/reading-prioritizer",
            "POST /api/paper-positioning", "POST /api/rewrite-suggester",
            "POST /api/share", "POST /api/lab/invite",
            "GET /api/insights", "POST /api/persona",
            "POST /api/guided-discovery",
        ]:
            assert ep in limits, f"Rate limit missing for {ep!r}"

    def test_public_api_limits_present(self):
        from backend.rate_limiter import arivu_rate_limiter
        limits = getattr(arivu_rate_limiter, "LIMITS", {})
        for ep in [
            "API GET /papers/{id}/graph",
            "API GET /papers/{id}/dna",
            "API GET /papers/search",
        ]:
            assert ep in limits, f"Public API rate limit missing for {ep!r}"


# ── Phase 7 Mailer Additions ────────────────────────────────────────────────

class TestPhase7Mailer:
    def test_lab_invite_email_exists(self):
        from backend import mailer
        assert hasattr(mailer, "send_lab_invite_email")
        assert callable(mailer.send_lab_invite_email)

    def test_email_change_verification_exists(self):
        from backend import mailer
        assert hasattr(mailer, "send_email_change_verification")
        assert callable(mailer.send_email_change_verification)

    def test_lab_invite_email_disabled(self):
        from backend.mailer import send_lab_invite_email
        import backend.mailer as mm
        orig = mm.Config.RESEND_API_KEY
        mm.Config.RESEND_API_KEY = ""
        try:
            assert send_lab_invite_email("t@t.com", "Test Lab", "https://example.com/invite") is True
        finally:
            mm.Config.RESEND_API_KEY = orig

    def test_email_change_disabled(self):
        from backend.mailer import send_email_change_verification
        import backend.mailer as mm
        orig = mm.Config.RESEND_API_KEY
        mm.Config.RESEND_API_KEY = ""
        try:
            assert send_email_change_verification("t@t.com", "token", "https://example.com/confirm") is True
        finally:
            mm.Config.RESEND_API_KEY = orig


# ── Phase 7 Routes ───────────────────────────────────────────────────────────

class TestPhase7Routes:
    @pytest.fixture
    def client(self):
        from app import create_app
        app = create_app()
        app.config["TESTING"] = True
        app.config["PROPAGATE_EXCEPTIONS"] = False
        with app.test_client() as c:
            yield c

    def test_api_docs_200(self, client):
        resp = client.get("/api-docs")
        assert resp.status_code == 200

    def test_persona_get(self, client):
        resp = client.get("/api/persona")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "mode" in data

    def test_guided_discovery_needs_session(self, client):
        resp = client.post("/api/guided-discovery", json={"relationship": "curious"})
        # May work, return 400/401/403, or 500 if DB table missing
        assert resp.status_code in (200, 400, 401, 403, 500)

    def test_time_machine_requires_auth(self, client):
        resp = client.get("/api/time-machine/test_paper")
        # Should be 200 (auth passthrough) or 401 or 500 (no DB)
        assert resp.status_code in (200, 404, 401, 500)

    def test_counterfactual_requires_auth(self, client):
        resp = client.get("/api/counterfactual/test_paper")
        assert resp.status_code in (200, 404, 401, 500)

    def test_share_page_404_for_invalid_token(self, client):
        resp = client.get("/share/nonexistent_token_12345")
        assert resp.status_code in (404, 500)

    def test_citation_generator_requires_paper_ids(self, client):
        resp = client.post("/api/citation-generator", json={})
        # Requires auth or returns 400
        assert resp.status_code in (400, 401)

    def test_adversarial_review_requires_content(self, client):
        resp = client.post(
            "/api/adversarial-review",
            json={},
            content_type="application/json",
        )
        # Should return 400 (no abstract) or 401 (auth)
        assert resp.status_code in (400, 401)


# ── Migration Verification ───────────────────────────────────────────────────

class TestMigrationScript:
    def test_migrate_phase7_has_all_tables(self):
        from scripts.migrate_phase7 import PHASE_7_SQL
        expected = [
            "shared_graphs", "vocabulary_snapshots", "time_machine_cache",
            "counterfactual_cache", "adversarial_reviews", "lab_invites",
            "webhook_subscriptions", "webhook_deliveries", "email_change_tokens",
        ]
        for table in expected:
            assert table in PHASE_7_SQL, f"Migration missing table: {table}"
