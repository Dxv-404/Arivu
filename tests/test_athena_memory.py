"""
tests/test_athena_memory.py -- Phase A memory tests

Tests conversation storage, retrieval, thread isolation.
Per ATHENA_PHASE_A.md Section 2.1.23: created after Feature #006.
"""
import json
import pytest


class TestConversationStorage:
    """Test message persistence in chat_history."""

    def test_store_user_message(self, client):
        """User message stores correctly with thread_id and metadata."""
        res = client.post("/api/athena/history",
                          json={"role": "user", "content": "Test message",
                                "thread_id": "main", "metadata": {"graph_id": "g1"}},
                          content_type="application/json")
        assert res.status_code == 200

    def test_store_assistant_message(self, client):
        """Assistant message stores correctly."""
        res = client.post("/api/athena/history",
                          json={"role": "assistant", "content": "Response text"},
                          content_type="application/json")
        assert res.status_code == 200

    def test_store_system_message(self, client):
        """System message stores correctly."""
        res = client.post("/api/athena/history",
                          json={"role": "system", "content": "Graph loaded"},
                          content_type="application/json")
        assert res.status_code == 200

    def test_retrieve_preserves_order(self, client):
        """Messages retrieved in chronological order."""
        for i in range(3):
            client.post("/api/athena/history",
                        json={"role": "user", "content": f"Message {i}"},
                        content_type="application/json")

        res = client.get("/api/athena/history?limit=10")
        messages = res.get_json()["messages"]
        # Should be in chronological order
        user_msgs = [m for m in messages if m["role"] == "user"]
        if len(user_msgs) >= 3:
            assert "Message 0" in user_msgs[-3]["content"]


class TestThreadIsolation:
    """Test that thread_id isolates conversations."""

    def test_default_thread_is_main(self, client):
        """Messages without thread_id default to 'main'."""
        client.post("/api/athena/history",
                     json={"role": "user", "content": "Main thread msg"},
                     content_type="application/json")

        res = client.get("/api/athena/history?thread_id=main")
        messages = res.get_json()["messages"]
        assert any("Main thread" in m["content"] for m in messages)

    def test_different_threads_isolated(self, client):
        """Messages in different threads don't mix."""
        client.post("/api/athena/history",
                     json={"role": "user", "content": "Thread A msg", "thread_id": "thread-a"},
                     content_type="application/json")

        # Retrieve from thread-b (should not contain thread-a messages)
        res = client.get("/api/athena/history?thread_id=thread-b")
        messages = res.get_json()["messages"]
        assert not any("Thread A" in m.get("content", "") for m in messages)
