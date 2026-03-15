---
title: Arivu NLP Worker
emoji: 🧠
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
---

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

## HuggingFace Spaces deployment

1. Create a new Space at huggingface.co/new-space -> SDK: Docker
2. Push `nlp_worker/app.py`, `nlp_worker/requirements.txt`,
   `nlp_worker/Dockerfile`, `nlp_worker/README.md` to the Space repo
3. Add Space secret: `WORKER_SECRET` = same value as in your
   production environment (also accepts `NLP_WORKER_SECRET` as fallback)
4. Copy the Space URL to `NLP_WORKER_URL` in your production environment

## Endpoints

| Endpoint | Method | Auth required | Phase |
|---|---|---|---|
| `/health` | GET | No | 1 |
| `/encode_batch` | POST | X-API-Key or Authorization: Bearer | 2 |
| `/similarity_matrix` | POST | X-API-Key or Authorization: Bearer | 2 |
