"""
nlp_worker/app.py — NLP microservice for Arivu.

Deployed on HuggingFace Spaces (free CPU tier, persistent).
Main API calls this over HTTP — the model NEVER loads on the main server.

Auth: Every request (except /health) must include:
    Authorization: Bearer {NLP_WORKER_SECRET}
The secret is stored as a HuggingFace Space secret and in .env locally.

Endpoints:
    POST /encode_batch       — encode a batch of texts to embeddings
    POST /similarity_matrix  — compute sentence-pair similarity matrix
    GET  /health             — no auth required
"""
import os
import time
import logging
from functools import wraps

import numpy as np
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Arivu NLP Worker", version="1.0.0")

# ─── Model — loaded once at startup ──────────────────────────────────────────
# all-MiniLM-L6-v2: 22M params, 384-dim output, fast on CPU.
# Load time: ~3-5 seconds. Stays resident in memory.
logger.info("Loading SentenceTransformer model...")
_start = time.time()
MODEL = SentenceTransformer("all-MiniLM-L6-v2")
logger.info(f"Model loaded in {time.time() - _start:.1f}s")

# ─── Auth ─────────────────────────────────────────────────────────────────────
# Phase 4 backport §0.9: supports both env var names and both header formats.
WORKER_SECRET = (
    os.environ.get("WORKER_SECRET", "")
    or os.environ.get("NLP_WORKER_SECRET", "")
)


def require_auth(f):
    """
    Decorator: validate X-API-Key or Bearer token matches WORKER_SECRET.

    NOTE: FastAPI uses dependency injection (Depends) rather than decorators
    for request-level auth. This decorator is retained for documentation and
    non-FastAPI testing purposes. Protected endpoints use _auth_dependency
    (a Depends-compatible equivalent) which enforces the same logic via
    FastAPI's DI system. See _auth_dependency below.
    """
    @wraps(f)
    async def wrapper(request: Request, *args, **kwargs):
        if WORKER_SECRET:
            token = request.headers.get("X-API-Key", "")
            if not token:
                auth = request.headers.get("Authorization", "")
                token = auth.removeprefix("Bearer ").strip()
            if token != WORKER_SECRET:
                raise HTTPException(status_code=401, detail="Invalid worker secret")
        return await f(request, *args, **kwargs)
    return wrapper


async def _auth_dependency(request: Request) -> None:
    """
    FastAPI dependency: accept X-API-Key (Phase 4 canonical) or
    Authorization: Bearer (Phase 2 legacy).
    Applied to all endpoints except /health via Depends(_auth_dependency).
    Raises HTTP 401 if WORKER_SECRET is set and token does not match.
    """
    if not WORKER_SECRET:
        return
    token = request.headers.get("X-API-Key", "")
    if not token:
        auth = request.headers.get("Authorization", "")
        token = auth.removeprefix("Bearer ").strip()
    if token != WORKER_SECRET:
        raise HTTPException(status_code=401, detail="Invalid worker secret")


# ─── Request / Response models ────────────────────────────────────────────────

class EncodeBatchRequest(BaseModel):
    texts: list[str]          # Up to 512 texts per call
    normalize: bool = True    # L2-normalize embeddings (required for cosine sim)


class SimilarityMatrixRequest(BaseModel):
    texts_a: list[str]        # Sentences from paper A (citing)
    texts_b: list[str]        # Sentences from paper B (cited)


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    """Health check — no auth required. Called by main app on startup."""
    return {
        "status": "ok",
        "model": "all-MiniLM-L6-v2",
        "dimensions": 384,
    }


@app.post("/encode_batch")
async def encode_batch(
    body: EncodeBatchRequest,
    _auth: None = Depends(_auth_dependency),
):
    """
    Encode a batch of texts. Returns embeddings as list[list[float]].

    Limits:
        Max 512 texts per call.
        Each text is truncated to 256 tokens by the model (SentenceTransformer default).

    Performance (CPU):
        ~3000 sentences (300 papers x 10 sentences) in ~60 seconds.
        Split large batches into 512-chunk calls.
    """
    if not body.texts:
        return {"embeddings": [], "model": "all-MiniLM-L6-v2", "dimensions": 384}

    if len(body.texts) > 512:
        raise HTTPException(
            status_code=400,
            detail=f"Max 512 texts per batch. Received {len(body.texts)}."
        )

    try:
        t0 = time.time()
        embeddings = MODEL.encode(
            body.texts,
            normalize_embeddings=body.normalize,
            batch_size=64,
            show_progress_bar=False,
        )
        elapsed = time.time() - t0
        logger.info(f"encode_batch: {len(body.texts)} texts in {elapsed:.2f}s")

        return {
            "embeddings": embeddings.tolist(),
            "model": "all-MiniLM-L6-v2",
            "dimensions": 384,
            "count": len(body.texts),
        }
    except Exception as e:
        logger.error(f"encode_batch error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Encoding failed: {str(e)}")


@app.post("/similarity_matrix")
async def similarity_matrix(
    body: SimilarityMatrixRequest,
    _auth: None = Depends(_auth_dependency),
):
    """
    Compute pairwise cosine similarity between two sentence lists.

    Returns the full matrix plus the highest-scoring pair — used by
    InheritanceDetector.stage1_similarity() to find the best-matching
    sentence pair between a citing and cited paper.

    Both lists are capped at 50 sentences (enforced server-side).
    """
    if not body.texts_a or not body.texts_b:
        raise HTTPException(status_code=400, detail="Both texts_a and texts_b must be non-empty")

    # Server-side cap: 50 x 50 max matrix
    a = body.texts_a[:50]
    b = body.texts_b[:50]

    try:
        emb_a = MODEL.encode(a, normalize_embeddings=True, show_progress_bar=False)
        emb_b = MODEL.encode(b, normalize_embeddings=True, show_progress_bar=False)

        # Matrix multiplication gives cosine similarity when both are L2-normalized
        matrix = (emb_a @ emb_b.T).tolist()

        # Find maximum pair
        best_score = -1.0
        best_i, best_j = 0, 0
        for i, row in enumerate(matrix):
            for j, score in enumerate(row):
                if score > best_score:
                    best_score = score
                    best_i, best_j = i, j

        return {
            "matrix": matrix,
            "max_pair": {
                "idx_a": best_i,
                "idx_b": best_j,
                "score": float(best_score),
                "sentence_a": a[best_i],
                "sentence_b": b[best_j],
            },
            "shape": [len(a), len(b)],
        }
    except Exception as e:
        logger.error(f"similarity_matrix error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Similarity computation failed: {str(e)}")


# ─── Error handler ────────────────────────────────────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception in NLP worker: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": "internal_error", "detail": str(exc)},
    )
