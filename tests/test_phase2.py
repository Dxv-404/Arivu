"""
tests/test_phase2.py — Unit tests for Phase 2 modules.

All tests are offline (no network, no NLP worker, no external APIs).
Database calls are not tested here — that is covered by test_pipeline.py.
"""
import pytest


# ─── Normalizer tests ─────────────────────────────────────────────────────────

class TestNormalizeUserInput:
    """normalize_user_input() correctly identifies all input types."""

    def setup_method(self):
        from backend.normalizer import normalize_user_input
        self.fn = normalize_user_input

    def test_bare_doi(self):
        cid, itype = self.fn("10.1145/3292500.3330683")
        assert itype == "doi"
        assert cid == "10.1145/3292500.3330683"

    def test_doi_url(self):
        cid, itype = self.fn("https://doi.org/10.1038/s41586-021-03275-y")
        assert itype == "doi"
        assert cid == "10.1038/s41586-021-03275-y"

    def test_doi_prefix(self):
        cid, itype = self.fn("doi:10.1145/12345")
        assert itype == "doi"
        assert cid == "10.1145/12345"

    def test_arxiv_bare(self):
        cid, itype = self.fn("1706.03762")
        assert itype == "arxiv"
        assert "1706" in cid

    def test_arxiv_url(self):
        cid, itype = self.fn("https://arxiv.org/abs/1706.03762")
        assert itype == "arxiv"
        assert "1706" in cid

    def test_arxiv_version_stripped(self):
        cid, itype = self.fn("2303.08774v2")
        assert itype == "arxiv"
        assert "v2" not in cid

    def test_s2_url(self):
        s2_id = "a" * 40
        cid, itype = self.fn(f"https://www.semanticscholar.org/paper/Title/{s2_id}")
        assert itype == "s2"
        assert cid == s2_id

    def test_s2_bare_id(self):
        s2_id = "a1b2c3" + "0" * 34
        cid, itype = self.fn(s2_id)
        assert itype == "s2"

    def test_pubmed_id(self):
        cid, itype = self.fn("12345678")
        assert itype == "pubmed"

    def test_pubmed_url(self):
        cid, itype = self.fn("https://pubmed.ncbi.nlm.nih.gov/12345678/")
        assert itype == "pubmed"
        assert cid == "12345678"

    def test_openalex_id(self):
        cid, itype = self.fn("W2741809807")
        assert itype == "openalex"

    def test_title_fallback(self):
        cid, itype = self.fn("Attention Is All You Need")
        assert itype == "title"
        assert "Attention" in cid

    def test_empty_string(self):
        cid, itype = self.fn("")
        assert itype == "title"


# ─── split_into_sentences tests ───────────────────────────────────────────────

class TestSplitIntoSentences:
    def setup_method(self):
        from backend.normalizer import split_into_sentences
        self.fn = split_into_sentences

    def test_empty_text_returns_empty(self):
        assert self.fn("") == []

    def test_single_sentence(self):
        result = self.fn("This is a single long sentence about machine learning.")
        assert len(result) >= 1

    def test_max_sentences_respected(self):
        text = " ".join([f"Sentence number {i} is here now." for i in range(100)])
        result = self.fn(text, max_sentences=10)
        assert len(result) <= 10

    def test_short_fragments_excluded(self):
        result = self.fn("Hi. This is a much longer sentence that should be included.")
        # "Hi." is too short (≤15 chars), should not appear as standalone sentence
        for s in result:
            assert len(s) > 15


# ─── Deduplicator tests ───────────────────────────────────────────────────────

class TestPaperDeduplicator:
    def setup_method(self):
        from backend.deduplicator import PaperDeduplicator
        self.dedup = PaperDeduplicator()

    def _s2_candidate(self, **kwargs) -> dict:
        defaults = {
            "_source":      "s2",
            "paper_id":     "a" * 40,
            "s2_id":        "a" * 40,
            "title":        "Test Paper",
            "abstract":     "Short abstract.",
            "year":         2020,
            "citation_count": 100,
            "authors":      ["Author One"],
            "doi":          "10.1234/test",
            "url":          "https://semanticscholar.org/paper/" + "a" * 40,
            "fields_of_study": ["Computer Science"],
            "references":   [],
        }
        defaults.update(kwargs)
        return defaults

    def test_single_candidate_returns_paper(self):
        paper = self.dedup.merge([self._s2_candidate()])
        assert paper.paper_id == "a" * 40
        assert paper.title == "Test Paper"

    def test_abstract_longest_wins(self):
        short = self._s2_candidate(abstract="Short.")
        long_oa = {
            "_source": "openalex",
            "openalex_id": "W123",
            "title": "Test Paper",
            "abstract": "A much longer abstract that has more information about the paper.",
            "year": 2020,
            "citation_count": 100,
            "authors": ["Author One"],
            "doi": "10.1234/test",
        }
        paper = self.dedup.merge([short, long_oa])
        assert "longer" in (paper.abstract or "")

    def test_missing_s2_id_raises(self):
        bad = {"_source": "openalex", "title": "No S2 ID here"}
        with pytest.raises((ValueError, Exception)):
            self.dedup.merge([bad])

    def test_titles_match_high_similarity(self):
        assert self.dedup.titles_match(
            "Attention Is All You Need",
            "attention is all you need"
        )

    def test_titles_match_rejects_different(self):
        assert not self.dedup.titles_match(
            "Attention Is All You Need",
            "Deep Residual Learning for Image Recognition"
        )


# ─── ArivuRateLimiter tests ───────────────────────────────────────────────────

class TestArivuRateLimiter:
    def setup_method(self):
        from backend.rate_limiter import ArivuRateLimiter
        import asyncio
        self.limiter = ArivuRateLimiter()
        self.loop = asyncio.new_event_loop()

    def teardown_method(self):
        self.loop.close()

    def _check(self, session_id: str, endpoint: str):
        return self.loop.run_until_complete(
            self.limiter.check(session_id, endpoint)
        )

    def test_unknown_endpoint_always_allowed(self):
        allowed, headers = self._check("sess1", "GET /unknown")
        assert allowed is True
        assert headers == {}

    def test_within_limit_allowed(self):
        allowed, headers = self._check("sess_fresh", "POST /api/search")
        assert allowed is True
        assert "X-RateLimit-Limit" in headers

    def test_exceeds_limit_blocked(self):
        # Exhaust the 30/min search limit
        for _ in range(30):
            self._check("sess_exhaust", "POST /api/search")
        allowed, headers = self._check("sess_exhaust", "POST /api/search")
        assert allowed is False
        assert "Retry-After" in headers

    def test_different_sessions_independent(self):
        # Exhaust session A
        for _ in range(30):
            self._check("sess_a", "POST /api/search")
        # Session B should still work
        allowed, _ = self._check("sess_b", "POST /api/search")
        assert allowed is True

    def test_graph_stream_key_is_get(self):
        # Verify the rate limiter uses the correct HTTP method for
        # the graph stream endpoint. "POST /api/graph/stream" should be unknown
        # (always allowed), while "GET /api/graph/stream" should be rate-limited.
        allowed_post, _ = self._check("sess_test", "POST /api/graph/stream")
        assert allowed_post is True, "POST /api/graph/stream should not be in LIMITS"
        allowed_get, headers = self._check("sess_test", "GET /api/graph/stream")
        assert "X-RateLimit-Limit" in headers, "GET /api/graph/stream should be rate-limited"


# ─── R2Client no-op mode tests ────────────────────────────────────────────────

class TestR2ClientNoOp:
    """R2Client in no-op mode (no credentials) should not raise."""

    def setup_method(self):
        from backend.r2_client import R2Client

        class _FakeCfg:
            R2_ENABLED = False
            R2_BUCKET_NAME = "test-bucket"
            R2_ACCOUNT_ID = ""
            R2_ACCESS_KEY_ID = ""
            R2_SECRET_ACCESS_KEY = ""

        self.client = R2Client(_FakeCfg())

    def test_put_no_op(self):
        self.client.put("some/key", b"data")   # Should not raise

    def test_get_returns_none(self):
        assert self.client.get("some/key") is None

    def test_exists_returns_false(self):
        assert self.client.exists("some/key") is False

    def test_put_json_no_op(self):
        self.client.put_json("some/key.json", {"a": 1})   # Should not raise

    def test_get_json_returns_none(self):
        assert self.client.get_json("some/key.json") is None
