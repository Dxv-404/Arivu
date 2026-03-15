"""
db.py — PostgreSQL connection pool and query helpers.

NEON SSL: Neon.tech requires SSL. _ensure_ssl() appends ?sslmode=require
automatically. psycopg2 silently fails to connect to Neon without it.

POOL SIZING: Neon free tier cap = 10 total connections.
With --workers 1, pool max 8 leaves 2 for scripts. Do not increase
maxconn without first upgrading your Neon plan.

ROLLBACK GUARANTEE: Every helper rolls back on exception and returns the
connection in a clean state. The pool never receives an aborted-transaction
connection.
"""
import logging
from contextlib import contextmanager
from typing import Optional

import psycopg2
import psycopg2.pool
from psycopg2.extras import RealDictCursor

logger = logging.getLogger(__name__)

_pool: Optional[psycopg2.pool.ThreadedConnectionPool] = None


def _ensure_ssl(url: str) -> str:
    """Append sslmode=require if not already present. Required for Neon."""
    if "sslmode" not in url:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}sslmode=require"
    return url


def init_pool(database_url: str, minconn: int = 2, maxconn: int = 8) -> None:
    """Initialize the connection pool. Call once inside create_app()."""
    global _pool
    url = _ensure_ssl(database_url)
    _pool = psycopg2.pool.ThreadedConnectionPool(
        minconn,
        maxconn,
        dsn=url,
        cursor_factory=RealDictCursor,
    )
    logger.info(f"DB pool initialized (min={minconn}, max={maxconn})")


def get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    if _pool is None:
        raise RuntimeError("DB pool not initialized. Call db.init_pool() first.")
    return _pool


@contextmanager
def _get_conn():
    """
    Context manager: acquire a connection from the pool, commit on success,
    rollback + re-raise on any exception, always return to pool.

    Stale connection recovery: if the connection from the pool is closed
    (Neon drops idle connections after ~5 min, Koyeb cold starts lose
    pool state), we discard it and get a fresh one. psycopg2 pools don't
    have built-in test-on-borrow, so we check conn.closed manually.
    """
    pool = get_pool()
    conn = pool.getconn()

    # Detect and recover stale connections
    if conn.closed:
        logger.warning("Stale connection detected — returning to pool and getting fresh one")
        pool.putconn(conn, close=True)
        conn = pool.getconn()

    try:
        yield conn
        conn.commit()
    except psycopg2.OperationalError:
        # Connection died mid-query (network timeout, Neon restart).
        # Close this dead connection so the pool doesn't reuse it.
        try:
            conn.rollback()
        except Exception:
            pass
        pool.putconn(conn, close=True)
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        # Only putconn if we haven't already (OperationalError path closes it)
        if not conn.closed:
            pool.putconn(conn)


def fetchone(sql: str, params: tuple = ()) -> Optional[dict]:
    """Return the first row of a SELECT as a plain dict, or None."""
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
            return dict(row) if row else None


def fetchall(sql: str, params: tuple = ()) -> list[dict]:
    """Return all rows of a SELECT as a list of plain dicts."""
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]


def execute(sql: str, params: tuple = ()) -> int:
    """
    Execute INSERT / UPDATE / DELETE.
    Commits on success, rolls back on exception.
    Returns rowcount.
    """
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.rowcount


def execute_returning(sql: str, params: tuple = ()) -> Optional[dict]:
    """Execute INSERT ... RETURNING and return the first row as a dict."""
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
            return dict(row) if row else None


def executemany(sql: str, params_list: list[tuple]) -> None:
    """Execute a write query for multiple parameter sets (batch insert/update)."""
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.executemany(sql, params_list)


def paginate(
    sql: str, params: tuple = (), page: int = 1, per_page: int = 20
) -> dict:
    """
    Wrap a bare SELECT (no ORDER BY/LIMIT/OFFSET) with pagination.
    Returns: {items: [...], total: int, page: int, pages: int}
    """
    count_sql = f"SELECT COUNT(*) AS count FROM ({sql}) AS _subq"
    total = fetchone(count_sql, params)["count"]
    items = fetchall(f"{sql} LIMIT %s OFFSET %s", params + (per_page, (page - 1) * per_page))
    return {
        "items": items,
        "total": total,
        "page": page,
        "pages": (total + per_page - 1) // per_page,
    }


def health_check() -> bool:
    """
    Return True if the DB is reachable.
    Called by /health. Must NEVER raise — catches all exceptions.
    """
    try:
        row = fetchone("SELECT 1 AS ok")
        return row is not None and row.get("ok") == 1
    except Exception as exc:
        logger.error(f"DB health check failed: {exc}")
        return False
