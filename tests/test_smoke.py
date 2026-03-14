"""
test_smoke.py — Phase 1 smoke tests.

Verifies:
  1. /health returns HTTP 200
  2. Response has the expected shape
  3. DB is actually connected (not mocked)

Run: python -m pytest tests/test_smoke.py -v
All three must pass before proceeding to Phase 2.
"""
import pytest
from app import create_app


@pytest.fixture(scope="module")
def client():
    """Create the Flask test client once for all tests in this module."""
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def test_health_returns_200(client):
    resp = client.get("/health")
    assert resp.status_code == 200, (
        f"Expected HTTP 200, got {resp.status_code}. "
        "Check that DATABASE_URL is set and the DB is reachable."
    )


def test_health_response_has_required_fields(client):
    data = client.get("/health").get_json()
    assert "status"     in data, "Response missing 'status' field"
    assert "db"         in data, "Response missing 'db' field"
    assert "nlp_worker" in data, "Response missing 'nlp_worker' field"
    assert "version"    in data, "Response missing 'version' field"


def test_health_db_is_connected(client):
    data = client.get("/health").get_json()
    assert data["db"] is True, (
        "DB health check returned False. "
        "Ensure DATABASE_URL is set in .env with ?sslmode=require "
        "(Neon requires SSL). Run: python scripts/migrate.py"
    )
