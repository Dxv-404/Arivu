"""
tests/test_phase8.py — Phase 8 test suite.
All tests offline — no live APIs required.
Run: pytest tests/test_phase8.py -v
"""
import json
import pytest
from unittest.mock import patch, MagicMock


def _make_graph(n=15, cross_domain=False) -> dict:
    import random
    rng    = random.Random(42)
    fields = ["CS", "Biology", "Physics"]
    nodes  = [
        {
            "id":             f"p{i}",
            "title":          f"Paper {i}",
            "year":           2010 + i,
            "citation_count": rng.randint(5, 500),
            "fields_of_study": [fields[i % len(fields)] if cross_domain else "CS"],
            "abstract":       f"This paper proposes a new method for task {i}. We show results.",
            "is_bottleneck":  i == 0,
            "pruning_impact": 0.4 if i == 0 else 0.05,
            "is_retracted":   False,
            "authors":        [f"Author {i}"],
        }
        for i in range(n)
    ]
    edges = [
        {
            "source":           f"p{i}",
            "target":           f"p{i-1}",
            "mutation_type":    "adoption",
            "similarity_score": 0.7 + rng.random() * 0.2,
            "inherited_idea":   f"method from paper {i-1}",
            "confidence_tier":  "medium",
        }
        for i in range(1, n)
    ]
    return {
        "nodes": nodes,
        "edges": edges,
        "metadata": {
            "seed_paper_id":    f"p{n-1}",
            "seed_paper_title": "Seed Paper",
            "graph_id":         "test-graph-001",
            "coverage_score":   0.85,
        },
    }


# ── CrossDomainSparkDetector ──────────────────────────────────────────────────

class TestCrossDomainSparkDetector:
    def test_finds_cross_domain_edges(self):
        from backend.cross_domain_spark import CrossDomainSparkDetector
        graph = _make_graph(10, cross_domain=True)
        with patch("backend.cross_domain_spark.db.fetchall", return_value=[]):
            result = CrossDomainSparkDetector().detect(graph)
        assert "sparks"        in result
        assert "future_sparks" in result
        assert "summary"       in result
        assert json.dumps(result)

    def test_empty_graph_returns_gracefully(self):
        from backend.cross_domain_spark import CrossDomainSparkDetector
        with patch("backend.cross_domain_spark.db.fetchall", return_value=[]):
            result = CrossDomainSparkDetector().detect({"nodes": [], "edges": []})
        assert result["sparks"] == []

    def test_current_year_not_hardcoded(self):
        import datetime
        from backend.cross_domain_spark import _CURRENT_YEAR
        assert _CURRENT_YEAR == datetime.datetime.now().year


# ── ErrorPropagationTracker ───────────────────────────────────────────────────

class TestErrorPropagationTracker:
    def test_clean_graph(self):
        from backend.error_propagation import ErrorPropagationTracker
        with patch("backend.error_propagation.db.fetchall", return_value=[]):
            result = ErrorPropagationTracker().analyze(_make_graph(5))
        assert result["clean"] is True
        assert result["flagged_papers"] == []

    def test_flagged_paper_detected(self):
        from backend.error_propagation import ErrorPropagationTracker
        mock_row = {
            "paper_id": "p0", "title": "Retracted Paper",
            "is_retracted": True, "retraction_reason": "Data fabrication",
            "pubpeer_flags": None, "rw_reason": "Data fabrication",
            "retraction_date": "2023-01-01",
        }
        with patch("backend.error_propagation.db.fetchall", return_value=[mock_row]):
            result = ErrorPropagationTracker().analyze(_make_graph(5))
        assert result["clean"] is False
        assert len(result["flagged_papers"]) >= 1

    def test_pubpeer_flags_handled(self):
        from backend.error_propagation import ErrorPropagationTracker
        mock_row = {
            "paper_id": "p1", "title": "Contested Paper",
            "is_retracted": False, "retraction_reason": None,
            "pubpeer_flags": {"summary": "Reviewer concerns about data"},
            "rw_reason": None, "retraction_date": None,
        }
        with patch("backend.error_propagation.db.fetchall", return_value=[mock_row]):
            result = ErrorPropagationTracker().analyze(_make_graph(5))
        assert result["clean"] is False
        assert len(result["flagged_papers"]) >= 1


# ── CitationIntentClassifier ──────────────────────────────────────────────────

class TestCitationIntentClassifier:
    def test_detects_contradiction_markers(self):
        from backend.nlp_pipeline import CitationIntentClassifier
        clf = CitationIntentClassifier()
        result = clf.classify(
            "Contrary to prior work, we show this approach fails.",
            "abstract text", "Some Paper", "adoption"
        )
        assert result == "direct_contradiction"

    def test_mutation_type_mapping(self):
        from backend.nlp_pipeline import CitationIntentClassifier
        clf = CitationIntentClassifier()
        result = clf.classify("", "", "Some Paper", "revival")
        assert result == "revival"

    def test_returns_valid_category(self):
        from backend.nlp_pipeline import CitationIntentClassifier, CITATION_INTENT_CATEGORIES
        clf = CitationIntentClassifier()
        # With no markers and unknown mutation_type, falls back to LLM or default
        mock_llm = MagicMock()
        mock_llm.generate_chat_response.return_value = "methodological_adoption"
        with patch("backend.llm_client.get_llm_client", return_value=mock_llm):
            result = clf.classify("", "", "Paper", "synthesis")
        assert result in CITATION_INTENT_CATEGORIES


# ── ReadingBetweenLines ───────────────────────────────────────────────────────

class TestReadingBetweenLines:
    def test_returns_structure(self):
        from backend.reading_between_lines import ReadingBetweenLines
        mock_llm = MagicMock()
        mock_llm.generate_chat_response.return_value = (
            "REAL_CLAIM: A new method achieves state of the art.\n"
            "IMPLICIT_FOIL: Prior approaches relied on expensive computation.\n"
            "CONFIDENCE_SIGNALS: Hedging language suggests uncertainty.\n"
            "MINIMAL_CLAIM: A smaller model on one dataset.\n"
        )
        with patch("backend.reading_between_lines.get_llm_client", return_value=mock_llm):
            result = ReadingBetweenLines().analyze(_make_graph(5), "p0")
        d = result.to_dict()
        assert "real_claim"         in d
        assert "implicit_foil"      in d
        assert "confidence_signals" in d
        assert json.dumps(d)

    def test_no_abstract_graceful(self):
        from backend.reading_between_lines import ReadingBetweenLines
        graph  = {"nodes": [{"id": "p0", "title": "T"}], "edges": []}
        result = ReadingBetweenLines().analyze(graph, "p0")
        assert result.confidence == "unavailable"


# ── IntellectualDebtTracker ───────────────────────────────────────────────────

class TestIntellectualDebtTracker:
    def test_returns_structure(self):
        from backend.intellectual_debt import IntellectualDebtTracker
        # No LLM needed — pure graph analysis
        result = IntellectualDebtTracker().analyze(_make_graph(10))
        assert "debts"   in result
        assert "summary" in result
        assert "total_debt_score" in result
        assert json.dumps(result)


# ── ChallengeGenerator ────────────────────────────────────────────────────────

class TestChallengeGenerator:
    def test_generates_challenges(self):
        from backend.challenge_generator import ChallengeGenerator
        result = ChallengeGenerator().generate(_make_graph(10), "p0")
        assert "challenges" in result
        assert "summary"    in result
        assert isinstance(result["challenges"], list)
        assert json.dumps(result)

    def test_small_graph_no_challenges(self):
        from backend.challenge_generator import ChallengeGenerator
        result = ChallengeGenerator().generate({"nodes": [{"id": "p0"}], "edges": []})
        assert result["challenges"] == []


# ── IdeaCreditSystem ──────────────────────────────────────────────────────────

class TestIdeaCreditSystem:
    def test_computes_credits(self):
        from backend.idea_credit import IdeaCreditSystem
        credits = IdeaCreditSystem().compute_graph_credits(_make_graph(10))
        assert isinstance(credits, list)
        for c in credits:
            assert "paper_id"       in c
            assert "credit_score"   in c
            assert "adoption_count" in c
            assert json.dumps(c)

    def test_empty_edges_returns_empty(self):
        from backend.idea_credit import IdeaCreditSystem
        credits = IdeaCreditSystem().compute_graph_credits(
            {"nodes": [{"id": "p0"}], "edges": []}
        )
        assert credits == []


# ── ResearcherProfileBuilder ──────────────────────────────────────────────────

class TestResearcherProfileBuilder:
    def test_builds_profile_from_graph(self):
        from backend.researcher_profiles import ResearcherProfileBuilder
        import hashlib
        graph = _make_graph(10)
        # Get the author_id for "Author 0"
        a_id = hashlib.sha256("author 0".encode()).hexdigest()[:32]
        with patch("backend.researcher_profiles.db.fetchone", return_value=None):
            with patch("backend.researcher_profiles.db.execute"):
                profile = ResearcherProfileBuilder().build_profile(a_id, graph)
        assert "author_id" in profile
        assert "contribution_types" in profile
        assert json.dumps(profile)

    def test_author_not_found(self):
        from backend.researcher_profiles import ResearcherProfileBuilder
        with patch("backend.researcher_profiles.db.fetchone", return_value=None):
            result = ResearcherProfileBuilder().build_profile("nonexistent_id")
        assert result.get("error") == "author_not_found"


# ── LiteratureReviewEngine ────────────────────────────────────────────────────

class TestLiteratureReviewEngine:
    def test_returns_structure(self):
        from backend.literature_review_engine import LiteratureReviewEngine
        engine = LiteratureReviewEngine()
        mock_llm = MagicMock()
        mock_llm.available = True
        mock_llm.generate_chat_response.return_value = "THREAD: Test\nDESCRIPTION: x\nPAPERS: y\n---"
        with (patch.object(engine, '_embed_question', return_value=None),
              patch("backend.literature_review_engine.db.fetchall", return_value=[]),
              patch("backend.literature_review_engine.get_llm_client", return_value=mock_llm)):
            result = engine.generate("What is reinforcement learning?", "user123")
        d = result.to_dict()
        assert "research_question" in d
        assert "threads"           in d
        assert "minimum_reading"   in d
        assert json.dumps(d)

    def test_uses_graph_when_provided(self):
        from backend.literature_review_engine import LiteratureReviewEngine
        engine = LiteratureReviewEngine()
        graph  = _make_graph(5)
        mock_llm = MagicMock()
        mock_llm.available = True
        mock_llm.generate_chat_response.return_value = "THREAD: Test\nDESCRIPTION: x\nPAPERS: y\n---"
        with (patch.object(engine, '_embed_question', return_value=None),
              patch("backend.literature_review_engine.db.fetchall", return_value=[]),
              patch("backend.literature_review_engine.get_llm_client", return_value=mock_llm)):
            result = engine.generate("test question", "user123", graph_json=graph)
        assert result is not None


# ── ResearchRiskAnalyzer ──────────────────────────────────────────────────────

class TestResearchRiskAnalyzer:
    def test_returns_risk_analysis(self):
        from backend.research_risk_analyzer import ResearchRiskAnalyzer
        result = ResearchRiskAnalyzer().analyze(_make_graph(12), "self-supervised learning")
        assert "risks"        in result
        assert "overall_risk" in result
        assert result["overall_risk"] in ("low", "medium", "high")
        assert json.dumps(result)

    def test_mitigation_present(self):
        from backend.research_risk_analyzer import ResearchRiskAnalyzer
        result = ResearchRiskAnalyzer().analyze(_make_graph(12), "test")
        # Each risk has a mitigation field
        for risk in result["risks"]:
            assert "mitigation" in risk

    def test_small_graph(self):
        from backend.research_risk_analyzer import ResearchRiskAnalyzer
        result = ResearchRiskAnalyzer().analyze(
            {"nodes": [{"id": "p0"}], "edges": []}, "test"
        )
        assert result["overall_risk"] == "low"


# ── GraphMemory ───────────────────────────────────────────────────────────────

class TestGraphMemory:
    def test_get_memory_returns_default_for_new_user(self):
        from backend.graph_memory import GraphMemoryManager
        with patch("backend.graph_memory.db.fetchone", return_value=None):
            mem = GraphMemoryManager().get_memory("user123", "graph456")
        assert "seen_paper_ids"   in mem
        assert "navigation_path"  in mem

    def test_navigation_path_is_list(self):
        from backend.graph_memory import GraphMemoryManager
        with patch("backend.graph_memory.db.fetchone", return_value=None):
            mem = GraphMemoryManager().get_memory("u1", "g1")
        assert isinstance(mem["navigation_path"], list)

    def test_mark_edge_flagged(self):
        from backend.graph_memory import GraphMemoryManager
        with (patch("backend.graph_memory.db.fetchone", return_value=None),
              patch("backend.graph_memory.db.execute") as mock_exec):
            GraphMemoryManager().mark_edge_flagged("u1", "g1", "e1:e2")
        assert mock_exec.call_count >= 1


# ── FieldEntryKit ─────────────────────────────────────────────────────────────

class TestFieldEntryKit:
    def test_returns_required_keys(self):
        from backend.field_entry_kit import FieldEntryKit
        graph = _make_graph(8)
        mock_llm = MagicMock()
        mock_llm.generate_chat_response.return_value = (
            "PITFALL1: Assuming results generalize.\n"
            "PITFALL2: Skipping history.\n"
            "QUESTION1: What assumptions remain unverified?\n"
            "QUESTION2: What domains remain unexplored?\n"
        )
        with patch("backend.field_entry_kit.get_llm_client", return_value=mock_llm):
            result = FieldEntryKit().generate(graph, "test question", "user123")
        for key in ("seed_title", "prerequisites", "key_concepts",
                    "reading_order", "common_pitfalls", "open_questions"):
            assert key in result
        assert json.dumps(result)

    def test_handles_small_graph(self):
        from backend.field_entry_kit import FieldEntryKit
        graph  = {"nodes": [{"id": "p0"}], "edges": [], "metadata": {}}
        result = FieldEntryKit().generate(graph, "test", "user123")
        assert "error" in result


# ── ScienceJournalismLayer ────────────────────────────────────────────────────

class TestScienceJournalismLayer:
    def test_returns_all_fields(self):
        from backend.science_journalism import ScienceJournalismLayer
        mock_llm = MagicMock()
        mock_llm.available = True
        mock_llm.generate_chat_response.return_value = (
            "HYPE_SCORE: 0.7\nHYPE_VERDICT: significant\n"
            "HYPE_REASONING: Solid empirical results.\n"
            "CONTEXT_STORY: The field evolved from early work.\n"
            "PLAIN_LANGUAGE: A faster model for text classification.\n"
            "STAKES_IF_TRUE: Could enable real-time translation.\n"
        )
        with patch("backend.science_journalism.get_llm_client", return_value=mock_llm):
            result = ScienceJournalismLayer().analyze(_make_graph(5), "p0").to_dict()
        for key in ("hype_detector", "context_story", "plain_language", "stakes_if_true"):
            assert key in result
        assert json.dumps(result)


# ── InterdisciplinaryTranslator ───────────────────────────────────────────────

class TestInterdisciplinaryTranslator:
    def test_translate_returns_structure(self):
        from backend.interdisciplinary_translation import InterdisciplinaryTranslator
        mock_llm = MagicMock()
        mock_llm.available = True
        mock_llm.generate_chat_response.return_value = (
            "TERM_A: gradient descent\nTERM_B: error minimization\n"
            "EXPLANATION: Equivalent concepts across CS and biology.\n"
            "UNTRANSLATED: regularization\n"
        )
        with patch("backend.interdisciplinary_translation.get_llm_client", return_value=mock_llm):
            result = InterdisciplinaryTranslator().translate(_make_graph(8, cross_domain=True))
        for key in ("equivalences", "untranslated", "summary"):
            assert key in result
        assert json.dumps(result)


# ── LiveModeManager ───────────────────────────────────────────────────────────

class TestLiveModeManager:
    def test_create_subscription(self):
        from backend.live_mode import LiveModeManager
        with patch("backend.live_mode.db.execute_returning",
                   return_value={"subscription_id": "sub-uuid-1234"}):
            sub_id = LiveModeManager().create_subscription(
                "user1", "graph1", "paper1",
                ["new_citation", "paradigm_shift"], True,
            )
        assert sub_id == "sub-uuid-1234"

    def test_get_unread_alerts(self):
        from backend.live_mode import LiveModeManager
        mock_rows = [
            {"alert_id": "a1", "event_type": "new_citation", "event_data": {},
             "created_at": "2025-01-01", "seed_paper_id": "p1"},
        ]
        with patch("backend.live_mode.db.fetchall", return_value=mock_rows):
            alerts = LiveModeManager().get_unread_alerts("user1")
        assert len(alerts) == 1
        assert alerts[0]["event_type"] == "new_citation"


# ── Coverage Gate ─────────────────────────────────────────────────────────────

class TestCoverageGate:
    def test_high_coverage_unlocks_all_features(self):
        import app as a
        gates = a._coverage_gate(0.90)
        assert all(gates.values())

    def test_low_coverage_gates_features(self):
        import app as a
        gates = a._coverage_gate(0.40)
        assert gates["cross_domain_spark"] is True
        assert gates["intellectual_debt"]  is False
