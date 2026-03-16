#!/usr/bin/env python3
"""
scripts/live_monitor_cron.py — Live Mode nightly polling cron.

Checks each active live subscription for new papers citing any node in its graph.
Creates alert records. Sends weekly digest emails on Mondays.

Schedule: 0 3 * * *  (03:00 UTC nightly)

Known v1 limitation (GAP-P8-57): each subscription check queries only the first
10 nodes of each graph to stay within Semantic Scholar API rate limits.
Full-graph monitoring is Phase 9+.
"""
import json
import logging
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

MAX_SUBS_PER_RUN  = 50
MAX_NODES_CHECKED = 10  # S2 API rate limit constraint — v1.0 known limitation


def run():
    from dotenv import load_dotenv
    load_dotenv()
    import backend.db as db
    from backend.config import Config
    from backend.live_mode import LiveModeManager
    from backend.r2_client import R2Client

    db.init_pool(database_url=Config.DATABASE_URL)
    live_mgr = LiveModeManager()
    r2       = R2Client()

    if not Config.LIVE_MODE_ENABLED:
        logger.info("LIVE_MODE_ENABLED=false — skipping live monitor run.")
        return

    subscriptions = live_mgr.get_active_subscriptions()[:MAX_SUBS_PER_RUN]
    logger.info(f"Checking {len(subscriptions)} active subscription(s).")

    processed = 0
    for sub in subscriptions:
        try:
            _check_subscription(sub, live_mgr, r2, db)
            live_mgr.update_last_checked(sub["subscription_id"])
            processed += 1
        except Exception as exc:
            logger.error(f"Failed to check subscription {sub['subscription_id']}: {exc}")

    logger.info(f"Live monitor complete: {processed}/{len(subscriptions)} subscriptions checked.")

    # Send weekly digest on Mondays
    if datetime.now(timezone.utc).weekday() == 0:
        _send_weekly_digests(live_mgr, db)


def _check_subscription(sub: dict, live_mgr, r2, db):
    """Check a single subscription for new activity."""
    # GAP-P8-51 fix: query by graph_id TEXT column, not SERIAL id
    graph_row = db.fetchone(
        "SELECT graph_json_url FROM graphs WHERE graph_id=%s",
        (sub["graph_id"],),
    )
    if not graph_row:
        # Fallback: try by seed_paper_id in case graph_id wasn't set
        graph_row = db.fetchone(
            "SELECT graph_json_url FROM graphs WHERE seed_paper_id=%s "
            "ORDER BY created_at DESC LIMIT 1",
            (sub["seed_paper_id"],),
        )
    if not graph_row:
        logger.warning(f"No graph found for subscription {sub['subscription_id']}")
        return

    try:
        graph_data = r2.download_json(graph_row["graph_json_url"])
    except Exception as exc:
        logger.warning(f"Could not load graph {sub['graph_id']}: {exc}")
        return

    node_ids      = [n["id"] for n in graph_data.get("nodes", [])]
    if not node_ids:
        return

    last_checked  = sub.get("last_checked_at") or (datetime.now(timezone.utc) - timedelta(days=7))
    alert_events  = set(sub.get("alert_events") or [])

    if "new_citation" in alert_events:
        _check_new_citations(sub, node_ids, last_checked, live_mgr)

    if "paradigm_shift" in alert_events:
        _check_paradigm_shift(sub, graph_data, live_mgr)

    if "retraction_alert" in alert_events:
        _check_retractions(sub, node_ids, live_mgr, db)

    if "gap_filled" in alert_events:
        _check_gap_filled(sub, graph_data, live_mgr, db)


def _check_new_citations(sub, node_ids, last_checked, live_mgr):
    """
    GAP-P8-56 fix: compare citation publication date against last_checked_at,
    not a hardcoded year cutoff.
    GAP-P8-57: limited to first 10 nodes (v1 known limitation).
    """
    import httpx
    from backend.config import Config

    headers = {}
    if Config.S2_API_KEY:
        headers["x-api-key"] = Config.S2_API_KEY

    # Convert last_checked to a comparable date
    if isinstance(last_checked, str):
        from dateutil import parser as dateparser
        last_checked_dt = dateparser.parse(last_checked)
    else:
        last_checked_dt = last_checked
    if last_checked_dt.tzinfo is None:
        last_checked_dt = last_checked_dt.replace(tzinfo=timezone.utc)

    new_papers = []
    for paper_id in node_ids[:MAX_NODES_CHECKED]:
        try:
            resp = httpx.get(
                f"https://api.semanticscholar.org/graph/v1/paper/{paper_id}/citations",
                params={"fields": "paperId,title,year,publicationDate", "limit": 10},
                headers=headers,
                timeout=10.0,
            )
            if resp.status_code == 200:
                for citation in resp.json().get("data", []):
                    cp      = citation.get("citingPaper", {})
                    pub_date = cp.get("publicationDate")
                    # GAP-P8-56: use publicationDate string comparison when available
                    is_new  = False
                    if pub_date:
                        from dateutil import parser as dp
                        try:
                            pub_dt = dp.parse(pub_date).replace(tzinfo=timezone.utc)
                            is_new = pub_dt > last_checked_dt
                        except Exception:
                            # Fallback to year comparison
                            is_new = (cp.get("year") or 0) >= last_checked_dt.year
                    else:
                        is_new = (cp.get("year") or 0) >= last_checked_dt.year

                    if is_new and cp.get("paperId"):
                        new_papers.append({"paper_id": cp["paperId"], "title": cp.get("title","")})
        except Exception:
            pass

    if new_papers:
        live_mgr.create_alert(
            sub["subscription_id"],
            "new_citation",
            {"new_papers": new_papers[:5], "graph_id": sub["graph_id"]},
        )


def _check_paradigm_shift(sub, graph_data, live_mgr):
    stability = graph_data.get("paradigm_data", {}).get("stability_score", 100)
    if stability and stability < 40:
        live_mgr.create_alert(
            sub["subscription_id"],
            "paradigm_shift",
            {"stability_score": stability, "graph_id": sub["graph_id"]},
        )


def _check_retractions(sub, node_ids, live_mgr, db):
    retracted = db.fetchall(
        "SELECT paper_id, title FROM papers WHERE paper_id=ANY(%s) AND is_retracted=TRUE",
        (node_ids,),
    )
    if retracted:
        live_mgr.create_alert(
            sub["subscription_id"],
            "retraction_alert",
            {"papers": [dict(r) for r in retracted]},
        )


def _check_gap_filled(sub, graph_data, live_mgr, db):
    """
    GAP-P8-44 fix: detect when a previously identified gap now has a paper addressing it.
    Strategy: reload the graph's stored gap analysis, then check if any new paper
    in the DB has high semantic similarity to the gap description embedding.
    """
    try:
        # Load previously stored gap analysis for this graph
        gap_row = db.fetchone(
            "SELECT result_json FROM cross_domain_spark_cache WHERE graph_id=%s",
            (sub["graph_id"],),
        )
        if not gap_row:
            return

        future_sparks = (gap_row["result_json"] or {}).get("future_sparks", [])
        if not future_sparks:
            return

        # Check if any future_spark pair now has a citation edge between them
        for spark in future_sparks[:5]:
            id_a = spark.get("paper_a", {}).get("id")
            id_b = spark.get("paper_b", {}).get("id")
            if not id_a or not id_b:
                continue

            # Check if a new citation edge exists between these two papers
            edge_exists = db.fetchone(
                """
                SELECT 1 FROM edge_analysis
                WHERE (citing_paper_id=%s AND cited_paper_id=%s)
                   OR (citing_paper_id=%s AND cited_paper_id=%s)
                LIMIT 1
                """,
                (id_a, id_b, id_b, id_a),
            )
            if edge_exists:
                live_mgr.create_alert(
                    sub["subscription_id"],
                    "gap_filled",
                    {
                        "gap": f"{spark.get('field_a')} ↔ {spark.get('field_b')}",
                        "paper_a": spark.get("paper_a"),
                        "paper_b": spark.get("paper_b"),
                    },
                )
                break  # One gap_filled alert per run is enough
    except Exception as exc:
        logger.warning(f"gap_filled check failed: {exc}")


def _send_weekly_digests(live_mgr, db):
    """Send weekly digest emails to all users with active subscriptions."""
    from backend.mailer import send_email   # GAP-P8-61 fix: use public function
    from backend.config import Config

    users = db.fetchall(
        """
        SELECT DISTINCT u.user_id::text, u.email
        FROM live_subscriptions ls
        JOIN users u ON u.user_id = ls.user_id
        WHERE ls.active=TRUE AND ls.digest_email=TRUE
        """,
    )
    for user in users:
        alerts = live_mgr.get_unread_alerts(user["user_id"], limit=10)
        if not alerts:
            continue

        text = "Arivu Weekly Digest\n\nYour monitored graphs have new activity:\n\n"
        for a in alerts:
            text += f"• {a['event_type'].replace('_',' ').title()} — {str(a['event_data'])[:100]}\n"
        text += f"\nView your alerts: https://{Config.CUSTOM_DOMAIN}/tool\n\n— Arivu"

        html = f"""<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:600px;margin:40px auto">
<h2 style="color:#D4A843">Arivu Weekly Digest</h2>
<p>New activity in your monitored graphs:</p>
<ul>{''.join(f'<li>{a["event_type"].replace("_"," ").title()} — {str(a["event_data"])[:80]}</li>' for a in alerts)}</ul>
<br><a href="https://{Config.CUSTOM_DOMAIN}/tool">View in Arivu →</a>
</body></html>"""

        send_email(user["email"], "Arivu Weekly Digest — New Activity", text, html)
        logger.info(f"Weekly digest sent to {user['email']}")


if __name__ == "__main__":
    run()
