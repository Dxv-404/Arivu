#!/usr/bin/env python3
"""
scripts/load_retraction_watch.py
REPLACES Phase 5 version.

Downloads and loads the Retraction Watch database into PostgreSQL.
Primary source: Retraction Watch CSV (requires registration at retractionwatch.com).
Fallback: CrossRef retraction data via public API.

Run: python scripts/load_retraction_watch.py
Schedule: Koyeb cron — weekly (Sunday 04:00 UTC): 0 4 * * 0
"""
import csv, io, logging, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def run():
    from dotenv import load_dotenv
    load_dotenv()
    import backend.db as db
    from backend.config import Config
    db.init_pool(database_url=Config.DATABASE_URL)

    csv_url = Config.RETRACTION_WATCH_CSV_URL
    if not csv_url:
        logger.warning(
            "RETRACTION_WATCH_CSV_URL not set. Register at retractionwatch.com to get "
            "the CSV download URL, then set this env var. Attempting CrossRef fallback."
        )
        _load_from_crossref(db)
        return

    logger.info("Downloading Retraction Watch data from configured URL...")
    try:
        import httpx
        resp = httpx.get(csv_url, follow_redirects=True, timeout=120.0)
        resp.raise_for_status()
        csv_content = resp.text
        _load_csv(db, csv_content)
    except Exception as exc:
        logger.error(f"Download failed: {exc}. Trying CrossRef fallback.")
        _load_from_crossref(db)


def _load_csv(db, csv_content: str):
    inserted = 0
    updated  = 0
    reader   = csv.DictReader(io.StringIO(csv_content))

    for row in reader:
        doi    = (row.get("DOI") or row.get("doi") or "").strip().lower()
        title  = (row.get("Title") or row.get("title") or "")[:500]
        journal = (row.get("Journal") or row.get("journal") or "")[:300]
        date   = (row.get("RetractionDate") or row.get("retraction_date") or "")[:20]
        reason = (row.get("Reason") or row.get("reason") or "")[:500]

        if not doi and not title:
            continue

        try:
            db.execute(
                """
                INSERT INTO retraction_watch (doi, title, journal, retraction_date, reason)
                VALUES (%s, %s, %s, %s::date, %s)
                ON CONFLICT (doi) DO UPDATE
                SET title=EXCLUDED.title, journal=EXCLUDED.journal,
                    retraction_date=EXCLUDED.retraction_date, reason=EXCLUDED.reason
                """,
                (doi or title[:100], title, journal, date or None, reason),
            )
            inserted += 1
            if doi:
                db.execute(
                    """
                    UPDATE papers SET is_retracted = TRUE, retraction_reason = %s
                    WHERE doi = %s AND (is_retracted IS NULL OR is_retracted = FALSE)
                    """,
                    (reason[:200], doi),
                )
                updated += 1
        except Exception as exc:
            logger.warning(f"Row insert failed (doi={doi}): {exc}")

    logger.info(f"Retraction Watch load complete: {inserted} records upserted, {updated} papers flagged.")


def _load_from_crossref(db):
    """CrossRef fallback: fetch retraction notices via their public API."""
    import httpx
    logger.info("Loading retraction data from CrossRef API (fallback)...")
    inserted = 0
    try:
        resp = httpx.get(
            "https://api.crossref.org/works",
            params={"filter": "type:journal-article,update-type:retraction", "rows": "1000"},
            headers={"User-Agent": "Arivu Research Platform (contact: admin@arivu.app)"},
            timeout=30.0,
        )
        resp.raise_for_status()
        items = resp.json().get("message", {}).get("items", [])
        for item in items:
            doi    = (item.get("DOI") or "").lower()
            title  = " ".join(item.get("title", [""]))[:500]
            if not doi:
                continue
            try:
                db.execute(
                    """
                    INSERT INTO retraction_watch (doi, title, reason)
                    VALUES (%s, %s, 'Retraction notice via CrossRef')
                    ON CONFLICT (doi) DO NOTHING
                    """,
                    (doi, title),
                )
                inserted += 1
            except Exception:
                pass
    except Exception as exc:
        logger.error(f"CrossRef fallback also failed: {exc}")
    logger.info(f"CrossRef fallback: {inserted} retraction records loaded.")


if __name__ == "__main__":
    run()
