#!/usr/bin/env python3
"""
scripts/load_retraction_watch.py

Load Retraction Watch database CSV into the retraction_watch table.

Download the CSV from:
  https://api.labs.crossref.org/data/retractionwatch
  (Free registration required at retractionwatch.com)

Usage:
  RETRACTION_CSV=data/retractions.csv python scripts/load_retraction_watch.py

The CSV has these relevant columns:
  DOI, Title, Journal, RetractionDate, Reason, OriginalPaperDOI

Run time: ~2 minutes for the full ~50,000 record database.
Safe to re-run — uses ON CONFLICT DO UPDATE.

NOTE: data/retractions.csv is gitignored (~150MB). Download it separately.
"""
import csv
import os
import sys
import logging
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

CSV_PATH = os.environ.get("RETRACTION_CSV", "data/retractions.csv")


def load():
    from dotenv import load_dotenv
    load_dotenv()

    import backend.db as db
    from backend.config import Config

    db.init_pool(database_url=Config.DATABASE_URL)

    csv_path = Path(CSV_PATH)
    if not csv_path.exists():
        logger.error(
            f"CSV not found at {csv_path}. "
            "Download from https://api.labs.crossref.org/data/retractionwatch"
        )
        sys.exit(1)

    # Ensure table uses correct Phase 1 DDL name: retraction_watch (not retractions)
    db.execute("""
        CREATE TABLE IF NOT EXISTS retraction_watch (
            doi             TEXT        PRIMARY KEY,
            title           TEXT,
            journal         TEXT,
            retraction_date DATE,
            reason          TEXT
        );
    """)

    count       = 0
    skipped     = 0
    error_count = 0

    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            doi = (row.get("OriginalPaperDOI") or row.get("DOI") or "").strip().lower()
            if not doi or doi == "unavailable":
                skipped += 1
                continue

            raw_date = row.get("RetractionDate", "").strip()
            date_val = None
            if raw_date:
                for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%d/%m/%Y"):
                    try:
                        from datetime import datetime
                        date_val = datetime.strptime(raw_date[:10], fmt).date()
                        break
                    except ValueError:
                        continue

            try:
                db.execute(
                    """
                    INSERT INTO retraction_watch (doi, title, journal, retraction_date, reason)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (doi) DO UPDATE SET
                        title           = EXCLUDED.title,
                        journal         = EXCLUDED.journal,
                        retraction_date = EXCLUDED.retraction_date,
                        reason          = EXCLUDED.reason
                    """,
                    (
                        doi,
                        (row.get("Title") or "").strip()[:500],
                        (row.get("Journal") or "").strip()[:200],
                        date_val,
                        (row.get("Reason") or "").strip()[:1000],
                    ),
                )
                count += 1
                if count % 1000 == 0:
                    logger.info(f"  Loaded {count} records...")
            except Exception as exc:
                error_count += 1
                if error_count <= 5:
                    logger.warning(f"Row error (doi={doi!r}): {exc}")
                if error_count > 5 and error_count % 100 == 0:
                    logger.warning(f"  {error_count} total row errors so far")

    logger.info(
        f"Done. Loaded {count} retractions. "
        f"Skipped {skipped} (no DOI). Errors: {error_count}."
    )

    if error_count > count * 0.5 and count > 0:
        logger.warning(
            "High error rate detected. The CSV format may have changed. "
            "Print reader.fieldnames at the top of the loop to see actual column names."
        )

    try:
        updated = db.execute(
            """
            UPDATE papers
            SET is_retracted = TRUE
            WHERE doi IN (SELECT doi FROM retraction_watch)
            AND (is_retracted IS NULL OR is_retracted = FALSE)
            """
        )
        logger.info(f"  Flagged {updated} papers in papers table as retracted.")
    except Exception as exc:
        logger.warning(f"Could not flag papers as retracted: {exc}")


if __name__ == "__main__":
    load()
