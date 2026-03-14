# Arivu - Research Paper Intellectual Ancestry Engine

> "What if this paper never existed?"

Arivu (அறிவு - Tamil for "knowledge/wisdom") traces the intellectual DNA of any
research paper: which ideas it inherited, how they mutated across generations,
and what research would collapse if foundational papers were removed from history.

**Status:** Phase 1 - skeleton and schema only. Not yet functional.

## System Prerequisites

These system libraries are required by `python-magic` and `weasyprint`.
Install them before `pip install`:

**Ubuntu/Debian:**
```
sudo apt-get install libmagic1 libpango-1.0-0 libpangoft2-1.0-0 libcairo2 libgdk-pixbuf2.0-0
```

**macOS:**
```
brew install libmagic pango cairo gdk-pixbuf
```

**Windows:** Use the Docker image.

## Quick Start

```
git clone https://github.com/YOUR_USERNAME/arivu.git
cd arivu

# Create virtual environment
python -m venv venv && source venv/bin/activate

# Install dependencies
pip install -r requirements.txt -r requirements-dev.txt

# Start local PostgreSQL with pgvector
docker run -d --name arivu-db \
  -e POSTGRES_DB=arivu \
  -e POSTGRES_USER=arivu \
  -e POSTGRES_PASSWORD=localdev \
  -p 5432:5432 \
  pgvector/pgvector:pg16

# Configure environment
cp .env.example .env
# Edit .env: set FLASK_SECRET_KEY, DATABASE_URL, NLP_WORKER_SECRET

# Apply schema
python scripts/migrate.py

# Run smoke tests (must all pass)
python -m pytest tests/ -v

# Start development server
flask --app "app:create_app()" run --port 5000
```

## Stack

| Component | Technology | Host |
|---|---|---|
| Backend | Flask 3 + Python 3.11 | Koyeb |
| Database | PostgreSQL + pgvector | Neon.tech |
| NLP service | FastAPI + sentence-transformers | HuggingFace Spaces |
| Graph engine | NetworkX | in-process |
| Frontend | Vanilla JS + D3.js v7 + Chart.js | Vercel |
| LLM | Groq (llama-3.1-8b-instant) | Groq Cloud |
| Object storage | Cloudflare R2 | Cloudflare |

## Architecture

```
Browser -------------- Flask (Koyeb)
                            |
                            +-- PostgreSQL (Neon)
                            +-- Cloudflare R2 (graph JSON)
                            +-- NLP Worker (HuggingFace Spaces)
                                    +-- SentenceTransformer
```
