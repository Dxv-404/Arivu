# Arivu - Architecture Decisions Log

Consult this before making any architectural decision not covered in CLAUDE.md.
If you are about to decide something not recorded here, add it first.

## Settled Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Deployment | Koyeb + HuggingFace Spaces + Neon + Cloudflare R2 | See CLAUDE.md §4 |
| 2 | Database | PostgreSQL on Neon.tech - NOT SQLite | Does not pause on free tier; pgvector support |
| 3 | NLP model location | HuggingFace Spaces only - NEVER in Flask app | ~200MB exceeds Koyeb 512MB RAM |
| 4 | Service boundary | Flask owns routes + DB; FastAPI owns NLP model | Clean separation, independent scaling |
| 5 | Graph format | NetworkX DiGraph + export JSON to R2 | Sufficient for n<=600 nodes; no graph DB needed |
| 6 | Frontend | Vanilla JS + D3.js v7 + Chart.js | No build step; CDN-served |
| 7 | LLM | Groq (llama-3.1-8b-instant + llama-3.3-70b-versatile) | Fast inference; free tier |
| 8 | Object storage | Cloudflare R2 | 10GB free; S3-compatible; no egress fees |
| 9 | Sessions | Anonymous sessions (cookie) + optional user account | No login required for core features |
| 10 | Cache TTL | last_accessed NOT created_at on graphs table | A graph used daily stays fresh; idle ones expire |
| 11 | Workers | --workers 2 + DB_POOL_MAX=4 in Phase 4 | 2 workers × 4 = 8 connections ≤ Neon cap 10. Changed atomically in Phase 4 §1.1 |
| 12 | edge_analysis FKs | citing_paper_id + cited_paper_id reference papers(paper_id) | Integrity; orphaned edges not allowed |
| 13 | session_graphs | Separate join table; no FK on graphs.session_id | Anonymous users (no DB row) can view graphs without FK violation |

| 14 | Config pattern | Class-attribute Config (not instance singleton) | Phase 4 §5 — class attributes evaluated at import time; `config = Config` alias for backward compat |
| 15 | NLP worker auth | Dual header: X-API-Key (canonical) + Bearer (legacy) | Phase 4 §0.9 — both WORKER_SECRET and NLP_WORKER_SECRET env vars read |
| 16 | R2 bucket name | arivu-graphs (NOT arivu-data from spec) | User's actual bucket name differs from spec default; spec says arivu-data but user created arivu-graphs |
| 17 | Neon channel_binding | Strip channel_binding=require from URL | psycopg2 doesn't support channel_binding; Neon URL must only have sslmode=require |
| 18 | NLP worker Dockerfile | Flat COPY paths (no nlp_worker/ prefix) | HF Spaces builds from flat repo root; Dockerfile must COPY from . not nlp_worker/ |
| 19 | gallery_index.json path | data/gallery_index.json (root of data/) | Moved from data/precomputed/ in Phase 4 per CLAUDE.md Part 6.4 |

| 20 | Dockerfile Debian Trixie | libgdk-pixbuf-xlib-2.0-0 (NOT libgdk-pixbuf2.0-0) | Package renamed in Debian Trixie; old name causes Koyeb build failure |

## ADR-014: Production database
**Date:** 2026-03-15
**Context:** Needed a hosted PostgreSQL with pgvector support, free tier, no sleep on inactivity.
**Decision:** Neon.tech PostgreSQL 16, AWS ap-southeast-1 Singapore.
**Alternatives considered:** Supabase (more complex free tier), Railway (limited free hours).
**Rationale:** Closest AWS region to India on Neon free tier. 10 connection cap fits 2-worker Koyeb setup (2×4+2=10).
**Implications:** `channel_binding=require` must be stripped from connection string. Locks to 10 connections max on free tier.

## ADR-015: NLP worker hosting
**Date:** 2026-03-15
**Context:** sentence-transformers model is ~200MB — exceeds Koyeb free tier 512MB RAM.
**Decision:** HuggingFace Spaces CPU Basic free tier.
**Alternatives considered:** Koyeb paid tier, Railway.
**Rationale:** Free, always-on CPU with 16GB RAM. Model stays warm after first load. No cost.
**Implications:** 10-15 min cold start on first push. NLP_WORKER_TIMEOUT must be 90s minimum.

## Open Questions
[Add questions here as they arise - resolve and move to Settled before implementing]
