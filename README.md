# Arivu

**Research intelligence platform** — traces the intellectual ancestry of any academic paper,
revealing what ideas it inherited, which papers are critical to the field's survival, and where
the white space lies for future research.

> "Citation graphs show structure. Arivu reveals meaning."

## Quick Start

```bash
# 1. Clone and setup
git clone https://github.com/YOUR_REPO/arivu
cd arivu
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt
pip install -r requirements-dev.txt

# 3. Set up environment
cp .env.example .env
# Edit .env with your API keys (S2, OpenAlex, Groq, etc.)

# 4. Start database
docker run -d --name arivu-db \
  -e POSTGRES_DB=arivu \
  -e POSTGRES_USER=arivu \
  -e POSTGRES_PASSWORD=localdev \
  -p 5432:5432 \
  pgvector/pgvector:pg16

# 5. Run migrations
python scripts/migrate.py
python scripts/migrate_phase6.py
python scripts/migrate_phase7.py
python scripts/migrate_phase8.py

# 6. Start NLP worker (in a separate terminal)
cd nlp_worker
uvicorn app:app --host 0.0.0.0 --port 7860

# 7. Start Flask app
flask run  # or: gunicorn -w 1 app:app

# 8. Precompute gallery
python scripts/precompute_gallery.py

# 9. Open http://localhost:5000
```

## System Prerequisites

These system libraries are required by `python-magic` and `weasyprint`:

**Ubuntu/Debian:**
```
sudo apt-get install libmagic1 libpango-1.0-0 libpangoft2-1.0-0 libcairo2 libgdk-pixbuf2.0-0
```

**macOS:**
```
brew install libmagic pango cairo gdk-pixbuf
```

**Windows:** Use the Docker image.

## Features

- **Ancestral Trace** — Interactive citation graph showing a paper's complete intellectual lineage
- **Cascading Pruning** — Remove a paper and watch the field collapse in real-time, revealing critical bottlenecks
- **DNA Profile** — Consensus clustering of the field's core methodology and its variations
- **Diversity Radar** — 4D visualization of field diversity (author concentration, methodology spread, venue breadth, interdisciplinarity)
- **Research Gaps** — pgvector-powered semantic search for unexplored intersections
- **Field Fingerprint** — Domain-specific analysis of field identity and evolution
- **Temporal Intelligence** — Time Machine view of how the field evolved year by year
- **Trust Layer** — Confidence badges, evidence trails, and disagreement flags on every analytical output
- **Live Mode** — Real-time alerts for new papers citing your research, paradigm shifts, and weekly digests
- **Researcher Profiles** — Track author influence and collaborations across time
- **Science Journalism Layer** — Translate research findings to plain language for public audiences

## Technology Stack

| Component | Technology | Host |
|---|---|---|
| Backend | Flask 3 + Python 3.11 | Koyeb |
| Database | PostgreSQL + pgvector | Neon.tech |
| NLP service | FastAPI + sentence-transformers | HuggingFace Spaces |
| Graph engine | NetworkX | in-process |
| Frontend | Vanilla JS + D3.js v7 + Chart.js | static |
| LLM | Groq (llama-3.1-8b / llama-3.3-70b) | Groq Cloud |
| Object storage | Cloudflare R2 | Cloudflare |

## Architecture

```
Browser -------------- Flask (Koyeb)
                            |
                            +-- PostgreSQL + pgvector (Neon)
                            +-- Cloudflare R2 (graph JSON, exports)
                            +-- NLP Worker (HuggingFace Spaces)
                            |       +-- SentenceTransformer (all-MiniLM-L6-v2)
                            +-- Groq LLM API (classification, insights)
```

## Environment Variables

See `.env.example` for all required variables.

## Development

```bash
# Run tests
python -m pytest tests/ -v

# Ground truth evaluation (NLP accuracy)
python scripts/ground_truth_eval.py

# Benchmark build pipeline
python scripts/benchmark_nlp.py

# Precompute gallery
python scripts/precompute_gallery.py

# Load Retraction Watch data
python scripts/load_retraction_watch.py
```

## License

MIT License — see LICENSE file.

## Author

Built by Dev. Tamil: அறிவு (Arivu) = knowledge, wisdom.
