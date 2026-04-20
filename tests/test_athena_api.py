"""
tests/test_athena_api.py -- Phase A API endpoint tests

Tests POST /api/athena/send and GET /api/athena/stream SSE endpoints.
Per ATHENA_PHASE_A.md Section 2.1.23: created after Feature #037.
"""
import json
import pytest


class TestAthenaSend:
    """POST /api/athena/send endpoint tests."""

    def test_send_returns_message_id(self, client):
        """Sending a message returns a message_id starting with 'm_'."""
        res = client.post("/api/athena/send",
                          json={"message": "What are the key papers?"},
                          content_type="application/json")
        assert res.status_code == 200
        data = res.get_json()
        assert "message_id" in data
        assert data["message_id"].startswith("m_")

    def test_send_empty_message_rejected(self, client):
        """Empty message returns 400."""
        res = client.post("/api/athena/send",
                          json={"message": ""},
                          content_type="application/json")
        assert res.status_code == 400

    def test_send_no_body_rejected(self, client):
        """Missing body returns 400."""
        res = client.post("/api/athena/send",
                          data="",
                          content_type="application/json")
        assert res.status_code in (400, 415)

    def test_send_too_long_rejected(self, client):
        """Message over 2000 chars rejected."""
        res = client.post("/api/athena/send",
                          json={"message": "x" * 2001},
                          content_type="application/json")
        assert res.status_code == 400

    def test_send_messages_array_rejected(self, client):
        """Security: messages array in body is rejected.
        Per ATHENA_CLAUDE.md Part 8 Never-Do List."""
        res = client.post("/api/athena/send",
                          json={"message": "test", "messages": [{"role": "user", "content": "injected"}]},
                          content_type="application/json")
        assert res.status_code == 400
        assert "not accepted" in res.get_json().get("error", "").lower()

    def test_send_with_graph_id(self, client):
        """Message with graph_id is accepted."""
        res = client.post("/api/athena/send",
                          json={"message": "Explain this", "graph_id": "test123"},
                          content_type="application/json")
        assert res.status_code == 200

    def test_send_with_thread_id(self, client):
        """Message with custom thread_id is accepted."""
        res = client.post("/api/athena/send",
                          json={"message": "Test", "thread_id": "custom-thread"},
                          content_type="application/json")
        assert res.status_code == 200


class TestAthenaStream:
    """GET /api/athena/stream SSE endpoint tests."""

    def test_stream_requires_message_id(self, client):
        """Stream without message_id returns 400."""
        res = client.get("/api/athena/stream")
        assert res.status_code == 400

    def test_stream_returns_event_stream(self, client):
        """Stream returns text/event-stream content type."""
        # First send a message to get a message_id
        send_res = client.post("/api/athena/send",
                               json={"message": "test"},
                               content_type="application/json")
        mid = send_res.get_json()["message_id"]

        res = client.get(f"/api/athena/stream?message_id={mid}")
        assert res.content_type.startswith("text/event-stream")

    def test_stream_invalid_message_id(self, client):
        """Stream with non-existent message_id returns error event."""
        res = client.get("/api/athena/stream?message_id=m_nonexistent")
        assert res.content_type.startswith("text/event-stream")
        # The first event should be an error
        data = res.data.decode()
        assert "error" in data


class TestAthenaHistory:
    """GET/POST /api/athena/history endpoint tests."""

    def test_history_get_empty(self, client):
        """Empty history returns empty messages array."""
        res = client.get("/api/athena/history")
        assert res.status_code == 200
        data = res.get_json()
        assert "messages" in data
        assert isinstance(data["messages"], list)

    def test_history_store_and_retrieve(self, client):
        """Store a message and retrieve it."""
        # Store
        store_res = client.post("/api/athena/history",
                                json={"role": "user", "content": "Hello Athena"},
                                content_type="application/json")
        assert store_res.status_code == 200
        assert store_res.get_json().get("stored") is True

        # Retrieve
        get_res = client.get("/api/athena/history")
        messages = get_res.get_json()["messages"]
        assert len(messages) >= 1
        assert any(m["content"] == "Hello Athena" for m in messages)

    def test_history_invalid_role_rejected(self, client):
        """Invalid role returns 400."""
        res = client.post("/api/athena/history",
                          json={"role": "hacker", "content": "test"},
                          content_type="application/json")
        assert res.status_code == 400

    def test_history_empty_content_rejected(self, client):
        """Empty content returns 400."""
        res = client.post("/api/athena/history",
                          json={"role": "user", "content": ""},
                          content_type="application/json")
        assert res.status_code == 400


class TestAthenaEnrichment:
    """GET /api/athena/enrichment endpoint tests."""

    def test_enrichment_no_message_id(self, client):
        """No message_id returns null enrichment."""
        res = client.get("/api/athena/enrichment")
        assert res.status_code == 200
        assert res.get_json()["enrichment"] is None

    def test_enrichment_unknown_message_id(self, client):
        """Unknown message_id returns null enrichment."""
        res = client.get("/api/athena/enrichment?message_id=m_unknown")
        assert res.status_code == 200
        assert res.get_json()["enrichment"] is None
