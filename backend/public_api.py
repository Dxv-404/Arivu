"""
backend/public_api.py — Public REST API Blueprint /v1/ (Phase 7)

Provides authenticated API access for Developer and Lab tier users.
All endpoints require X-API-Key header with a valid API key.

Written from scratch (v1 missing). Per ADR-016, all authenticated users
can access the API (no tier gating).
"""
import hashlib
import json
import logging
import secrets
from datetime import datetime, timezone
from functools import wraps

from flask import Blueprint, g, jsonify, request
import backend.db as db
from backend.config import Config

logger = logging.getLogger(__name__)

public_api = Blueprint("public_api", __name__, url_prefix="/v1")


def require_api_key(f):
    """Validate X-API-Key header against api_keys table."""
    @wraps(f)
    def decorated(*args, **kwargs):
        api_key = request.headers.get("X-API-Key", "")
        if not api_key or not api_key.startswith("ak_"):
            return jsonify({"error": "Missing or invalid API key", "code": "INVALID_API_KEY"}), 401

        # Look up by prefix (first 8 chars after ak_)
        prefix = api_key[3:11] if len(api_key) > 10 else api_key[3:]
        key_hash = hashlib.sha256(api_key.encode()).hexdigest()

        row = db.fetchone(
            """
            SELECT ak.key_id, ak.user_id, ak.name, u.tier
            FROM api_keys ak
            JOIN users u ON u.user_id = ak.user_id
            WHERE ak.key_prefix = %s AND ak.key_hash = %s AND ak.revoked_at IS NULL
            """,
            (prefix, key_hash),
        )
        if not row:
            return jsonify({"error": "Invalid API key", "code": "INVALID_API_KEY"}), 401

        # Update last_used
        db.execute(
            "UPDATE api_keys SET last_used_at = NOW() WHERE key_id = %s::uuid",
            (str(row["key_id"]),),
        )

        g.api_user_id = str(row["user_id"])
        g.api_tier = row.get("tier", "researcher")
        return f(*args, **kwargs)
    return decorated


@public_api.route("/papers/<paper_id>/graph")
@require_api_key
def v1_get_graph(paper_id):
    """Return the full citation graph JSON for a paper."""
    row = db.fetchone(
        """
        SELECT graph_json_url FROM graphs
        WHERE seed_paper_id = %s
        ORDER BY computed_at DESC NULLS LAST
        LIMIT 1
        """,
        (paper_id,),
    )
    if not row or not row.get("graph_json_url"):
        return jsonify({"error": "Graph not found. Build it first via the web interface.",
                        "code": "GRAPH_NOT_FOUND"}), 404

    try:
        from backend.r2_client import R2Client
        graph = R2Client().download_json(row["graph_json_url"])
        return jsonify(graph)
    except Exception as exc:
        logger.error(f"v1 graph fetch failed: {exc}")
        return jsonify({"error": "Failed to retrieve graph", "code": "FETCH_ERROR"}), 500


@public_api.route("/papers/<paper_id>/dna")
@require_api_key
def v1_get_dna(paper_id):
    """Return the Research DNA profile for a paper."""
    row = db.fetchone(
        "SELECT dna_json FROM graphs WHERE seed_paper_id = %s ORDER BY computed_at DESC LIMIT 1",
        (paper_id,),
    )
    if not row or not row.get("dna_json"):
        return jsonify({"error": "DNA profile not found", "code": "NOT_FOUND"}), 404
    return jsonify(row["dna_json"])


@public_api.route("/papers/<paper_id>/score")
@require_api_key
def v1_get_score(paper_id):
    """Return the living paper score and velocity."""
    from backend.living_paper_scorer import LivingPaperScorer
    try:
        result = LivingPaperScorer().score_paper(paper_id)
        return jsonify(result)
    except Exception as exc:
        return jsonify({"error": str(exc), "code": "SCORE_ERROR"}), 500


@public_api.route("/papers/<paper_id>/prune", methods=["POST"])
@require_api_key
def v1_prune(paper_id):
    """Return the pruning result for removing a paper."""
    data = request.get_json(silent=True) or {}
    remove_id = data.get("remove_paper_id", paper_id)

    row = db.fetchone(
        "SELECT graph_json_url FROM graphs WHERE seed_paper_id = %s ORDER BY computed_at DESC LIMIT 1",
        (paper_id,),
    )
    if not row or not row.get("graph_json_url"):
        return jsonify({"error": "Graph not found", "code": "NOT_FOUND"}), 404

    try:
        from backend.r2_client import R2Client
        from backend.pruning import compute_pruning_result
        graph = R2Client().download_json(row["graph_json_url"])
        result = compute_pruning_result(graph, [remove_id])
        return jsonify(result)
    except Exception as exc:
        return jsonify({"error": str(exc), "code": "PRUNE_ERROR"}), 500


@public_api.route("/papers/<paper_id>/gaps")
@require_api_key
def v1_get_gaps(paper_id):
    """Return identified research gaps."""
    from backend.gap_finder import GapFinder
    row = db.fetchone(
        "SELECT graph_json_url FROM graphs WHERE seed_paper_id = %s ORDER BY computed_at DESC LIMIT 1",
        (paper_id,),
    )
    if not row:
        return jsonify({"error": "Graph not found", "code": "NOT_FOUND"}), 404
    try:
        from backend.r2_client import R2Client
        graph = R2Client().download_json(row["graph_json_url"])
        gaps = GapFinder().find_gaps(graph)
        return jsonify({"gaps": gaps})
    except Exception as exc:
        return jsonify({"error": str(exc), "code": "GAP_ERROR"}), 500


@public_api.route("/papers/<paper_id>/mutations")
@require_api_key
def v1_get_mutations(paper_id):
    """Return edge mutation classifications."""
    rows = db.fetchall(
        """
        SELECT edge_id, citing_paper_id, cited_paper_id,
               mutation_type, mutation_confidence, citation_intent
        FROM edge_analysis
        WHERE citing_paper_id = %s OR cited_paper_id = %s
        ORDER BY mutation_confidence DESC
        LIMIT 100
        """,
        (paper_id, paper_id),
    )
    return jsonify({"mutations": [dict(r) for r in rows]})


@public_api.route("/papers/search")
@require_api_key
def v1_search():
    """Search papers by title."""
    query = request.args.get("q", "").strip()
    limit = min(int(request.args.get("limit", "10")), 50)
    if not query or len(query) < 3:
        return jsonify({"error": "Query must be at least 3 characters", "code": "BAD_QUERY"}), 400

    rows = db.fetchall(
        """
        SELECT paper_id, title, year, citation_count, authors, fields_of_study
        FROM papers
        WHERE title ILIKE %s
        ORDER BY citation_count DESC
        LIMIT %s
        """,
        (f"%{query}%", limit),
    )
    return jsonify({"results": [dict(r) for r in rows]})


@public_api.route("/fields/<field_name>/fingerprint")
@require_api_key
def v1_field_fingerprint(field_name):
    """Return field fingerprint profile."""
    from backend.field_fingerprint import FieldFingerprintAnalyzer
    # Build a pseudo-graph from papers in this field
    rows = db.fetchall(
        """
        SELECT paper_id, title, year, citation_count, fields_of_study, abstract
        FROM papers
        WHERE %s = ANY(fields_of_study)
        ORDER BY citation_count DESC
        LIMIT 100
        """,
        (field_name,),
    )
    if not rows:
        return jsonify({"error": "No papers found for this field", "code": "NOT_FOUND"}), 404

    nodes = [dict(r) | {"id": r["paper_id"]} for r in rows]
    graph = {"nodes": nodes, "edges": [], "metadata": {}}
    result = FieldFingerprintAnalyzer().analyze(graph)
    return jsonify(result.to_dict())


@public_api.route("/subscriptions", methods=["POST"])
@require_api_key
def v1_create_subscription():
    """Subscribe to paper events via webhook."""
    data = request.get_json(silent=True) or {}
    paper_id    = data.get("paper_id", "")
    webhook_url = data.get("webhook_url", "")
    events      = data.get("events", [])
    secret      = data.get("secret", "") or Config.WEBHOOK_SIGNING_SECRET or secrets.token_hex(16)

    if not paper_id or not webhook_url:
        return jsonify({"error": "paper_id and webhook_url required", "code": "BAD_REQUEST"}), 400

    valid_events = {"new_citation", "paradigm_shift", "orphan_detected", "gap_filled", "retraction_alert"}
    events = [e for e in events if e in valid_events]
    if not events:
        events = list(valid_events)

    row = db.execute_returning(
        """
        INSERT INTO webhook_subscriptions (user_id, paper_id, webhook_url, events, secret)
        VALUES (%s::uuid, %s, %s, %s, %s)
        RETURNING subscription_id
        """,
        (g.api_user_id, paper_id, webhook_url, events, secret),
    )
    return jsonify({
        "subscription_id": str(row["subscription_id"]),
        "paper_id": paper_id,
        "events": events,
        "webhook_url": webhook_url,
    }), 201


@public_api.route("/subscriptions")
@require_api_key
def v1_list_subscriptions():
    """List active webhook subscriptions."""
    rows = db.fetchall(
        """
        SELECT subscription_id, paper_id, webhook_url, events, active, created_at
        FROM webhook_subscriptions
        WHERE user_id = %s::uuid AND active = TRUE
        ORDER BY created_at DESC
        """,
        (g.api_user_id,),
    )
    return jsonify({
        "subscriptions": [
            {
                "subscription_id": str(r["subscription_id"]),
                "paper_id": r["paper_id"],
                "webhook_url": r["webhook_url"],
                "events": r["events"],
                "active": r["active"],
                "created_at": str(r["created_at"]),
            }
            for r in rows
        ]
    })


@public_api.route("/subscriptions/<sub_id>", methods=["DELETE"])
@require_api_key
def v1_delete_subscription(sub_id):
    """Deactivate a webhook subscription."""
    n = db.execute(
        "UPDATE webhook_subscriptions SET active = FALSE WHERE subscription_id = %s::uuid AND user_id = %s::uuid",
        (sub_id, g.api_user_id),
    )
    if n and n > 0:
        return jsonify({"success": True})
    return jsonify({"error": "Subscription not found", "code": "NOT_FOUND"}), 404


# ── Phase 8 Public API Extensions ─────────────────────────────────────────────


@public_api.route("/researchers/<author_id>/profile")
@require_api_key
def v1_researcher_profile(author_id):
    """Return a researcher profile built from graph data."""
    from backend.researcher_profiles import ResearcherProfileBuilder

    # Find the most recent graph containing this author
    row = db.fetchone(
        """
        SELECT graph_json_url FROM graphs
        WHERE seed_paper_id IS NOT NULL
        ORDER BY computed_at DESC NULLS LAST
        LIMIT 1
        """,
    )
    if not row or not row.get("graph_json_url"):
        return jsonify({"error": "No graph available", "code": "NOT_FOUND"}), 404

    try:
        from backend.r2_client import R2Client
        graph = R2Client().download_json(row["graph_json_url"])
        profile = ResearcherProfileBuilder().build_profile(author_id, graph)
        return jsonify(profile)
    except Exception as exc:
        logger.error(f"v1 researcher profile failed: {exc}")
        return jsonify({"error": str(exc), "code": "PROFILE_ERROR"}), 500


@public_api.route("/literature-review", methods=["POST"])
@require_api_key
def v1_literature_review():
    """Generate a structured literature review from a graph."""
    from backend.literature_review_engine import LiteratureReviewEngine

    data = request.get_json(silent=True) or {}
    paper_id = data.get("paper_id", "")
    if not paper_id:
        return jsonify({"error": "paper_id required", "code": "BAD_REQUEST"}), 400

    row = db.fetchone(
        "SELECT graph_json_url FROM graphs WHERE seed_paper_id = %s ORDER BY computed_at DESC LIMIT 1",
        (paper_id,),
    )
    if not row or not row.get("graph_json_url"):
        return jsonify({"error": "Graph not found", "code": "NOT_FOUND"}), 404

    try:
        from backend.r2_client import R2Client
        graph = R2Client().download_json(row["graph_json_url"])
        result = LiteratureReviewEngine().generate(graph, paper_id)
        return jsonify(result)
    except Exception as exc:
        logger.error(f"v1 literature review failed: {exc}")
        return jsonify({"error": str(exc), "code": "REVIEW_ERROR"}), 500


@public_api.route("/papers/<paper_id>/journalism")
@require_api_key
def v1_paper_journalism(paper_id):
    """Return science journalism analysis for a paper."""
    from backend.science_journalism import ScienceJournalismLayer

    row = db.fetchone(
        "SELECT graph_json_url FROM graphs WHERE seed_paper_id = %s ORDER BY computed_at DESC LIMIT 1",
        (paper_id,),
    )
    if not row or not row.get("graph_json_url"):
        return jsonify({"error": "Graph not found", "code": "NOT_FOUND"}), 404

    try:
        from backend.r2_client import R2Client
        graph = R2Client().download_json(row["graph_json_url"])
        result = ScienceJournalismLayer().analyze(graph, paper_id)
        return jsonify(result.to_dict())
    except Exception as exc:
        logger.error(f"v1 journalism analysis failed: {exc}")
        return jsonify({"error": str(exc), "code": "JOURNALISM_ERROR"}), 500
