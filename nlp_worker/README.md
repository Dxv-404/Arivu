# Arivu NLP Worker

FastAPI microservice for sentence embedding and similarity computation.
Deployed separately on HuggingFace Spaces (free CPU tier, 16GB RAM).

## Why separate?

The SentenceTransformer model (~200MB) exceeds the 512MB RAM limit on the
main Koyeb server. Separating it also keeps the Flask app free of
torch/CUDA dependencies.

## Local development

```
cd nlp_worker
pip install -r requirements.txt
uvicorn app:app --reload --port 7860
```

Set `NLP_WORKER_URL=http://localhost:7860` in your root `.env`.

## HuggingFace Spaces deployment (Phase 6)

1. Create a new Space at huggingface.co/new-space -> SDK: Docker
2. Upload `nlp_worker/app.py`, `nlp_worker/requirements.txt`,
   `nlp_worker/Dockerfile`
3. Add Space secret: `NLP_WORKER_SECRET` = same value as in your
   production environment
4. Copy the Space URL to `NLP_WORKER_URL` in your production environment

## Endpoints

| Endpoint | Method | Auth required | Phase |
|---|---|---|---|
| `/health` | GET | No | 1 |
| `/encode_batch` | POST | Authorization: Bearer {NLP_WORKER_SECRET} | 2 |
| `/similarity_matrix` | POST | Authorization: Bearer {NLP_WORKER_SECRET} | 2 |
