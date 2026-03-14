"""
Arivu NLP Worker — FastAPI microservice.
Deployed on HuggingFace Spaces (CPU tier, 16GB RAM).

Phase 1: /health endpoint only. model_loaded = False.
Phase 2: loads SentenceTransformer at startup; adds canonical endpoints.

Authentication (Phase 2+):
  Every request from the Flask app must include:
    Authorization: Bearer {NLP_WORKER_SECRET}
  The worker validates this header and returns HTTP 403 if wrong/missing.
  NLP_WORKER_SECRET must match the value in the Flask app's config.
  Not enforced in Phase 1.

CANONICAL ENDPOINT NAMES — do not change these in Phase 2:
  POST /encode_batch      — encode a batch of texts, returns embeddings list
  POST /similarity_matrix — compute similarity between two sentence sets
  GET  /health            — reachability check, no auth

Do NOT use /embed, /encode, /batch_encode, /similarity, or any other name.
The Flask app's Phase 2 nlp_pipeline.py calls these exact paths.
"""
from fastapi import FastAPI

app = FastAPI(title="Arivu NLP Worker", version="1.0.0")


@app.get("/health")
def health():
    return {
        "status":       "ok",
        "model_loaded": False,  # True after Phase 2 model loading
        "phase":        1,
    }


# TODO: Phase 2 - startup event: load SentenceTransformer("all-MiniLM-L6-v2")
# TODO: Phase 2 - POST /encode_batch      (spec §8.2 for exact request/response shapes)
# TODO: Phase 2 - POST /similarity_matrix (spec §8.2 for exact request/response shapes)
