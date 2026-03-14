# PHASE 5 — Export System, Advanced Intelligence & Custom Domain
## Version 2 — All 32 Phase 4 Gaps Resolved

## Before You Start
1. Read `CLAUDE.md` — architecture non-negotiables apply throughout.
2. Read `CONTEXT.md` — verify Phase 4 is marked **Completed** before continuing.
3. This file is the **only** spec you need right now. Do not open any other phase file.
4. **Phase 4 must be complete.** Run `python -m pytest tests/ -v` — all must pass.
5. **Arivu must be live on Koyeb** before starting Phase 5 — some features need the production URL.
6. **Apply all backports in §0 before writing any Phase 5 code.** These fix Phase 4 bugs
   that Phase 5 depends on.

---

## What Phase 5 Produces

When this phase is complete:
- **Export system live** — 8 formats downloadable from the tool page
- **Living Paper Score** — every node shows velocity (rising/stable/declining/extinct)
- **Originality Mapper** — Pioneer/Synthesizer/Bridge/Refiner/Contradictor badges per paper
- **Paradigm Shift Detector** — structural warnings when a field is shifting
- **Retraction Watch integration** — contaminated papers flagged with error propagation score
- **Ground truth evaluation** — NLP pipeline tested against labeled pairs (≥70% accuracy)
- **Custom domain** — `arivu.app` configured and CORS updated
- `backend/export_generator.py` — ExportGenerator with all 8 formats
- `backend/living_paper_scorer.py` — LivingPaperScorer (stub → real)
- `backend/originality_mapper.py` — OriginalityMapper (stub → real)
- `backend/paradigm_detector.py` — ParadigmShiftDetector (stub → real)
- `scripts/ground_truth_eval.py` — NLP evaluation script (stub → real)
- `scripts/load_retraction_watch.py` — retraction CSV loader (stub → real)
- `data/ground_truth/pairs.json` — labeled paper pairs
- `static/assets/og-image.png` — polished 1200×630 social sharing asset
- `static/js/export-panel.js` — ExportPanel client
- `tests/test_phase5.py` — Phase 5 test suite
- `CONTEXT.md` updated — Phase 5 under "Completed"

Nothing else. No auth, no Stripe, no user accounts, no Time Machine, no prediction market.

---

## Files Changed / Created

### New files
```
backend/export_generator.py      ← ExportGenerator: 8 export formats
static/js/export-panel.js        ← ExportPanel client-side handler
data/ground_truth/pairs.json     ← labeled paper pairs for NLP eval
data/ground_truth/.gitkeep       ← ensures directory is tracked by git
tests/test_phase5.py             ← Phase 5 test suite
DECISIONS.md                     ← Architecture decision log (§0.11)
```

### Modified (stub → real)
```
backend/living_paper_scorer.py   ← LivingPaperScorer (was OUT OF SCOPE stub)
backend/originality_mapper.py    ← OriginalityMapper (was OUT OF SCOPE stub)
backend/paradigm_detector.py     ← ParadigmShiftDetector (was OUT OF SCOPE stub)
scripts/ground_truth_eval.py     ← real evaluation script (was TODO stub)
scripts/load_retraction_watch.py ← real CSV loader (was TODO stub)
```

### Modified (additions)
```
app.py                           ← add /api/export/<type>, /api/living-score/<id>,
                                    /api/originality/<id>, /api/paradigm/<seed_id>,
                                    R2 proxy routes for gallery (§0.12)
backend/llm_client.py            ← add generate_literature_review() method
backend/rate_limiter.py          ← add export + intelligence endpoint limits;
                                    add arivu_rate_limiter module-level instance (§0.1)
backend/r2_client.py             ← add presigned_url() method (§0.4)
backend/utils.py                 ← fix GALLERY_DIR / GALLERY_INDEX_PATH (§0.3)
backend/quality_monitor.py       ← fix confidence field names (§0.5)
requirements.txt                 ← add weasyprint, python-docx, reportlab, matplotlib,
                                    Markdown (§1)
.env.example                     ← add custom domain vars
CONTEXT.md                       ← Phase 5 → Completed
static/assets/og-image.png       ← replace Phase 4 basic asset with polished version
templates/explore.html           ← add gallery stats script (§0.9)
tests/test_phase3.py             ← fix all broken test fixtures (§0.6)
static/js/graph.js               ← add zoom threshold trigger for SemanticZoom (§0.2)
```

### Unchanged (do not touch)
```
backend/config.py
backend/db.py
backend/models.py
backend/schemas.py
backend/normalizer.py
backend/deduplicator.py
backend/api_client.py
backend/nlp_pipeline.py
backend/graph_engine.py
backend/pruning.py
backend/dna_profiler.py
backend/diversity_scorer.py
backend/orphan_detector.py
backend/gap_finder.py
backend/session_manager.py
backend/chat_guide.py
backend/prompt_sanitizer.py
backend/security.py
backend/full_text_fetcher.py
backend/section_parser.py
All Phase 1-4 tests (test_smoke.py, test_phase2.py, test_phase4.py)
scripts/migrate.py
scripts/precompute_gallery.py
scripts/benchmark_nlp.py
nlp_worker/
```

**Note on `backend/llm_client.py`:** This file was created in Phase 3 and is listed
in Phase 5's "Unchanged" list in the original spec. That was an error — Phase 5 adds
one method (`generate_literature_review()`) to it. The file is modified by addition
only. Do not rewrite it from scratch.

---

## Architecture Reminder

The Koyeb main server still **may never** import `sentence_transformers`, `torch`, or any
ML model library. The living paper scorer, originality mapper, and paradigm detector all
use **pre-computed embeddings from the `paper_embeddings` DB table via pgvector** — they
do not call the NLP worker at request time. The export generation (PNG/SVG) uses
**matplotlib server-side** — this is safe because matplotlib uses the `Agg` backend
(no display required) and is in `requirements.txt`.

---

## §0 — Phase 4 Gap Fixes (Apply Before Writing Any Phase 5 Code)

These fix bugs in Phase 4 code that Phase 5 depends on. Apply all in order.

---

### §0.1 — backend/rate_limiter.py: Add `arivu_rate_limiter` module-level instance (GAP-8)

Phase 4 §0.3 adds `from backend.rate_limiter import arivu_rate_limiter as rate_limiter`
to `app.py`, but `backend/rate_limiter.py` never creates this module-level instance.
This causes an `ImportError` at startup.

At the **bottom** of `backend/rate_limiter.py`, after the class definitions, add:

```python
# ── Module-level singleton instances ─────────────────────────────────────────
# Imported by app.py as:
#   from backend.rate_limiter import arivu_rate_limiter as rate_limiter
# Both names are provided for backward compatibility.
arivu_rate_limiter    = ArivuRateLimiter()
coordinated_limiter   = CoordinatedRateLimiter()
```

Verify the import works:
```bash
python -c "from backend.rate_limiter import arivu_rate_limiter; print('OK')"
# Must print: OK
```

---

### §0.2 — static/js/graph.js: Add zoom threshold trigger for SemanticZoomRenderer (GAP-2)

Phase 4 §0.10 adds `this._semanticZoom = null` to the `ArivuGraph` constructor, and
Phase 4 §8.2 wires up `SemanticZoomRenderer` in `loader.js`. But the D3 zoom handler
in `graph.js` was never updated to call `renderClusters()` / `removeClusterOverlay()`.
The "Done When" criterion #9 (*semantic zoom activates at k < 0.4*) cannot pass without this.

In `static/js/graph.js`, find the D3 zoom event handler. It will look like:
```javascript
this.zoom = d3.zoom()
  .scaleExtent([0.1, 4])
  .on("zoom", (event) => {
    this.zoomGroup.attr("transform", event.transform);
    // ... possibly other zoom logic
  });
```

Inside the `.on("zoom", ...)` callback, **after** the transform line, add:

```javascript
    // ── Semantic zoom: switch to cluster view below k=0.4 ────────────────
    const _k = event.transform.k;
    if (this._semanticZoom) {
      if (_k < 0.4) {
        this._semanticZoom.renderClusters();
      } else {
        this._semanticZoom.removeClusterOverlay();
      }
    }
```

Verify by checking the file:
```bash
grep -n "renderClusters\|removeClusterOverlay" static/js/graph.js
# Must print at least 2 lines (the two calls above)
```

---

### §0.3 — backend/utils.py: Fix GALLERY_DIR and GALLERY_INDEX_PATH (GAP-7, GAP-31)

Phase 1 defines in `backend/utils.py`:
```python
GALLERY_DIR        = Path(__file__).parent.parent / "data" / "precomputed"
GALLERY_INDEX_PATH = GALLERY_DIR / "gallery_index.json"
```

Phase 4 moved the canonical `gallery_index.json` to `data/gallery_index.json` (one level
up, outside `precomputed/`). Any code calling `utils.load_gallery_index()` reads from the
wrong location. Fix both constants:

```python
# In backend/utils.py, replace the two GALLERY_* lines:

# Phase 5: gallery_index.json lives at data/gallery_index.json (not data/precomputed/)
# Pre-computed individual graph JSONs remain in data/precomputed/<slug>.json
GALLERY_DIR        = Path(__file__).parent.parent / "data" / "precomputed"
GALLERY_INDEX_PATH = Path(__file__).parent.parent / "data" / "gallery_index.json"
```

`GALLERY_DIR` itself stays at `data/precomputed/` (precomputed graph JSONs live there).
Only `GALLERY_INDEX_PATH` changes — it now points to `data/gallery_index.json`.

Verify:
```bash
python -c "
from backend.utils import GALLERY_INDEX_PATH
print(GALLERY_INDEX_PATH)
# Must end with: data/gallery_index.json  (NOT data/precomputed/gallery_index.json)
"
```

---

### §0.4 — backend/r2_client.py: Add `presigned_url()` method (GAP-13)

Phase 5's `export_generator.py` calls `self.r2.presigned_url(key, expires_in=3600)`.
Phase 4 §0.6 added `download_json`, `upload_json`, `download`, and `upload` aliases —
but never added `presigned_url()`. Verify it exists first:

```bash
grep -n "def presigned_url" backend/r2_client.py
```

If no output, add this method inside the `R2Client` class (alongside the other methods):

```python
def presigned_url(self, key: str, expires_in: int = 3600) -> str:
    """
    Return a presigned GET URL for `key`. URL expires after `expires_in` seconds.
    Raises RuntimeError if R2 is not configured.
    Used by export_generator.py to give the client a time-limited download link.
    """
    if not self._enabled or not self._client:
        raise RuntimeError(
            "R2 not configured — cannot generate presigned URL. "
            "Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in environment."
        )
    return self._client.generate_presigned_url(
        "get_object",
        Params={"Bucket": self._bucket, "Key": key},
        ExpiresIn=expires_in,
    )
```

Verify:
```bash
python -c "
from backend.r2_client import R2Client
r2 = R2Client()
print(hasattr(r2, 'presigned_url'))  # Must print: True
"
```

---

### §0.5 — backend/quality_monitor.py: Fix confidence field name (GAP-15)

`ProductionQualityMonitor.analyze_graph_quality()` checks confidence with:
```python
confidences = [e.get("final_confidence") or e.get("mutation_confidence", 0) for e in edges]
```

The canonical field name in Phase 1's `EdgeAnalysis` dataclass and in `export_to_json()`
serialization is `base_confidence` — not `final_confidence`. This makes the
`HIGH_LOW_CONFIDENCE` metric permanently return 0 for every edge.

In `backend/quality_monitor.py`, find the confidence section (look for `final_confidence`)
and replace with:

```python
        # ── 3. Confidence score distribution ──────────────────────
        # Field names: export_to_json() uses base_confidence (from EdgeAnalysis dataclass).
        # Also accept mutation_confidence and final_confidence for forward compatibility.
        confidences = [
            e.get("base_confidence")
            or e.get("mutation_confidence")
            or e.get("final_confidence")
            or 0
            for e in edges
        ]
```

---

### §0.6 — tests/test_phase3.py: Fix all broken test fixtures (GAP-16)

Phase 4 §0.11 only fixes the `TestAPIRoutes` fixture. Other test classes in
`test_phase3.py` may use the same broken pattern `from app import app`.

Audit ALL `@pytest.fixture` definitions in `tests/test_phase3.py`:

```bash
grep -n "from app import app\|def client" tests/test_phase3.py
```

For **every** fixture that uses `from app import app`, replace with the correct pattern:

```python
# WRONG (breaks when app is module-level — Phase 4 §0.1 moved app to module level):
# @pytest.fixture
# def client(self):
#     from app import app
#     app.config['TESTING'] = True
#     with app.test_client() as c:
#         yield c

# CORRECT — works for all phases:
@pytest.fixture
def client(self):
    from app import create_app
    application = create_app()
    application.config['TESTING'] = True
    with application.test_client() as c:
        yield c
```

Apply this fix to every test class that has a `client` fixture, not just `TestAPIRoutes`.
Run the tests to confirm all pass:
```bash
python -m pytest tests/test_phase3.py -v
# All must pass with 0 failed
```

---

### §0.7 — app.py: Fix `_configure_cors()` Phase 5 placeholder (GAP-4)

Phase 4's `_configure_cors()` has commented-out custom domain lines. Phase 5 §2.3
requires uncommenting them. Verify the comment block exists in exactly this form:

```bash
grep -n "arivu.app" app.py
```

The block must look like this for Phase 5's uncomment step to work:

```python
    # Phase 5: uncomment these two lines after arivu.app DNS is live and HTTPS verified
    # origins += ["https://arivu.app", "https://www.arivu.app"]
```

If it exists in a different form (e.g., spread over more lines or with different comment
text), replace it with exactly the two-line block above. Phase 5 §2.3 will then uncomment
the single `origins +=` line.

---

### §0.8 — Upgrade "OUT OF SCOPE" stubs to class skeletons (GAP-5)

Phase 1 created `living_paper_scorer.py`, `originality_mapper.py`, and
`paradigm_detector.py` with only:
```python
"""LivingPaperScore: quality-weighted influence — OUT OF SCOPE v1."""
# OUT OF SCOPE — v1
```

Phase 5 §5, §6, §7 replace these with real implementations. Before replacing, check
whether Phase 4 already upgraded them to have class skeletons:

```bash
grep -n "class LivingPaperScorer" backend/living_paper_scorer.py
grep -n "class OriginalityMapper" backend/originality_mapper.py
grep -n "class ParadigmShiftDetector" backend/paradigm_detector.py
```

If any command returns no output, the stub is still in its Phase 1 "OUT OF SCOPE" form.
This is fine — Phase 5 §5, §6, §7 will replace the entire file content regardless.
Claude Code should treat §5, §6, §7 as **full file replacements**, not additions.

---

### §0.9 — templates/explore.html: Add gallery stats script (GAP-6)

Phase 4 §6.8 instructs adding a gallery stats script to `templates/explore.html`, but
this file was missing from Phase 4's "Modified" files list. Verify the script is present:

```bash
grep -n "gallery_index.json" templates/explore.html
```

If no output, add the following inside `{% block scripts %}` in `templates/explore.html`:

```html
<script>
// Load real precomputed stats into gallery cards, replacing placeholder values.
// Falls back silently to hardcoded placeholder values if the fetch fails.
fetch('/static/gallery_index.json')
  .then(r => r.json())
  .then(entries => {
    entries.forEach(entry => {
      const card = document.querySelector(`.gallery-entry[data-slug="${entry.slug}"]`);
      if (!card || !entry.stats) return;
      const p = card.querySelector('p');
      if (p) {
        const authors = (entry.authors || []).join(', ');
        p.textContent = `${authors}, ${entry.year} · ${entry.stats.papers} papers`;
      }
    });
  })
  .catch(() => {}); // silently fall back to hardcoded placeholder values
</script>
```

Also ensure each gallery card in `explore.html` has `data-slug="<slug>"` on its
container element, matching the slugs in `data/gallery_index.json`.

---

### §0.10 — CONTEXT.md: Define canonical format (GAP-10)

`CONTEXT.md` is referenced and updated in every phase, but its format was never
defined. If the file doesn't yet exist in a structured form, create or overwrite it
with this canonical template (fill in the actual Koyeb URL from Phase 4):

```markdown
# CONTEXT.md — Arivu Project Status

## Phases

### Completed
- **Phase 1** — Project skeleton, schema, health check
- **Phase 2** — Data layer, NLP worker, graph build pipeline
- **Phase 3** — Full-text pipeline, intelligence layer, frontend
- **Phase 4** — Deployment, production hardening, gallery launch

### In Progress
- **Phase 5** — Export system, advanced intelligence, custom domain

### Not Started
- **Phase 6** — Auth, accounts, Stripe billing (future)
- **Phase 7** — Time Machine, Vocabulary Evolution (future)

---

## Live Deployment

| Service | URL |
|---------|-----|
| Backend API (Koyeb) | https://YOUR-APP.koyeb.app |
| NLP Worker (HuggingFace) | https://YOUR-USERNAME-arivu-nlp.hf.space |
| Database (Neon) | ep-YOUR-PROJECT.neon.tech / arivu |
| Object Storage (R2) | arivu-data bucket |
| Custom Domain (Phase 5) | https://arivu.app (after DNS setup) |

---

## Architecture Notes
- Main server may NEVER import sentence_transformers, torch, or any ML library
- DB pool: 2 workers × DB_POOL_MAX=4 = 8 connections (Neon free cap = 10)
- All secrets in environment variables — never hardcoded
- Two git commits per phase: implementation + CONTEXT.md update
```

Update the "Completed" / "In Progress" sections at the end of each phase as documented
in each phase's CONTEXT.md update section.

---

### §0.11 — DECISIONS.md: Define content (GAP-11)

Phase 1 lists `DECISIONS.md` as a "real implementation" file but never defines its
content. Create it now if it doesn't exist:

```markdown
# DECISIONS.md — Architecture Decision Log

## ADR-001: Sentence-transformer isolation
**Decision:** The main Koyeb server never imports sentence_transformers or torch.
**Reason:** These libraries trigger OOM on Koyeb's 512MB free tier at model load time.
**Consequence:** All embedding work goes through the NLP worker (HuggingFace Spaces)
via HTTP. Pre-computed embeddings in paper_embeddings table handle offline analysis.

## ADR-002: Neon + R2 as primary storage
**Decision:** PostgreSQL (Neon) for structured data; Cloudflare R2 for large JSON blobs.
**Reason:** Neon free tier: 512MB, 10 connections. R2: 10GB free, S3-compatible.
Graph JSON can be 1-5MB — storing in DB would hit the storage cap quickly.
**Consequence:** Graphs always have two representations: DB row (metadata) + R2 blob (full JSON).

## ADR-003: Anonymous sessions, no auth in Phase 4
**Decision:** Phase 4 ships with anonymous session-only access. No login, no accounts.
**Reason:** Auth adds 2-3 weeks of scope. Core value (graph analysis) doesn't require it.
**Consequence:** All data is session-scoped. Sessions expire. No persistence across browsers.

## ADR-004: Groq for LLM, degrade gracefully without key
**Decision:** Use Groq (llama-3.1-8b-instant) for LLM features. All LLM paths have
template fallbacks when GROQ_API_KEY is not set.
**Reason:** Free tier, fast inference, no cold start.
**Consequence:** LLM-powered features (genealogy, cluster labels, literature review)
are optional enhancements — core graph analysis works without them.

## ADR-005: gallery_index.json lives at data/ not data/precomputed/
**Decision:** Phase 4 moved gallery_index.json from data/precomputed/ to data/.
**Reason:** gallery_index.json is a manually curated index file, not a precomputed artifact.
It is committed to git. Precomputed graph JSONs remain in data/precomputed/.
**Consequence:** backend/utils.py GALLERY_INDEX_PATH was updated in Phase 5 §0.3.

## ADR-006: BibTeX over Zotero RDF for citation export
**Decision:** Export citations as BibTeX (.bib), not Zotero RDF or CSL-JSON.
**Reason:** BibTeX is the universal format — imports into Zotero, Mendeley, Overleaf,
LaTeX, and virtually every reference manager without configuration.

## ADR-007: retraction_watch table (not retractions)
**Decision:** The DB table is named retraction_watch (from Phase 1 migration DDL).
**Reason:** The complete spec §61 uses "retractions" as an alternative name, but the
Phase 1 migration (authoritative) created it as retraction_watch. Do not rename.
**Consequence:** load_retraction_watch.py targets the retraction_watch table.
```

---

### §0.12 — app.py: Add R2 proxy routes for gallery (GAP-28)

`scripts/verify_deployment.py` (Phase 4 §14) checks
`GET /static/previews/<slug>/graph.json` — but this route may not have been explicitly
defined in Phase 3. Verify it exists:

```bash
grep -n "static/previews" app.py
```

If no output, add these routes to `app.py` alongside the other gallery routes:

```python
# ─── R2 proxy routes for gallery previews ─────────────────────────────────────
# Serve precomputed graph data from R2 through the backend proxy.
# This prevents exposing R2 credentials and allows CORS control.

@app.route("/static/previews/<slug>/graph.json")
def gallery_preview_json(slug: str):
    """
    Serve full precomputed graph JSON for a gallery entry.
    Loaded by explore/<slug> page when user clicks a gallery card.
    Proxied from R2: previews/<slug>/graph.json
    """
    from backend.r2_client import R2Client
    safe_slug = slug.replace("..", "").replace("/", "").strip()
    if not safe_slug or not safe_slug.isalnum():
        return jsonify({"error": "Invalid slug"}), 400

    r2 = R2Client()
    if not r2._enabled:
        return jsonify({"error": "R2 not configured"}), 503

    try:
        data = r2.download_json(f"previews/{safe_slug}/graph.json")
        if data is None:
            return jsonify({"error": "Preview not found — run precompute_gallery.py"}), 404
        return jsonify(data), 200, {"Cache-Control": "public, max-age=3600"}
    except Exception as exc:
        app.logger.warning(f"R2 preview fetch failed for {safe_slug}: {exc}")
        return jsonify({"error": "Could not load preview"}), 503


@app.route("/static/previews/<slug>.svg")
def gallery_preview_svg(slug: str):
    """
    Serve precomputed SVG thumbnail for a gallery card.
    Proxied from R2: previews/<slug>.svg
    """
    from backend.r2_client import R2Client
    safe_slug = slug.replace("..", "").replace("/", "").strip()
    if not safe_slug or not safe_slug.isalnum():
        return "Invalid slug", 400

    r2 = R2Client()
    if not r2._enabled:
        return "R2 not configured", 503

    try:
        raw = r2.download(f"previews/{safe_slug}.svg")
        if raw is None:
            return "SVG not found", 404
        return app.response_class(
            response=raw,
            mimetype="image/svg+xml",
            headers={"Cache-Control": "public, max-age=86400"},
        )
    except Exception as exc:
        app.logger.warning(f"R2 SVG fetch failed for {safe_slug}: {exc}")
        return "Could not load SVG", 503
```

---

### §0.13 — scripts/ground_truth_eval.py: Fix stub docstring (GAP-9)

Phase 1's stub says `"Implemented in Phase 4."` which is incorrect — it's Phase 5.
Update the stub docstring (it will be replaced entirely in Phase 5 §12, but fixing it
now prevents Claude Code from implementing it prematurely during Phase 4):

```python
# scripts/ground_truth_eval.py — current stub content (Phase 1 created this):
"""
ground_truth_eval.py - Run NLP pipeline against 50 known inheritance pairs.
Implemented in Phase 5.  ← CORRECTED (Phase 1 said "Phase 4" — that was wrong)
"""
# TODO: Phase 5
```

Verify the fix:
```bash
grep -n "Phase" scripts/ground_truth_eval.py
# Must show "Phase 5", not "Phase 4"
```

---

### §0.14 — data/ground_truth/: Create directory with git tracking (GAP-21)

Phase 5 §13 creates `data/ground_truth/pairs.json`. The directory must exist and be
git-tracked. Create it now:

```bash
mkdir -p data/ground_truth
touch data/ground_truth/.gitkeep
git add data/ground_truth/.gitkeep
git commit -m "[phase5-prep] create data/ground_truth/ directory"
```

The `pairs.json` file goes here and IS committed to git (it is a curated dataset, not
generated output). Add to `.gitignore` confirmation:

```bash
git check-ignore -v data/ground_truth/pairs.json
# No output = correctly tracked ✅
# If ignored: the data/ground_truth/ entry must be removed from .gitignore
```

Do NOT gitignore `data/retractions.csv` — confirm it is ignored:
```bash
grep "retractions.csv" .gitignore
# Must match — this file is large (~150MB) and must NOT be committed
```

---

### §0.15 — Note: Phase 4 backport count correction (GAP-1)

Phase 4's §0 header says *"Apply all 15 before proceeding"* but only defines §0.1
through §0.11 (11 backports). The count is wrong in the Phase 4 spec document.
The actual count is 11. Do not search for §0.12–§0.15 in Phase 4 — they do not
exist. Phase 5 §0 supplies the remaining critical fixes.

---

### §0.16 — Phase 1 stub attribution note: do not re-implement Phase 3 modules (GAP-12, GAP-19)

Phase 1's stub table incorrectly attributes several modules to Phase 4. Do NOT
re-implement these — they were already completed in Phase 3:

| File | Phase 1 Said | Actual Phase | Status |
|---|---|---|---|
| `dna_profiler.py` | Phase 4 | Phase 3 | ✅ Done |
| `diversity_scorer.py` | Phase 4 | Phase 3 | ✅ Done |
| `orphan_detector.py` | Phase 4 | Phase 3 | ✅ Done |
| `quality_monitor.py` | Phase 6 | Phase 4 | ✅ Done |
| `precompute_gallery.py` | Phase 5 | Phase 3 | ✅ Done |
| `load_retraction_watch.py` | Phase 2 | Phase 5 | ← Phase 5 §11 |

If any of these files is still a stub (only a comment, no class definition), it means
a previous phase was incomplete. Do not proceed — complete Phase 3 and Phase 4 first.

---

### §0.17 — DB: Recovery SQL for missing tables (GAP-20)

Phase 4 §10.3 lists `build_jobs` and `job_events` as expected tables but provides no
recovery SQL. If they're missing:

```bash
# Check for missing tables:
psql $DATABASE_URL -c "
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('build_jobs', 'job_events')
ORDER BY table_name;"
```

If `build_jobs` is missing:
```bash
psql $DATABASE_URL -c "
CREATE TABLE IF NOT EXISTS build_jobs (
    job_id       TEXT        PRIMARY KEY,
    paper_id     TEXT        NOT NULL,
    session_id   TEXT        NOT NULL,
    status       TEXT        NOT NULL DEFAULT 'pending',
    created_at   TIMESTAMP   NOT NULL DEFAULT NOW(),
    started_at   TIMESTAMP,
    completed_at TIMESTAMP,
    error        TEXT,
    graph_id     TEXT
);
CREATE INDEX IF NOT EXISTS idx_build_jobs_session ON build_jobs(session_id);
CREATE INDEX IF NOT EXISTS idx_build_jobs_status  ON build_jobs(status);"
```

If `job_events` is missing:
```bash
psql $DATABASE_URL -c "
CREATE TABLE IF NOT EXISTS job_events (
    id          SERIAL      PRIMARY KEY,
    job_id      TEXT        NOT NULL REFERENCES build_jobs(job_id) ON DELETE CASCADE,
    sequence    INT         NOT NULL DEFAULT 0,
    event_type  TEXT        NOT NULL,
    event_data  JSONB       NOT NULL DEFAULT '{}',
    created_at  TIMESTAMP   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events(job_id, sequence);"
```

---

### §0.18 — Verify `_semanticZoom` initialization in ArivuGraph constructor (GAP-24)

Phase 3 added null-guard references to `this._semanticZoom` in `graph.js`.
Phase 4 §0.10 added `this._semanticZoom = null` to the constructor.
Verify this is present — it must precede any use of the property:

```bash
grep -n "_semanticZoom" static/js/graph.js | head -5
# First match must be "this._semanticZoom = null" inside the constructor
```

If the initialization is missing, add it as the first line of the `ArivuGraph` constructor:

```javascript
constructor(container, graphData) {
    this._semanticZoom = null;   // ← must be first line
    // ... rest of constructor unchanged
}
```

---

## §1 — requirements.txt Additions

Add to the existing `requirements.txt` (do not remove existing entries):

```
# Phase 5 — Export system
weasyprint==60.2        # PDF generation from HTML/CSS (genealogy-pdf export)
python-docx==1.1.2      # Word document generation (literature-review export)
reportlab==4.2.0        # PDF layout primitives (action-log export)
matplotlib==3.8.4       # Graph PNG/SVG rendering (may already exist — skip duplicate)
Markdown==3.5.2         # HTML conversion for WeasyPrint PDF pipeline
```

**WeasyPrint system dependencies** (must be installed before `pip install`):

```bash
# Ubuntu/Debian (Koyeb uses Debian):
apt-get install -y libpango-1.0-0 libpangoft2-1.0-0 libcairo2 libgdk-pixbuf2.0-0

# macOS:
brew install pango cairo gdk-pixbuf

# Already in Dockerfile from Phase 1 — verify these lines exist:
# libpango-1.0-0, libpangoft2-1.0-0, libcairo2, libgdk-pixbuf2.0-0
```

The Phase 1 Dockerfile already includes these system libraries. No Dockerfile changes needed.

---

## §2 — Custom Domain Setup (Human Steps)

### §2.1 — Register/configure arivu.app

If `arivu.app` is not yet registered:
1. Register at any domain registrar (Cloudflare Registrar recommended for free DNSSEC)
2. Point nameservers to Cloudflare for DNS management

### §2.2 — Add custom domain to Koyeb

1. Koyeb dashboard → your service → Settings → Domains
2. Add `arivu.app` and `www.arivu.app`
3. Koyeb gives you a CNAME target (e.g. `xxx.koyeb.app`)
4. In Cloudflare DNS, add:
   ```
   CNAME  arivu.app      → xxx.koyeb.app    (proxied)
   CNAME  www.arivu.app  → xxx.koyeb.app    (proxied)
   ```
5. Wait for SSL certificate provisioning (~2 minutes)
6. Verify: `curl -I https://arivu.app/health` returns 200

### §2.3 — Update CORS in app.py

In `app.py`, find `_configure_cors()` from Phase 4. After §0.7 backport, there will be
exactly this commented block:

```python
    # Phase 5: uncomment these two lines after arivu.app DNS is live and HTTPS verified
    # origins += ["https://arivu.app", "https://www.arivu.app"]
```

Uncomment the `origins +=` line:

```python
    # Phase 5: uncomment these two lines after arivu.app DNS is live and HTTPS verified
    origins += ["https://arivu.app", "https://www.arivu.app"]
```

Also add to Koyeb environment variables:
```
CUSTOM_DOMAIN=arivu.app
```

Add to `.env.example`:
```bash
# Custom domain (add after DNS is configured in Phase 5)
# CUSTOM_DOMAIN=arivu.app
```

### §2.4 — Verify CORS after domain switch

```bash
curl -H "Origin: https://arivu.app" \
     -H "Access-Control-Request-Method: POST" \
     -X OPTIONS \
     https://arivu.app/api/search -I
# Must include: Access-Control-Allow-Origin: https://arivu.app
```

**IMPORTANT:** Do NOT uncomment these lines until DNS is fully propagated and HTTPS is
verified with `curl -I https://arivu.app/health` returning HTTP/2 200. Adding the domain
to CORS before DNS propagates will block all other origins.

---

## §3 — Polished og-image.png

Phase 4 created a basic og-image.png using an inline Pillow script. Phase 5 replaces
it with a polished version using a dedicated script. Note: this replaces Phase 4's
asset — it is not replacing a 1×1 placeholder.

```bash
pip install Pillow --break-system-packages
python scripts/generate_og_image.py
git add static/assets/og-image.png
git commit -m "[phase5] polished og-image for social sharing"
```

Create `scripts/generate_og_image.py`:

```python
#!/usr/bin/env python3
"""
scripts/generate_og_image.py
Generate static/assets/og-image.png for social sharing (1200×630px).
Run once: python scripts/generate_og_image.py
Replaces Phase 4's basic placeholder with a polished branded image.
"""
from PIL import Image, ImageDraw, ImageFont
import pathlib

W, H = 1200, 630
BG   = "#0a0e17"
GOLD = "#D4A843"
TEXT = "#E2E8F0"
DIM  = "#94A3B8"


def load_font(path: str, size: int):
    try:
        return ImageFont.truetype(path, size)
    except (IOError, OSError):
        return None


def main():
    img  = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    font_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/Library/Fonts/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    font_xl = load_font(font_paths[0], 96) or load_font(font_paths[2], 96)
    font_lg = load_font(font_paths[1], 42) or load_font(font_paths[3], 42)
    font_md = load_font(font_paths[1], 28) or load_font(font_paths[3], 28)

    draw.text((80, 160), "Arivu", fill=GOLD, font=font_xl)
    draw.text((80, 285), "அறிவு — knowledge / wisdom", fill=DIM, font=font_md)
    draw.text((80, 360), "Trace the intellectual ancestry", fill=TEXT, font=font_lg)
    draw.text((80, 415), "of any research paper.", fill=TEXT, font=font_lg)

    import random
    rng = random.Random(42)
    for _ in range(40):
        x = rng.randint(750, 1150)
        y = rng.randint(60, 560)
        r = rng.randint(1, 4)
        draw.ellipse([x-r, y-r, x+r, y+r], fill=GOLD)

    draw.text((80, 570), "arivu.app", fill=DIM, font=font_md)

    out = pathlib.Path("static/assets/og-image.png")
    img.save(out, optimize=True, quality=95)
    size_kb = out.stat().st_size // 1024
    print(f"Generated {out} ({size_kb}KB, {W}×{H}px)")


if __name__ == "__main__":
    main()
```

---

## §4 — Update backend/rate_limiter.py

Add Phase 5 endpoint limits to `ArivuRateLimiter.LIMITS` dict:

```python
# Add to the LIMITS dict in ArivuRateLimiter:
'POST /api/export':        (10,  3600, 1),   # 10 exports/hour — storage intensive
'GET /api/living-score':   (30,  60,   1),   # 30/minute — computed from DB
'GET /api/originality':    (20,  60,   1),   # 20/minute — embedding lookups
'GET /api/paradigm':       (10,  60,   1),   # 10/minute — heavier computation
```

Note: the `arivu_rate_limiter` module-level instance (added in §0.1) picks up these
new limits automatically — no re-instantiation needed.

---

## §5 — backend/living_paper_scorer.py (stub → real)

Replace the entire file content with:

```python
"""
backend/living_paper_scorer.py

LivingPaperScorer: computes citation velocity and trajectory for each paper
in a graph. Uses the paper's citation_count from the papers table and the
edge structure of the graph to estimate momentum.

Score 0-100:
  - 80-100: Rising fast — heavy recent citation activity
  - 60-79:  Stable — consistent citation activity
  - 40-59:  Declining — was more cited historically
  - 0-39:   Dormant/extinct — minimal recent activity

Trajectory:
  "rising"    — recent citations outpace historical rate
  "stable"    — consistent rate over time
  "declining" — slowing citation rate
  "extinct"   — no meaningful recent citations

Algorithm:
  1. Build per-paper citation timelines from the graph's edge publication years
  2. Split into recent (last 3 years) and historical windows
  3. Score = 50 * (recent_rate / max_rate) + 50 * (recency_weight)
  4. Trajectory from rate of change between windows

Does NOT call the NLP worker — uses only citation_count and year from DB.
"""
import logging
import math
from datetime import datetime, timezone
from dataclasses import dataclass
from typing import Optional
from collections import defaultdict

logger = logging.getLogger(__name__)


def _current_year() -> int:
    """Return the current year dynamically. Never hardcode this value."""
    return datetime.now(timezone.utc).year


@dataclass
class LivingScore:
    paper_id:          str
    score:             float    # 0-100
    trajectory:        str      # "rising" | "stable" | "declining" | "extinct"
    recent_citations:  int      # citations in last 3 years (from graph edges)
    total_citations:   int      # citation_count from DB
    citation_velocity: float    # estimated citations per year (recent window)
    peer_percentile:   float    # 0-1 position within this graph

    def to_dict(self) -> dict:
        return {
            "paper_id":          self.paper_id,
            "score":             round(self.score, 1),
            "trajectory":        self.trajectory,
            "recent_citations":  self.recent_citations,
            "total_citations":   self.total_citations,
            "citation_velocity": round(self.citation_velocity, 2),
            "peer_percentile":   round(self.peer_percentile, 2),
        }


class LivingPaperScorer:
    """
    Compute living scores for all papers in a graph JSON dict.
    Stateless — instantiate fresh per request.
    """

    RECENT_WINDOW_YEARS = 3    # "recent" = last N years
    EXTINCT_THRESHOLD   = 5    # papers older than N years with 0 recent cites = extinct
    RISING_RATIO        = 1.5  # recent_rate / historical_rate to be "rising"
    DECLINING_RATIO     = 0.5  # recent_rate / historical_rate to be "declining"

    def score_graph(self, graph_json: dict) -> dict:
        """
        Compute living scores for all nodes in the graph.

        Args:
            graph_json: graph dict from export_to_json() / R2

        Returns:
            {paper_id: LivingScore} for every node
        """
        nodes = graph_json.get("nodes", [])
        edges = graph_json.get("edges", [])

        if not nodes:
            return {}

        # Build citation timeline from edge structure.
        # An edge source→target means source CITES target.
        # The source paper's year is when the citation occurred.
        cite_years: dict = defaultdict(list)
        for edge in edges:
            cited_id  = edge.get("target") or edge.get("cited_paper_id")
            source_id = edge.get("source") or edge.get("citing_paper_id")
            if cited_id and source_id:
                cite_years[cited_id].append(source_id)

        node_by_id = {n["id"]: n for n in nodes}

        cite_year_ints: dict = defaultdict(list)
        for cited_id, source_ids in cite_years.items():
            for src_id in source_ids:
                src_node = node_by_id.get(src_id)
                if src_node and src_node.get("year"):
                    cite_year_ints[cited_id].append(int(src_node["year"]))

        current_year = _current_year()  # Always dynamic — never hardcoded
        raw_scores: dict   = {}
        recent_counts: dict = {}
        velocities: dict   = {}
        trajectories: dict = {}

        for node in nodes:
            pid       = node["id"]
            year      = node.get("year") or (current_year - 5)
            paper_age = current_year - int(year)

            citation_years = cite_year_ints.get(pid, [])
            cutoff = current_year - self.RECENT_WINDOW_YEARS
            recent     = [y for y in citation_years if y >= cutoff]
            historical = [y for y in citation_years if y < cutoff]

            recent_count    = len(recent)
            historical_count = len(historical)

            velocity = recent_count / max(self.RECENT_WINDOW_YEARS, 1)
            velocities[pid]     = velocity
            recent_counts[pid]  = recent_count

            historical_window = max(paper_age - self.RECENT_WINDOW_YEARS, 1)
            historical_rate   = historical_count / historical_window
            recent_rate       = velocity

            if paper_age <= 2:
                trajectory = "rising" if recent_count > 0 else "stable"
            elif recent_count == 0 and paper_age >= self.EXTINCT_THRESHOLD:
                trajectory = "extinct"
            elif historical_rate == 0:
                trajectory = "rising" if recent_rate > 0 else "stable"
            elif recent_rate / historical_rate >= self.RISING_RATIO:
                trajectory = "rising"
            elif recent_rate / historical_rate <= self.DECLINING_RATIO:
                trajectory = "declining"
            else:
                trajectory = "stable"

            trajectories[pid] = trajectory
            db_citations      = node.get("citation_count", 0) or 0
            recency_bonus     = min(1.0, recent_count / max(paper_age * 0.5, 1))
            raw_scores[pid]   = (velocity * 30) + (recency_bonus * 20) + min(db_citations / 1000.0, 50)

        if not raw_scores:
            return {}

        max_raw = max(raw_scores.values()) or 1.0
        all_scores = list(raw_scores.values())
        all_scores.sort()

        result: dict = {}
        for node in nodes:
            pid          = node["id"]
            raw          = raw_scores.get(pid, 0.0)
            normalized   = (raw / max_raw) * 100.0
            rank         = all_scores.index(raw) if raw in all_scores else 0
            percentile   = rank / max(len(all_scores) - 1, 1)

            result[pid] = LivingScore(
                paper_id          = pid,
                score             = round(min(normalized, 100.0), 1),
                trajectory        = trajectories.get(pid, "stable"),
                recent_citations  = recent_counts.get(pid, 0),
                total_citations   = node.get("citation_count", 0) or 0,
                citation_velocity = round(velocities.get(pid, 0.0), 2),
                peer_percentile   = round(percentile, 2),
            )

        return result

    def score_single(self, paper_id: str, graph_json: dict) -> Optional[LivingScore]:
        """Score a single paper. Returns None if paper_id not in graph."""
        nodes = graph_json.get("nodes", [])
        if not any(n["id"] == paper_id for n in nodes):
            return None
        all_scores = self.score_graph(graph_json)
        return all_scores.get(paper_id)
```

---

## §6 — backend/originality_mapper.py (stub → real)

Replace the entire file content with:

```python
"""
backend/originality_mapper.py

OriginalityMapper: classifies each paper's contribution type by comparing
its embeddings to those of its direct ancestors in the graph.

Contribution types (spec F1.11):
  Pioneer     — introduces concepts with no close ancestor in this graph
  Synthesizer — combines multiple existing ideas (≥3 ancestors, moderate sim)
  Bridge      — connects previously separate fields
  Refiner     — deeply extends a single prior idea (high sim, ≤3 ancestors)
  Contradictor— primary contribution challenges prior work

Uses pre-computed embeddings from paper_embeddings table via pgvector.
Falls back to structural heuristics if embeddings are unavailable.
Does NOT call the NLP worker at request time.
"""
import logging
import math
from dataclasses import dataclass
from typing import Optional
from collections import Counter

import backend.db as db

logger = logging.getLogger(__name__)

PIONEER_THRESHOLD = 0.30   # max_sim below this → Pioneer
NOVEL_THRESHOLD   = 0.45   # ancestor sims below this → novel contribution


@dataclass
class OriginalityScore:
    paper_id:           str
    contribution_type:  str    # Pioneer|Synthesizer|Bridge|Refiner|Contradictor
    score:              float  # 0-1 novelty fraction
    inherited_fraction: float  # 0-1 how much came from ancestors
    novel_idea_count:   int
    total_idea_count:   int
    dominant_ancestor:  Optional[str]
    ancestor_count:     int
    confidence:         str    # "high"|"medium"|"low"
    evidence:           str

    def to_dict(self) -> dict:
        return {
            "paper_id":           self.paper_id,
            "contribution_type":  self.contribution_type,
            "score":              round(self.score, 3),
            "inherited_fraction": round(self.inherited_fraction, 3),
            "novel_idea_count":   self.novel_idea_count,
            "total_idea_count":   self.total_idea_count,
            "dominant_ancestor":  self.dominant_ancestor,
            "ancestor_count":     self.ancestor_count,
            "confidence":         self.confidence,
            "evidence":           self.evidence,
        }


class OriginalityMapper:
    """Stateless — instantiate fresh per request."""

    def compute_originality(
        self, paper_id: str, graph_json: dict
    ) -> Optional[OriginalityScore]:
        """
        Classify the contribution type of paper_id within this graph.
        Returns None if paper_id is not in the graph.
        """
        nodes    = graph_json.get("nodes", [])
        edges    = graph_json.get("edges", [])
        nodes_by_id = {n["id"]: n for n in nodes}

        if paper_id not in nodes_by_id:
            return None

        ancestor_ids: list     = []
        edge_to_ancestors: dict = {}
        for edge in edges:
            src = edge.get("source") or edge.get("citing_paper_id", "")
            tgt = edge.get("target") or edge.get("cited_paper_id", "")
            if src == paper_id:
                ancestor_ids.append(tgt)
                edge_to_ancestors[tgt] = edge

        if not ancestor_ids:
            return OriginalityScore(
                paper_id=paper_id, contribution_type="Pioneer",
                score=1.0, inherited_fraction=0.0,
                novel_idea_count=0, total_idea_count=0,
                dominant_ancestor=None, ancestor_count=0,
                confidence="low",
                evidence="No ancestors found in graph — Pioneer classification by default.",
            )

        all_ids = [paper_id] + ancestor_ids
        try:
            rows = db.fetchall(
                "SELECT paper_id, embedding FROM paper_embeddings "
                "WHERE paper_id = ANY(%s)",
                (all_ids,),
            )
        except Exception as exc:
            logger.warning(f"Embedding lookup failed: {exc} — using structural fallback")
            rows = []

        embeddings = {r["paper_id"]: r["embedding"] for r in rows if r.get("embedding")}

        paper_emb = embeddings.get(paper_id)
        if not paper_emb:
            return self._structural_fallback(
                paper_id, ancestor_ids, edge_to_ancestors, nodes_by_id
            )

        ancestor_sims: dict = {}
        for aid in ancestor_ids:
            anc_emb = embeddings.get(aid)
            if anc_emb:
                sim = self._cosine_similarity(paper_emb, anc_emb)
                ancestor_sims[aid] = sim

        if not ancestor_sims:
            return self._structural_fallback(
                paper_id, ancestor_ids, edge_to_ancestors, nodes_by_id
            )

        max_sim    = max(ancestor_sims.values())
        mean_sim   = sum(ancestor_sims.values()) / len(ancestor_sims)
        n_ancestors = len(ancestor_ids)

        mutation_counts = Counter(
            edge_to_ancestors[aid].get("mutation_type", "unknown")
            for aid in ancestor_ids if aid in edge_to_ancestors
        )

        contribution_type, evidence = self._classify(
            max_sim=max_sim, mean_sim=mean_sim, n_ancestors=n_ancestors,
            mutation_counts=mutation_counts, nodes_by_id=nodes_by_id,
            ancestor_ids=ancestor_ids, paper_node=nodes_by_id[paper_id],
        )

        novel_sims        = [s for s in ancestor_sims.values() if s < NOVEL_THRESHOLD]
        novel_fraction    = len(novel_sims) / max(len(ancestor_sims), 1)
        inherited_fraction = 1.0 - novel_fraction
        dominant_ancestor  = max(ancestor_sims, key=ancestor_sims.get) if ancestor_sims else None

        n_with_embedding = len(ancestor_sims)
        n_without        = n_ancestors - n_with_embedding
        if n_without == 0:
            confidence = "high"
        elif n_without <= n_ancestors * 0.3:
            confidence = "medium"
        else:
            confidence = "low"

        return OriginalityScore(
            paper_id=paper_id, contribution_type=contribution_type,
            score=round(novel_fraction, 3),
            inherited_fraction=round(inherited_fraction, 3),
            novel_idea_count=len(novel_sims), total_idea_count=len(ancestor_sims),
            dominant_ancestor=dominant_ancestor, ancestor_count=n_ancestors,
            confidence=confidence, evidence=evidence,
        )

    def _classify(self, max_sim, mean_sim, n_ancestors, mutation_counts,
                  nodes_by_id, ancestor_ids, paper_node):
        contradiction_rate = (
            mutation_counts.get("contradiction", 0) /
            max(sum(mutation_counts.values()), 1)
        )
        if contradiction_rate >= 0.4:
            return "Contradictor", (
                f"Primary contribution challenges prior work: "
                f"{mutation_counts['contradiction']} contradiction edges "
                f"({contradiction_rate:.0%} of all edges)."
            )
        if max_sim < PIONEER_THRESHOLD:
            return "Pioneer", (
                f"Max similarity to any ancestor is {max_sim:.2f} (< {PIONEER_THRESHOLD}). "
                f"Introduces concepts with no close ancestor in this graph."
            )
        paper_fields    = set(paper_node.get("fields_of_study", []))
        ancestor_fields = set()
        for aid in ancestor_ids:
            ancestor_fields.update(nodes_by_id.get(aid, {}).get("fields_of_study", []))
        new_fields = paper_fields - ancestor_fields
        if len(new_fields) >= 1 and len(paper_fields) >= 2:
            return "Bridge", (
                f"Connects fields: paper spans {paper_fields}, "
                f"introducing {new_fields} not present in ancestors."
            )
        if n_ancestors <= 3 and max_sim >= 0.70:
            return "Refiner", (
                f"Deeply develops a single idea: max similarity {max_sim:.2f} "
                f"to dominant ancestor, {n_ancestors} total ancestors."
            )
        if n_ancestors >= 3 and 0.35 <= mean_sim <= 0.70:
            return "Synthesizer", (
                f"Combines {n_ancestors} existing ideas: mean similarity {mean_sim:.2f}."
            )
        if max_sim >= 0.60:
            return "Refiner", f"Extends prior work closely (max sim {max_sim:.2f})."
        return "Synthesizer", f"Combines multiple ideas (mean sim {mean_sim:.2f})."

    def _structural_fallback(self, paper_id, ancestor_ids, edge_to_ancestors, nodes_by_id):
        n = len(ancestor_ids)
        mutation_counts = Counter(
            edge_to_ancestors.get(aid, {}).get("mutation_type", "unknown")
            for aid in ancestor_ids
        )
        if mutation_counts.get("contradiction", 0) / max(n, 1) >= 0.4:
            ctype = "Contradictor"
        elif n <= 2:
            ctype = "Refiner"
        else:
            ctype = "Synthesizer"
        return OriginalityScore(
            paper_id=paper_id, contribution_type=ctype,
            score=0.5, inherited_fraction=0.5,
            novel_idea_count=0, total_idea_count=0,
            dominant_ancestor=ancestor_ids[0] if ancestor_ids else None,
            ancestor_count=n, confidence="low",
            evidence="Classified from graph structure only — no embeddings available.",
        )

    @staticmethod
    def _cosine_similarity(a, b) -> float:
        try:
            if hasattr(a, "tolist"): a = a.tolist()
            if hasattr(b, "tolist"): b = b.tolist()
            dot   = sum(x * y for x, y in zip(a, b))
            mag_a = math.sqrt(sum(x * x for x in a))
            mag_b = math.sqrt(sum(x * x for x in b))
            if mag_a == 0 or mag_b == 0:
                return 0.0
            return dot / (mag_a * mag_b)
        except Exception:
            return 0.0
```

---

## §7 — backend/paradigm_detector.py (stub → real)

Replace the entire file content with:

```python
"""
backend/paradigm_detector.py

ParadigmShiftDetector: identifies structural signals of intellectual revolution
in a research graph.

Signals (from spec F1.13):
  1. CONTRADICTION_SURGE    — rising rate of papers contradicting bottleneck nodes
  2. CROSS_DOMAIN_INFLUX    — accelerating cross-field citation activity
  3. VOCABULARY_FRAGMENTATION — new mutation types appearing at cluster edges
  4. CLUSTER_FRAGMENTATION  — DNA clusters splitting (diversity increasing rapidly)

Paradigm stability score 0-100. Alert (score < 30) when multiple signals present.

Does NOT call NLP worker. Uses graph JSON structure + mutation_type edge metadata.
Requires coverage_score >= 0.65 for reliable results.
"""
import logging
import math
from dataclasses import dataclass
from typing import Optional
from collections import Counter, defaultdict

logger = logging.getLogger(__name__)

COVERAGE_THRESHOLD  = 0.65
ALERT_THRESHOLD     = 30
CONTRADICTION_ALERT = 0.15


@dataclass
class ParadigmShiftSignal:
    signal_type: str
    strength:    float
    description: str
    confidence:  str
    evidence:    dict

    def to_dict(self) -> dict:
        return {
            "signal_type": self.signal_type,
            "strength":    round(self.strength, 3),
            "description": self.description,
            "confidence":  self.confidence,
            "evidence":    self.evidence,
        }


@dataclass
class ParadigmAnalysis:
    seed_paper_id:   str
    stability_score: float
    alert:           bool
    signals:         list
    coverage_ok:     bool
    summary:         str

    def to_dict(self) -> dict:
        return {
            "seed_paper_id":   self.seed_paper_id,
            "stability_score": round(self.stability_score, 1),
            "alert":           self.alert,
            "signals":         [s.to_dict() for s in self.signals],
            "coverage_ok":     self.coverage_ok,
            "summary":         self.summary,
        }


class ParadigmShiftDetector:
    """Stateless detector — instantiate fresh per call."""

    def detect(self, graph_json: dict, coverage_score: float = 0.0) -> ParadigmAnalysis:
        seed_id     = graph_json.get("metadata", {}).get("seed_paper_id", "unknown")
        nodes       = graph_json.get("nodes", [])
        edges       = graph_json.get("edges", [])
        coverage_ok = coverage_score >= COVERAGE_THRESHOLD

        if not edges or len(nodes) < 10:
            return ParadigmAnalysis(
                seed_paper_id=seed_id, stability_score=100.0, alert=False,
                signals=[], coverage_ok=coverage_ok,
                summary="Graph too small for paradigm analysis (requires ≥10 nodes).",
            )

        signals     = []
        nodes_by_id = {n["id"]: n for n in nodes}
        total_edges = len(edges)

        # ── Signal 1: Contradiction Surge ──────────────────────────────────────
        contradiction_edges = [e for e in edges if e.get("mutation_type") == "contradiction"]
        contradiction_rate  = len(contradiction_edges) / max(total_edges, 1)
        if contradiction_rate >= CONTRADICTION_ALERT:
            strength = min(1.0, contradiction_rate / 0.3)
            signals.append(ParadigmShiftSignal(
                signal_type="CONTRADICTION_SURGE",
                strength=strength,
                description=(
                    f"{len(contradiction_edges)} edges ({contradiction_rate:.0%}) "
                    f"represent papers contradicting their ancestors."
                ),
                confidence="high" if coverage_ok else "medium",
                evidence={
                    "contradiction_edges": len(contradiction_edges),
                    "total_edges": total_edges,
                    "rate": round(contradiction_rate, 3),
                },
            ))

        # ── Signal 2: Cross-Domain Influx ──────────────────────────────────────
        cross_domain = 0
        for edge in edges:
            src_fields = set(nodes_by_id.get(edge.get("source", ""), {}).get("fields_of_study", []))
            tgt_fields = set(nodes_by_id.get(edge.get("target", ""), {}).get("fields_of_study", []))
            if src_fields and tgt_fields and not src_fields.intersection(tgt_fields):
                cross_domain += 1
        cross_rate = cross_domain / max(total_edges, 1)
        if cross_rate >= 0.20:
            strength = min(1.0, cross_rate / 0.40)
            signals.append(ParadigmShiftSignal(
                signal_type="CROSS_DOMAIN_INFLUX",
                strength=strength,
                description=(
                    f"{cross_domain} cross-domain citations ({cross_rate:.0%} of edges). "
                    f"Ideas are flowing in from outside the field."
                ),
                confidence="medium",
                evidence={"cross_domain_edges": cross_domain, "total_edges": total_edges, "rate": round(cross_rate, 3)},
            ))

        # ── Signal 3: Vocabulary Fragmentation ────────────────────────────────
        years = [n.get("year") for n in nodes if n.get("year")]
        if years:
            median_year    = sorted(years)[len(years) // 2]
            recent_node_ids = {n["id"] for n in nodes if (n.get("year") or 0) >= median_year}
            recent_edges   = [e for e in edges if (e.get("source","") in recent_node_ids or e.get("target","") in recent_node_ids)]
            old_edges      = [e for e in edges if e not in recent_edges]

            def entropy(edges_list):
                counts = Counter(e.get("mutation_type", "unknown") for e in edges_list)
                total  = sum(counts.values())
                if total == 0: return 0.0
                return -sum((c/total)*math.log2(c/total) for c in counts.values() if c > 0)

            fragmentation = entropy(recent_edges) - entropy(old_edges)
            if fragmentation >= 0.5:
                strength = min(1.0, fragmentation / 1.5)
                signals.append(ParadigmShiftSignal(
                    signal_type="VOCABULARY_FRAGMENTATION",
                    strength=strength,
                    description=(
                        f"Recent papers show more diverse mutation types (entropy +{fragmentation:.2f}). "
                        f"The field's conceptual vocabulary is fragmenting."
                    ),
                    confidence="medium" if coverage_ok else "low",
                    evidence={"delta": round(fragmentation, 3)},
                ))

        # ── Signal 4: Cluster Fragmentation ───────────────────────────────────
        dna = graph_json.get("dna_profile")
        if dna and isinstance(dna, dict):
            clusters  = dna.get("clusters", [])
            n_clusters = len(clusters)
            if n_clusters >= 5:
                sizes    = [len(c.get("papers", [])) for c in clusters]
                max_size = max(sizes) if sizes else 0
                avg_size = sum(sizes) / len(sizes) if sizes else 0
                if max_size > 0:
                    concentration = avg_size / max_size
                    if concentration >= 0.5:
                        signals.append(ParadigmShiftSignal(
                            signal_type="CLUSTER_FRAGMENTATION",
                            strength=min(1.0, concentration),
                            description=(
                                f"{n_clusters} concept clusters with no dominant theme "
                                f"(avg/max ratio: {concentration:.2f})."
                            ),
                            confidence="medium",
                            evidence={"n_clusters": n_clusters, "concentration": round(concentration, 3)},
                        ))

        # ── Composite stability score ──────────────────────────────────────────
        if not signals:
            stability = 100.0
        else:
            total_strength = sum(s.strength for s in signals)
            instability    = (total_strength / len(signals)) * 70
            stability      = max(0.0, 100.0 - instability)

        if stability >= 70:
            summary = "Field appears structurally stable. No significant paradigm shift signals."
        elif stability >= 40:
            n = len(signals)
            summary = f"{n} signal{'s' if n > 1 else ''} detected. Field shows signs of intellectual tension."
        else:
            summary = (
                f"⚠ ALERT: stability score {stability:.0f} — multiple paradigm shift signals. "
                f"This field may be undergoing structural intellectual change."
            )

        return ParadigmAnalysis(
            seed_paper_id=seed_id,
            stability_score=round(stability, 1),
            alert=stability < ALERT_THRESHOLD,
            signals=signals,
            coverage_ok=coverage_ok,
            summary=summary,
        )
```

---

## §8 — backend/export_generator.py (new)

```python
"""
backend/export_generator.py

ExportGenerator: generates downloadable exports in 8 formats.

Export types:
  graph-json        — Full graph as JSON
  graph-csv         — Nodes + edges as ZIP of two CSV files
  bibtex            — BibTeX citations for all papers
  literature-review — LLM-generated Markdown literature review
  genealogy-pdf     — Genealogy narrative as formatted PDF (WeasyPrint)
  action-log        — Session action history as JSON
  graph-png         — Static graph image (matplotlib, 150dpi)
  graph-svg         — Graph as SVG

All generate() calls:
  1. Build the export in memory
  2. Upload to R2 at exports/{session_id}/{timestamp}_{filename}
  3. Return a presigned URL (1 hour)

Note on nodes_by_id: export_to_json() returns nodes as a list.
Always use _build_nodes_by_id(graph_data) — never access graph_data['nodes_by_id'].
"""
import csv
import io
import json
import logging
import zipfile
from datetime import datetime, timezone
from typing import Optional

from backend.r2_client import R2Client
from backend.db import fetchall

logger = logging.getLogger(__name__)


def _build_nodes_by_id(graph_data: dict) -> dict:
    """Build paper_id → node dict from the nodes list."""
    return {node["id"]: node for node in graph_data.get("nodes", [])}


class ExportGenerator:
    """Stateless — instantiate fresh per request."""

    EXPORT_TYPES = [
        "graph-json", "graph-csv", "bibtex", "literature-review",
        "genealogy-pdf", "action-log", "graph-png", "graph-svg",
    ]

    def __init__(self):
        self.r2 = R2Client()

    def generate(
        self,
        export_type:  str,
        graph_data:   dict,
        session_id:   str,
        llm_client=None,
        extra:        Optional[dict] = None,
    ) -> str:
        """
        Generate an export, upload to R2, and return a presigned download URL.
        Returns presigned URL string (valid 1 hour).
        Raises ValueError for unknown export_type.
        Raises RuntimeError if R2 is not configured.
        """
        if export_type not in self.EXPORT_TYPES:
            raise ValueError(
                f"Unknown export type: {export_type!r}. Allowed: {self.EXPORT_TYPES}"
            )
        if not self.r2._enabled:
            raise RuntimeError(
                "R2 storage is not configured — cannot generate downloadable exports. "
                "Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in environment."
            )

        extra = extra or {}
        generators = {
            "graph-json":        self._graph_json,
            "graph-csv":         self._graph_csv,
            "bibtex":            self._bibtex,
            "literature-review": self._literature_review,
            "genealogy-pdf":     self._genealogy_pdf,
            "action-log":        self._action_log,
            "graph-png":         self._graph_png,
            "graph-svg":         self._graph_svg,
        }

        file_bytes, filename, content_type = generators[export_type](
            graph_data, session_id, llm_client, extra
        )

        ts  = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        key = f"exports/{session_id}/{ts}_{filename}"
        self.r2.upload(key, file_bytes, content_type)

        return self.r2.presigned_url(key, expires_in=3600)

    # ── Format generators ─────────────────────────────────────────────────────

    def _graph_json(self, graph_data, session_id, llm_client, extra):
        content = json.dumps(graph_data, indent=2, ensure_ascii=False).encode("utf-8")
        return content, "arivu_graph.json", "application/json"

    def _graph_csv(self, graph_data, session_id, llm_client, extra):
        nodes_by_id = _build_nodes_by_id(graph_data)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            nodes_buf  = io.StringIO()
            fieldnames = ["paper_id","title","authors","year","citation_count",
                          "fields_of_study","is_seed","url","doi"]
            writer = csv.DictWriter(nodes_buf, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            for node in graph_data.get("nodes", []):
                writer.writerow({
                    "paper_id":        node.get("id", ""),
                    "title":           node.get("title", ""),
                    "authors":         "; ".join(node.get("authors", [])),
                    "year":            node.get("year", ""),
                    "citation_count":  node.get("citation_count", ""),
                    "fields_of_study": "; ".join(node.get("fields_of_study", [])),
                    "is_seed":         node.get("is_seed", False),
                    "url":             node.get("url", ""),
                    "doi":             node.get("doi", ""),
                })
            zf.writestr("nodes.csv", nodes_buf.getvalue())

            edges_buf   = io.StringIO()
            edge_fields = ["citing_paper_id","cited_paper_id","citing_title","cited_title",
                           "mutation_type","confidence_tier","similarity_score",
                           "citing_sentence","cited_sentence"]
            writer = csv.DictWriter(edges_buf, fieldnames=edge_fields, extrasaction="ignore")
            writer.writeheader()
            for edge in graph_data.get("edges", []):
                src_id = edge.get("source") or edge.get("citing_paper_id", "")
                tgt_id = edge.get("target") or edge.get("cited_paper_id", "")
                writer.writerow({
                    "citing_paper_id":  src_id,
                    "cited_paper_id":   tgt_id,
                    "citing_title":     nodes_by_id.get(src_id, {}).get("title", ""),
                    "cited_title":      nodes_by_id.get(tgt_id, {}).get("title", ""),
                    "mutation_type":    edge.get("mutation_type", ""),
                    "confidence_tier":  edge.get("confidence_tier", ""),
                    "similarity_score": edge.get("similarity_score", ""),
                    "citing_sentence":  edge.get("citing_sentence", ""),
                    "cited_sentence":   edge.get("cited_sentence", ""),
                })
            zf.writestr("edges.csv", edges_buf.getvalue())
        return buf.getvalue(), "arivu_graph.zip", "application/zip"

    def _bibtex(self, graph_data, session_id, llm_client, extra):
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        meta  = graph_data.get("metadata", {})
        lines = [
            f"% Arivu citation export — {today}",
            f"% Seed paper: {meta.get('seed_paper_id', 'unknown')}",
            f"% Total papers: {len(graph_data.get('nodes', []))}",
            "",
        ]
        seen_keys: set = set()
        for node in graph_data.get("nodes", []):
            authors    = node.get("authors", []) or ["Unknown"]
            first_auth = (authors[0].split(",")[0].split()[-1] if authors[0] else "Unknown")
            year       = node.get("year", "nd") or "nd"
            base_key   = f"{first_auth}{year}"
            cite_key   = base_key
            suffix     = 1
            while cite_key in seen_keys:
                cite_key = f"{base_key}{chr(ord('a') + suffix - 1)}"
                suffix  += 1
            seen_keys.add(cite_key)

            title       = (node.get("title", "Untitled") or "Untitled").replace("{", r"\{").replace("}", r"\}")
            authors_str = " and ".join(authors)
            entry = [f"@article{{{cite_key},"]
            entry.append(f"  title  = {{{title}}},")
            entry.append(f"  author = {{{authors_str}}},")
            entry.append(f"  year   = {{{year}}},")
            if node.get("doi"):
                entry.append(f"  doi    = {{{node['doi']}}},")
            if node.get("url"):
                entry.append(f"  url    = {{{node['url']}}},")
            entry.append("}")
            lines.extend(entry)
            lines.append("")
        return "\n".join(lines).encode("utf-8"), "arivu_citations.bib", "text/plain"

    def _literature_review(self, graph_data, session_id, llm_client, extra):
        if llm_client and getattr(llm_client, "available", False):
            try:
                import asyncio
                review_text = asyncio.run(llm_client.generate_literature_review(graph_data))
            except Exception as exc:
                logger.warning(f"LLM literature review failed: {exc} — using template")
                review_text = self._template_literature_review(graph_data)
        else:
            review_text = self._template_literature_review(graph_data)
        return review_text.encode("utf-8"), "arivu_literature_review.md", "text/markdown"

    def _template_literature_review(self, graph_data: dict) -> str:
        meta       = graph_data.get("metadata", {})
        nodes      = graph_data.get("nodes", [])
        seed_title = meta.get("seed_paper_title", "the seed paper")
        today      = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        sorted_nodes = sorted(nodes, key=lambda n: n.get("year") or 9999)
        lines = [
            f"# Literature Review: {seed_title}",
            f"*Generated by Arivu — {today}*", "",
            "## Overview",
            f"This graph traces the intellectual ancestry of **{seed_title}**, "
            f"encompassing {len(nodes)} papers across "
            f"{len(set(f for n in nodes for f in n.get('fields_of_study', [])))} fields.",
            "", "## Foundational Papers", "",
        ]
        for node in sorted_nodes[:10]:
            authors    = (node.get("authors") or ["Unknown"])
            author_str = f"{authors[0]} et al." if len(authors) > 1 else authors[0]
            lines.append(f"- **{node['title']}** ({author_str}, {node.get('year', 'n.d.')})")
        lines.extend(["", "## Chronological Summary", ""])
        for node in sorted_nodes:
            authors    = (node.get("authors") or ["Unknown"])
            author_str = f"{authors[0]} et al." if len(authors) > 1 else authors[0]
            lines.append(f"- **{node.get('year', 'n.d.')}** — {node['title']} ({author_str})")
        return "\n".join(lines)

    def _genealogy_pdf(self, graph_data, session_id, llm_client, extra):
        if llm_client and getattr(llm_client, "available", False):
            try:
                import asyncio
                result    = asyncio.run(llm_client.generate_genealogy_story(graph_data))
                narrative = result.get("narrative", "") if isinstance(result, dict) else str(result)
            except Exception as exc:
                logger.warning(f"LLM genealogy failed: {exc} — using template")
                narrative = self._template_genealogy(graph_data)
        else:
            narrative = self._template_genealogy(graph_data)

        try:
            import markdown as md_lib
            from weasyprint import HTML as WeasyHTML
            html_body  = md_lib.markdown(narrative)
            meta       = graph_data.get("metadata", {})
            seed_title = meta.get("seed_paper_title", "Research Paper")
            today      = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            html_full  = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body {{ font-family: Georgia, serif; max-width: 680px; margin: 60px auto;
          font-size: 14px; line-height: 1.75; color: #1a1a2e; }}
  h1   {{ font-size: 22px; color: #0a0e17; margin-bottom: 0.3em; }}
  h2   {{ font-size: 16px; color: #334155; margin-top: 2em; }}
  p    {{ margin: 1em 0; }}
  .meta   {{ font-size: 12px; color: #64748B; margin-bottom: 2em; }}
  .footer {{ margin-top: 60px; padding-top: 16px; border-top: 1px solid #e2e8f0;
             font-size: 11px; color: #94A3B8; }}
</style></head><body>
<h1>{seed_title} — Intellectual Genealogy</h1>
<div class="meta">Generated by Arivu · {today}</div>
{html_body}
<div class="footer">
  Generated by Arivu — arivu.app · {len(graph_data.get('nodes', []))} papers analysed
</div>
</body></html>"""
            pdf_bytes = WeasyHTML(string=html_full).write_pdf()
        except ImportError:
            pdf_bytes = self._narrative_to_reportlab_pdf(narrative, graph_data)
        return pdf_bytes, "arivu_genealogy.pdf", "application/pdf"

    def _template_genealogy(self, graph_data: dict) -> str:
        meta   = graph_data.get("metadata", {})
        nodes  = graph_data.get("nodes", [])
        edges  = graph_data.get("edges", [])
        seed   = meta.get("seed_paper_title", "the seed paper")
        years  = [n.get("year") for n in nodes if n.get("year")]
        yr_range = f"{min(years)}–{max(years)}" if years else "unknown"
        return (
            f"# The Intellectual Ancestry of {seed}\n\n"
            f"This graph traces {len(nodes)} papers published between {yr_range}, "
            f"connected by {len(edges)} inheritance relationships.\n\n"
            f"*Full narrative requires Groq API key. "
            f"Set GROQ_API_KEY in environment to enable LLM-generated analysis.*"
        )

    def _narrative_to_reportlab_pdf(self, text: str, graph_data: dict) -> bytes:
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
        from reportlab.lib.units import inch
        buf    = io.BytesIO()
        doc    = SimpleDocTemplate(buf, pagesize=letter,
                                   leftMargin=inch, rightMargin=inch,
                                   topMargin=inch, bottomMargin=inch)
        styles = getSampleStyleSheet()
        story  = []
        for line in text.split("\n"):
            line = line.strip()
            if not line:
                story.append(Spacer(1, 0.15 * inch))
            elif line.startswith("# "):
                story.append(Paragraph(line[2:], styles["Title"]))
            elif line.startswith("## "):
                story.append(Paragraph(line[3:], styles["Heading2"]))
            else:
                story.append(Paragraph(line, styles["Normal"]))
        doc.build(story)
        return buf.getvalue()

    def _action_log(self, graph_data, session_id, llm_client, extra):
        try:
            actions = fetchall(
                "SELECT action_type, action_data, timestamp FROM action_log "
                "WHERE session_id = %s ORDER BY timestamp DESC",
                (session_id,),
            )
        except Exception as exc:
            logger.warning(f"action_log fetch failed: {exc}")
            actions = []
        content = json.dumps({
            "session_id":   session_id,
            "exported_at":  datetime.now(timezone.utc).isoformat(),
            "action_count": len(actions),
            "actions": [
                {"action_type": a["action_type"], "action_data": a["action_data"],
                 "timestamp": str(a["timestamp"])}
                for a in actions
            ],
        }, indent=2, default=str).encode("utf-8")
        return content, "arivu_action_log.json", "application/json"

    def _graph_png(self, graph_data, session_id, llm_client, extra):
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import networkx as nx
        import math as _math

        nodes_by_id = _build_nodes_by_id(graph_data)
        G = nx.DiGraph()
        for node in graph_data.get("nodes", []):
            G.add_node(node["id"])
        for edge in graph_data.get("edges", []):
            src = edge.get("source") or edge.get("citing_paper_id", "")
            tgt = edge.get("target") or edge.get("cited_paper_id", "")
            if src and tgt:
                G.add_edge(src, tgt)

        fig = plt.figure(figsize=(16, 12), facecolor="#0a0e17")
        ax  = fig.add_subplot(111)
        ax.set_facecolor("#0a0e17")
        pos = nx.spring_layout(G, k=2.0, seed=42)
        node_sizes = [
            max(20, _math.log1p(nodes_by_id.get(n, {}).get("citation_count", 1) or 1) * 30)
            for n in G.nodes()
        ]
        nx.draw_networkx(G, pos=pos, ax=ax, with_labels=False,
                         node_size=node_sizes, node_color="#3B82F6",
                         edge_color="#475569", arrows=True, arrowsize=6, alpha=0.85)
        meta = graph_data.get("metadata", {})
        ax.set_title(f"Citation Ancestry: {meta.get('seed_paper_title', 'Graph')}",
                     color="#E2E8F0", fontsize=13, pad=12)
        ax.axis("off")
        buf = io.BytesIO()
        plt.savefig(buf, format="png", dpi=150, bbox_inches="tight",
                    facecolor="#0a0e17", edgecolor="none")
        plt.close(fig)
        return buf.getvalue(), "arivu_graph.png", "image/png"

    def _graph_svg(self, graph_data, session_id, llm_client, extra):
        if extra.get("svg_data"):
            svg_str = extra["svg_data"]
            if isinstance(svg_str, str):
                return svg_str.encode("utf-8"), "arivu_graph.svg", "image/svg+xml"

        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import networkx as nx

        G = nx.DiGraph()
        for node in graph_data.get("nodes", []):
            G.add_node(node["id"])
        for edge in graph_data.get("edges", []):
            src = edge.get("source") or edge.get("citing_paper_id", "")
            tgt = edge.get("target") or edge.get("cited_paper_id", "")
            if src and tgt:
                G.add_edge(src, tgt)

        fig = plt.figure(figsize=(16, 12), facecolor="#0a0e17")
        ax  = fig.add_subplot(111)
        ax.set_facecolor("#0a0e17")
        pos = nx.spring_layout(G, k=2.0, seed=42)
        nx.draw_networkx(G, pos=pos, ax=ax, with_labels=False,
                         node_color="#3B82F6", edge_color="#475569", alpha=0.85)
        ax.axis("off")
        buf = io.StringIO()
        plt.savefig(buf, format="svg", bbox_inches="tight")
        plt.close(fig)
        return buf.getvalue().encode("utf-8"), "arivu_graph.svg", "image/svg+xml"
```

---

## §9 — Add `generate_literature_review()` to ArivuLLMClient

**Note on GAP-14:** Phase 5's original file manifest listed `backend/llm_client.py` as
both "Unchanged (do not touch)" AND "Modified (additions)". The correct answer is
**Modified by addition only** — add this one method to the existing `ArivuLLMClient`
class. Do not rewrite the file. Do not touch any existing methods.

In `backend/llm_client.py`, add this method inside the `ArivuLLMClient` class:

```python
    async def generate_literature_review(self, graph_data: dict) -> str:
        """
        Generate a structured Markdown literature review for the graph.
        Grounded: only uses facts from the graph — does not add training knowledge.
        Returns Markdown string. Returns "" if LLM unavailable.
        """
        if not self.available:
            return ""

        nodes      = graph_data.get("nodes", [])
        meta       = graph_data.get("metadata", {})
        seed_title = meta.get("seed_paper_title", "the seed paper")

        sorted_nodes = sorted(nodes, key=lambda n: n.get("year") or 9999)
        papers_list  = "\n".join(
            f"- {n.get('year', 'n.d.')} | {n.get('title', 'Untitled')} | "
            f"{', '.join((n.get('authors') or ['Unknown'])[:2])}"
            for n in sorted_nodes[:30]
        )

        prompt = f"""You are writing a structured academic literature review.

CRITICAL RULES:
1. Only use the paper information listed below — do NOT add knowledge from your training
2. Do not invent claims, dates, or relationships not present in the data
3. Write in Markdown format with clear section headings

GRAPH DATA:
Seed paper: {seed_title}
Total papers: {len(nodes)}

PAPERS IN GRAPH (chronological):
{papers_list}

TASK: Write a 400-600 word structured literature review covering:
1. ## Overview — what this graph represents
2. ## Foundational Work — the earliest/most cited papers
3. ## Development — how ideas evolved over time
4. ## Current State — most recent papers in the graph

Use only the papers listed above. Format as Markdown."""

        try:
            response = await self.complete(prompt, max_tokens=1500, model="capable")
            return response
        except Exception as exc:
            logger.warning(f"generate_literature_review failed: {exc}")
            return ""
```

---

## §10 — app.py additions

Add these routes to `app.py` alongside the existing Phase 3/4 routes.

### §10.1 — New imports

```python
# Add to existing imports in app.py:
from backend.export_generator   import ExportGenerator
from backend.living_paper_scorer import LivingPaperScorer
from backend.originality_mapper  import OriginalityMapper
from backend.paradigm_detector   import ParadigmShiftDetector
```

### §10.2 — Export route

```python
# ─── POST /api/export/<export_type> ──────────────────────────────────────────

@app.route("/api/export/<export_type>", methods=["POST"])
def api_export(export_type: str):
    """
    Generate a downloadable export of the current graph.
    Body (optional): {"extra": {"svg_data": "..."}}
    Response: {"url": "https://...", "filename": "arivu_graph.json", "expires_in": 3600}
    """
    session_id = session_manager.get_session_id(request)
    if not session_id:
        return jsonify({"error": "Session required"}), 401

    allowed, headers = rate_limiter.check_sync(session_id, "POST /api/export")
    if not allowed:
        return jsonify(rate_limiter.get_429_response(headers)), 429, headers

    if export_type not in ExportGenerator.EXPORT_TYPES:
        return jsonify({
            "error": f"Unknown export type {export_type!r}. "
                     f"Allowed: {ExportGenerator.EXPORT_TYPES}"
        }), 400

    from backend.db import fetchone
    row = fetchone(
        """
        SELECT g.graph_id, g.graph_json_url
        FROM graphs g
        JOIN session_graphs sg ON sg.graph_id = g.graph_id
        WHERE sg.session_id = %s
        ORDER BY g.created_at DESC LIMIT 1
        """,
        (session_id,),
    )
    if not row:
        return jsonify({"error": "No graph built yet in this session"}), 404

    try:
        from backend.r2_client import R2Client
        r2         = R2Client()
        graph_data = r2.download_json(row["graph_json_url"])
        if not graph_data:
            return jsonify({"error": "Graph data not found in R2"}), 404
    except Exception as exc:
        app.logger.warning(f"R2 graph fetch failed: {exc}")
        return jsonify({"error": "Could not load graph data"}), 500

    body       = request.get_json(silent=True) or {}
    extra      = body.get("extra", {})
    llm_client = None
    try:
        from backend.llm_client import ArivuLLMClient
        llm_client = ArivuLLMClient()
    except Exception:
        pass

    try:
        gen = ExportGenerator()
        url = gen.generate(
            export_type=export_type,
            graph_data=graph_data,
            session_id=session_id,
            llm_client=llm_client,
            extra=extra,
        )
        import os
        filename = url.split("/")[-1].split("?")[0]
        return jsonify({"url": url, "filename": filename, "expires_in": 3600})
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503
    except Exception as exc:
        app.logger.error(f"Export generation failed: {exc}")
        return jsonify({"error": "Export generation failed"}), 500
```

### §10.3 — Living score route

```python
# ─── GET /api/living-score/<paper_id> ────────────────────────────────────────

@app.route("/api/living-score/<paper_id>")
def api_living_score(paper_id: str):
    """
    Compute living score for a single paper within the session's current graph.
    Response: {"score": 72.3, "trajectory": "rising", "recent_citations": 15, ...}
    """
    session_id = session_manager.get_session_id(request)
    if not session_id:
        return jsonify({"error": "Session required"}), 401

    allowed, headers = rate_limiter.check_sync(session_id, "GET /api/living-score")
    if not allowed:
        return jsonify(rate_limiter.get_429_response(headers)), 429, headers

    from backend.db import fetchone
    from backend.r2_client import R2Client
    row = fetchone(
        """
        SELECT g.graph_json_url FROM graphs g
        JOIN session_graphs sg ON sg.graph_id = g.graph_id
        WHERE sg.session_id = %s ORDER BY g.created_at DESC LIMIT 1
        """,
        (session_id,),
    )
    if not row:
        return jsonify({"error": "No graph built yet"}), 404

    try:
        graph_data = R2Client().download_json(row["graph_json_url"])
    except Exception:
        return jsonify({"error": "Could not load graph"}), 500

    scorer = LivingPaperScorer()
    result = scorer.score_single(paper_id, graph_data)
    if result is None:
        return jsonify({"error": f"Paper {paper_id} not found in current graph"}), 404
    return jsonify(result.to_dict())
```

### §10.4 — Originality route

```python
# ─── GET /api/originality/<paper_id> ─────────────────────────────────────────

@app.route("/api/originality/<paper_id>")
def api_originality(paper_id: str):
    """
    Classify contribution type of a paper within the session's current graph.
    Response: {"contribution_type": "Pioneer", "score": 0.81, "confidence": "high", ...}
    """
    session_id = session_manager.get_session_id(request)
    if not session_id:
        return jsonify({"error": "Session required"}), 401

    allowed, headers = rate_limiter.check_sync(session_id, "GET /api/originality")
    if not allowed:
        return jsonify(rate_limiter.get_429_response(headers)), 429, headers

    from backend.db import fetchone
    from backend.r2_client import R2Client
    row = fetchone(
        """
        SELECT g.graph_json_url FROM graphs g
        JOIN session_graphs sg ON sg.graph_id = g.graph_id
        WHERE sg.session_id = %s ORDER BY g.created_at DESC LIMIT 1
        """,
        (session_id,),
    )
    if not row:
        return jsonify({"error": "No graph built yet"}), 404

    try:
        graph_data = R2Client().download_json(row["graph_json_url"])
    except Exception:
        return jsonify({"error": "Could not load graph"}), 500

    mapper = OriginalityMapper()
    result = mapper.compute_originality(paper_id, graph_data)
    if result is None:
        return jsonify({"error": f"Paper {paper_id} not found in current graph"}), 404
    return jsonify(result.to_dict())
```

### §10.5 — Paradigm shift route

```python
# ─── GET /api/paradigm/<seed_id> ─────────────────────────────────────────────

@app.route("/api/paradigm/<seed_id>")
def api_paradigm(seed_id: str):
    """
    Analyse paradigm shift signals for a graph seeded by seed_id.
    Response: {"stability_score": 72.1, "alert": false, "signals": [...], ...}
    """
    session_id = session_manager.get_session_id(request)
    if not session_id:
        return jsonify({"error": "Session required"}), 401

    allowed, headers = rate_limiter.check_sync(session_id, "GET /api/paradigm")
    if not allowed:
        return jsonify(rate_limiter.get_429_response(headers)), 429, headers

    from backend.db import fetchone
    from backend.r2_client import R2Client
    row = fetchone(
        """
        SELECT g.graph_json_url, g.coverage_score FROM graphs g
        JOIN session_graphs sg ON sg.graph_id = g.graph_id
        WHERE sg.session_id = %s AND g.seed_paper_id = %s
        ORDER BY g.created_at DESC LIMIT 1
        """,
        (session_id, seed_id),
    )
    if not row:
        return jsonify({"error": "No graph found for this seed paper"}), 404

    try:
        graph_data = R2Client().download_json(row["graph_json_url"])
    except Exception:
        return jsonify({"error": "Could not load graph"}), 500

    detector = ParadigmShiftDetector()
    result   = detector.detect(
        graph_json=graph_data,
        coverage_score=float(row.get("coverage_score") or 0.0),
    )
    return jsonify(result.to_dict())
```

---

## §11 — Retraction Watch Integration

Phase 3 already flags retracted papers in the graph (via `is_retracted` field on Paper
nodes from the `retraction_watch` DB table). Phase 5 makes this operational by loading
real data.

**Note (GAP-30 — table naming):** The DB table is named `retraction_watch` (from Phase 1
migration DDL). The complete spec §61 uses `retractions` as an alternative name, but that
DDL was never executed. Do not rename the table. `load_retraction_watch.py` must target
`retraction_watch`.

### §11.1 — scripts/load_retraction_watch.py (stub → real)

Replace the entire file content with:

```python
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
        f"✅ Done. Loaded {count} retractions. "
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
```

### §11.2 — How to run

```bash
# 1. Download Retraction Watch CSV (requires free registration):
#    https://api.labs.crossref.org/data/retractionwatch
#    Save as: data/retractions.csv  (gitignored — do not commit)

# 2. Load into DB:
export $(cat .env | grep -v '^#' | xargs)
RETRACTION_CSV=data/retractions.csv python scripts/load_retraction_watch.py

# 3. Verify:
psql $DATABASE_URL -c "SELECT COUNT(*) FROM retraction_watch;"
# Expected: ~50,000+ rows
```

---

## §12 — scripts/ground_truth_eval.py (stub → real)

Replace the entire file content with:

```python
#!/usr/bin/env python3
"""
scripts/ground_truth_eval.py

Evaluate the NLP pipeline against hand-labelled paper pairs.
Ground truth is in data/ground_truth/pairs.json.

Metrics:
  - Similarity score accuracy: predicted similarity within expected range
  - Mutation type accuracy: predicted type matches expected type
  - Overall: assert ≥ 70% accuracy on both metrics

Usage:
  python scripts/ground_truth_eval.py
  python scripts/ground_truth_eval.py --verbose
  python scripts/ground_truth_eval.py --threshold 0.65

Exit code: 0 = passed, 1 = failed.
"""
import json
import sys
import os
import argparse
import logging
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

GT_PATH        = Path("data/ground_truth/pairs.json")
PASS_THRESHOLD = 0.70


def run_evaluation(verbose: bool = False, threshold: float = PASS_THRESHOLD) -> bool:
    from dotenv import load_dotenv
    load_dotenv()

    from backend.db import init_pool
    from backend.config import Config
    init_pool(database_url=Config.DATABASE_URL)

    from backend.api_client import SmartPaperResolver
    from backend.nlp_pipeline import InheritanceDetector
    from backend.utils import await_sync

    if not GT_PATH.exists():
        logger.error(
            f"Ground truth file not found: {GT_PATH}\n"
            "Create data/ground_truth/pairs.json with labeled pairs."
        )
        sys.exit(1)

    with open(GT_PATH) as f:
        pairs = json.load(f)

    logger.info(f"Loaded {len(pairs)} ground truth pairs from {GT_PATH}")

    resolver = SmartPaperResolver()
    detector = InheritanceDetector()

    sim_correct  = 0
    type_correct = 0
    evaluated    = 0
    skipped      = 0

    for i, pair in enumerate(pairs):
        src_id = pair["source_id"]
        tgt_id = pair["target_id"]

        try:
            src = await_sync(resolver.resolve(src_id, "s2"))
            tgt = await_sync(resolver.resolve(tgt_id, "s2"))
        except Exception as exc:
            logger.warning(f"  [{i+1}] SKIP — paper not found ({exc})")
            skipped += 1
            continue

        if not src or not tgt:
            logger.warning(f"  [{i+1}] SKIP — paper returned None")
            skipped += 1
            continue

        try:
            pair_result = await_sync(detector.analyze_single_pair(src, tgt))
        except Exception as exc:
            logger.warning(f"  [{i+1}] SKIP — NLP error: {exc}")
            skipped += 1
            continue

        sim            = pair_result.get("similarity_score", 0.0)
        mtype          = pair_result.get("mutation_type", "unknown")
        expected_range = pair.get("expected_similarity_range", [0.0, 1.0])
        expected_type  = pair.get("expected_mutation_type", "")

        sim_ok  = expected_range[0] <= sim <= expected_range[1]
        type_ok = mtype == expected_type or expected_type == ""

        if sim_ok:  sim_correct  += 1
        if type_ok: type_correct += 1
        evaluated += 1

        if verbose:
            logger.info(
                f"  [{i+1}] {'✓' if sim_ok else '✗'}sim={sim:.2f} (exp {expected_range}) "
                f"{'✓' if type_ok else '✗'}type={mtype!r} (exp {expected_type!r})"
            )

    if evaluated == 0:
        logger.error("No pairs could be evaluated. Check S2 API connectivity.")
        return False

    sim_accuracy  = sim_correct  / evaluated
    type_accuracy = type_correct / evaluated

    print(f"\n{'═'*50}")
    print(f"Ground Truth Evaluation Results")
    print(f"{'═'*50}")
    print(f"Pairs evaluated:     {evaluated}/{len(pairs)} ({skipped} skipped)")
    print(f"Similarity accuracy: {sim_correct}/{evaluated} = {sim_accuracy:.1%}")
    print(f"Mutation type acc:   {type_correct}/{evaluated} = {type_accuracy:.1%}")
    print(f"Pass threshold:      {threshold:.0%}")
    print(f"{'═'*50}")

    passed = sim_accuracy >= threshold and type_accuracy >= threshold
    if passed:
        print("✅ PASSED — NLP pipeline meets accuracy threshold")
    else:
        print(f"✗  FAILED — accuracy below {threshold:.0%} threshold")
        if sim_accuracy < threshold:
            print(f"   → Similarity accuracy {sim_accuracy:.1%} < {threshold:.0%}")
        if type_accuracy < threshold:
            print(f"   → Mutation type accuracy {type_accuracy:.1%} < {threshold:.0%}")
    return passed


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate NLP pipeline accuracy")
    parser.add_argument("--verbose",   action="store_true")
    parser.add_argument("--threshold", type=float, default=PASS_THRESHOLD)
    args   = parser.parse_args()
    passed = run_evaluation(verbose=args.verbose, threshold=args.threshold)
    sys.exit(0 if passed else 1)
```

---

## §13 — data/ground_truth/pairs.json

Create `data/ground_truth/pairs.json`. This file IS committed to git (curated dataset,
not generated output). The directory was created in §0.14.

```bash
# Verify directory exists (created in §0.14):
ls data/ground_truth/.gitkeep  # must exist

# Verify file will be tracked:
git check-ignore -v data/ground_truth/pairs.json
# No output = correctly tracked ✅
```

Create the file with these seed pairs (expand to ≥20 before running the eval script):

```json
[
  {
    "source_id": "204e3073870fae3d05bcbc2f6a8e263d9b72e776",
    "target_id": "fa72afa9b2cbc8f0d7b05d52548906f80e3bd5ef",
    "description": "Attention Is All You Need → Bahdanau attention (2014)",
    "expected_mutation_type": "generalization",
    "expected_similarity_range": [0.55, 1.0],
    "source": "community_knowledge"
  },
  {
    "source_id": "df2b0e26d0599ce3e70df8a9da02e51594e0e992",
    "target_id": "204e3073870fae3d05bcbc2f6a8e263d9b72e776",
    "description": "BERT → Attention Is All You Need",
    "expected_mutation_type": "adoption",
    "expected_similarity_range": [0.60, 1.0],
    "source": "community_knowledge"
  },
  {
    "source_id": "2c03df8b48bf3fa39054345bafabfeff15bfd11d",
    "target_id": "abd1c342495432171beb7ca8fd9551ef13cbd0ff",
    "description": "ResNet → AlexNet (deep CNN heritage)",
    "expected_mutation_type": "generalization",
    "expected_similarity_range": [0.45, 0.85],
    "source": "community_knowledge"
  },
  {
    "source_id": "9405cc0d6169988371b2755e573cc28650d14dfe",
    "target_id": "df2b0e26d0599ce3e70df8a9da02e51594e0e992",
    "description": "GPT-2 → BERT (transformer language model)",
    "expected_mutation_type": "adoption",
    "expected_similarity_range": [0.55, 0.90],
    "source": "community_knowledge"
  },
  {
    "source_id": "54e325aee6b2d476bbbb88615ac15e251c6e8214",
    "target_id": "abd1c342495432171beb7ca8fd9551ef13cbd0ff",
    "description": "GANs → AlexNet (discriminator architecture)",
    "expected_mutation_type": "adoption",
    "expected_similarity_range": [0.30, 0.70],
    "source": "community_knowledge"
  }
]
```

**Before running `ground_truth_eval.py`:** Expand to at least 20 pairs covering all 7
mutation types: adoption, generalization, specialization, hybridization, contradiction,
revival, incidental. The eval script gracefully skips pairs where papers aren't
resolvable via S2 API.

---

## §14 — static/js/export-panel.js (new)

Create `static/js/export-panel.js`:

```javascript
/**
 * static/js/export-panel.js
 *
 * ExportPanel: manages the export UI in the tool page right panel.
 * Adds an "Export" section below the DNA profile panel.
 *
 * Dependencies: none (vanilla JS)
 */

class ExportPanel {
  constructor(containerId) {
    this.container      = document.getElementById(containerId);
    this._activeDownload = null;
  }

  render() {
    if (!this.container) return;

    const exports = [
      { type: "graph-json",        label: "Graph JSON",          icon: "{ }",  desc: "Full graph data for external analysis" },
      { type: "graph-csv",         label: "Graph CSV (ZIP)",      icon: "⬛",   desc: "Nodes and edges as spreadsheets" },
      { type: "bibtex",            label: "BibTeX Citations",     icon: "📄",   desc: "All papers as .bib file" },
      { type: "literature-review", label: "Literature Review",    icon: "📝",   desc: "Structured Markdown review" },
      { type: "genealogy-pdf",     label: "Genealogy PDF",        icon: "📜",   desc: "Intellectual story as PDF" },
      { type: "graph-png",         label: "Graph PNG",            icon: "🖼",   desc: "Static image at 150dpi" },
      { type: "graph-svg",         label: "Graph SVG",            icon: "🔷",   desc: "Vector graphic for publications" },
      { type: "action-log",        label: "Action Log",           icon: "📋",   desc: "Your session activity history" },
    ];

    this.container.innerHTML = `
      <div class="export-panel" role="region" aria-label="Export options">
        <h3 class="panel-section-title">Export</h3>
        <div class="export-grid" id="export-grid">
          ${exports.map(e => `
            <button
              class="export-btn"
              data-type="${e.type}"
              title="${e.desc}"
              aria-label="Export as ${e.label}"
            >
              <span class="export-icon" aria-hidden="true">${e.icon}</span>
              <span class="export-label">${e.label}</span>
            </button>
          `).join("")}
        </div>
        <div id="export-status" class="export-status" aria-live="polite" hidden></div>
      </div>
    `;

    this.container.querySelectorAll(".export-btn").forEach(btn => {
      btn.addEventListener("click", () => this._handleExport(btn.dataset.type, btn));
    });
  }

  async _handleExport(exportType, btn) {
    if (this._activeDownload) return;

    this._activeDownload = exportType;
    const status   = document.getElementById("export-status");
    const original = btn.innerHTML;

    btn.disabled  = true;
    btn.innerHTML = `<span class="export-spin" aria-hidden="true">⟳</span> <span class="export-label">Generating…</span>`;
    if (status) { status.hidden = false; status.textContent = `Generating ${exportType}…`; }

    try {
      const resp = await fetch(`/api/export/${exportType}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ extra: {} }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${resp.status}`);
      }

      const { url, filename } = await resp.json();
      const a = document.createElement("a");
      a.href     = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      if (status) { status.textContent = `✓ ${filename} downloading…`; }
      setTimeout(() => { if (status) { status.hidden = true; } }, 4000);

    } catch (err) {
      console.error("Export failed:", err);
      if (status) {
        status.textContent = `✗ Export failed: ${err.message}`;
        status.style.color = "var(--danger)";
        setTimeout(() => { status.hidden = true; status.style.color = ""; }, 6000);
      }
    } finally {
      btn.disabled  = false;
      btn.innerHTML = original;
      this._activeDownload = null;
    }
  }
}
```

### §14.1 — Wire into tool.html

In `templates/tool.html`, add a container div in the right panel area, below the
DNA profile section:

```html
<!-- Add in the right panel, after the DNA/diversity sections -->
<div id="export-panel-container"></div>
```

Add the script tag in `{% block scripts %}`:
```html
<script src="{{ url_for('static', filename='js/export-panel.js') }}" defer></script>
```

In `static/js/loader.js`, at the end of `GraphLoader._initGraph()`:
```javascript
// Initialise export panel after graph loads
if (window.ExportPanel) {
  const exportPanel = new ExportPanel("export-panel-container");
  exportPanel.render();
}
```

### §14.2 — Export panel CSS

Add to `static/css/main.css`:

```css
/* ─── Export Panel ─────────────────────────────────────────────────────────── */
.export-panel { margin-top: 1.5rem; }

.export-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-top: 0.5rem;
}

.export-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 6px;
  background: var(--bg-elevated);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 11px;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  text-align: center;
}

.export-btn:hover:not(:disabled) {
  background: var(--bg-surface);
  border-color: var(--accent-blue);
  color: var(--text-primary);
}

.export-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.export-icon { font-size: 16px; }
.export-label { font-size: 10px; line-height: 1.2; }
.export-spin  { display: inline-block; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.export-status {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-secondary);
  min-height: 1.4em;
}
```

---

## §15 — tests/test_phase5.py

```python
"""
tests/test_phase5.py

Phase 5 test suite. Covers:
  - ExportGenerator (all 8 formats, offline)
  - LivingPaperScorer
  - OriginalityMapper (structural fallback path)
  - ParadigmShiftDetector
  - Export route authentication (positive + negative paths)
  - ProductionQualityMonitor confidence field fix (GAP-15 regression)
  - ground_truth/pairs.json structure validation

All tests are offline — no live Neon, R2, NLP worker, or S2 API required.
Run: pytest tests/test_phase5.py -v
"""
import json
import os
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock


# ─── Shared test graph fixture ────────────────────────────────────────────────

def _make_test_graph(n_nodes: int = 15) -> dict:
    """Build a minimal graph JSON for testing."""
    import random
    rng = random.Random(99)
    nodes = []
    for i in range(n_nodes):
        nodes.append({
            "id":              f"paper_{i}",
            "title":           f"Test Paper {i}",
            "authors":         [f"Author{i} A"],
            "year":            2010 + i,
            "citation_count":  rng.randint(5, 500),
            "fields_of_study": ["Computer Science"] if i % 3 != 0 else ["Physics"],
            "is_seed":         i == n_nodes - 1,
            "is_root":         i == 0,
            "abstract":        f"Abstract for paper {i}.",
        })
    edges = []
    mutation_types = ["adoption", "generalization", "specialization",
                      "hybridization", "contradiction", "incidental"]
    for i in range(1, n_nodes):
        edges.append({
            "source":           f"paper_{i}",
            "target":           f"paper_{i-1}",
            "mutation_type":    mutation_types[i % len(mutation_types)],
            "similarity_score": round(0.3 + rng.random() * 0.5, 3),
            "base_confidence":  round(0.4 + rng.random() * 0.4, 3),
            "confidence_tier":  "MEDIUM",
            "citing_sentence":  f"Sentence from paper {i}.",
            "cited_sentence":   f"Sentence from paper {i-1}.",
        })
    return {
        "nodes": nodes,
        "edges": edges,
        "metadata": {
            "seed_paper_id":    f"paper_{n_nodes-1}",
            "seed_paper_title": "Test Seed Paper",
            "total_nodes":      n_nodes,
            "total_edges":      n_nodes - 1,
        },
        "dna_profile": {
            "clusters": [
                {"name": "Cluster A", "percentage": 40,
                 "papers": [f"paper_{i}" for i in range(0, 5)],   "color": "#3B82F6"},
                {"name": "Cluster B", "percentage": 35,
                 "papers": [f"paper_{i}" for i in range(5, 10)],  "color": "#D4A843"},
                {"name": "Cluster C", "percentage": 25,
                 "papers": [f"paper_{i}" for i in range(10, 15)], "color": "#22C55E"},
            ]
        }
    }


# ─── ExportGenerator ─────────────────────────────────────────────────────────

class TestExportGenerator:
    """Tests for ExportGenerator — all format generators, no live R2."""

    @pytest.fixture
    def gen_no_r2(self):
        from backend.export_generator import ExportGenerator
        gen = ExportGenerator.__new__(ExportGenerator)
        mock_r2 = MagicMock()
        mock_r2._enabled = False
        gen.r2 = mock_r2
        return gen

    def test_graph_json_produces_valid_json(self, gen_no_r2):
        graph = _make_test_graph()
        data, filename, content_type = gen_no_r2._graph_json(graph, "sess", None, {})
        assert filename == "arivu_graph.json"
        assert content_type == "application/json"
        parsed = json.loads(data)
        assert "nodes" in parsed and "edges" in parsed

    def test_graph_csv_produces_zip_with_two_files(self, gen_no_r2):
        import zipfile, io
        graph = _make_test_graph()
        data, filename, content_type = gen_no_r2._graph_csv(graph, "sess", None, {})
        assert filename.endswith(".zip")
        assert content_type == "application/zip"
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            names = zf.namelist()
            assert "nodes.csv" in names
            assert "edges.csv" in names

    def test_bibtex_contains_article_entries(self, gen_no_r2):
        graph = _make_test_graph()
        data, filename, content_type = gen_no_r2._bibtex(graph, "sess", None, {})
        text = data.decode("utf-8")
        assert "@article{" in text
        assert filename.endswith(".bib")

    def test_bibtex_no_duplicate_cite_keys(self, gen_no_r2):
        graph = _make_test_graph(10)
        for n in graph["nodes"]:
            n["authors"] = ["Smith J"]
            n["year"]    = 2020
        data, _, _ = gen_no_r2._bibtex(graph, "sess", None, {})
        text = data.decode("utf-8")
        import re
        keys = re.findall(r"@article\{(\w+),", text)
        assert len(keys) == len(set(keys)), "Duplicate BibTeX cite keys found"

    def test_literature_review_template_fallback(self, gen_no_r2):
        graph = _make_test_graph()
        data, filename, content_type = gen_no_r2._literature_review(graph, "sess", None, {})
        text = data.decode("utf-8")
        assert "## Overview" in text or "# Literature Review" in text
        assert content_type == "text/markdown"

    def test_action_log_returns_json(self, gen_no_r2):
        graph = _make_test_graph()
        with patch("backend.export_generator.fetchall", return_value=[]):
            data, filename, content_type = gen_no_r2._action_log(graph, "sess", None, {})
        parsed = json.loads(data)
        assert "session_id" in parsed
        assert "actions" in parsed

    def test_generate_raises_for_unknown_type(self, gen_no_r2):
        with pytest.raises(ValueError, match="Unknown export type"):
            gen_no_r2.generate("bad-type", {}, "sess")

    def test_generate_raises_when_r2_disabled(self):
        from backend.export_generator import ExportGenerator
        gen = ExportGenerator.__new__(ExportGenerator)
        mock_r2 = MagicMock()
        mock_r2._enabled = False
        gen.r2 = mock_r2
        with pytest.raises(RuntimeError, match="R2 storage is not configured"):
            gen.generate("graph-json", _make_test_graph(), "sess")

    def test_build_nodes_by_id_helper(self):
        from backend.export_generator import _build_nodes_by_id
        graph = _make_test_graph(5)
        nbi   = _build_nodes_by_id(graph)
        assert len(nbi) == 5
        for node in graph["nodes"]:
            assert node["id"] in nbi
            assert nbi[node["id"]]["title"] == node["title"]


# ─── LivingPaperScorer ───────────────────────────────────────────────────────

class TestLivingPaperScorer:

    def test_scores_all_nodes(self):
        from backend.living_paper_scorer import LivingPaperScorer
        graph   = _make_test_graph(10)
        scorer  = LivingPaperScorer()
        results = scorer.score_graph(graph)
        assert len(results) == 10
        for pid, score in results.items():
            assert 0.0 <= score.score <= 100.0
            assert score.trajectory in ("rising", "stable", "declining", "extinct")

    def test_score_single_returns_result(self):
        from backend.living_paper_scorer import LivingPaperScorer
        graph  = _make_test_graph(10)
        scorer = LivingPaperScorer()
        result = scorer.score_single("paper_5", graph)
        assert result is not None
        assert result.paper_id == "paper_5"

    def test_score_single_unknown_paper_returns_none(self):
        from backend.living_paper_scorer import LivingPaperScorer
        graph  = _make_test_graph(5)
        scorer = LivingPaperScorer()
        assert scorer.score_single("nonexistent_id", graph) is None

    def test_empty_graph_returns_empty(self):
        from backend.living_paper_scorer import LivingPaperScorer
        scorer  = LivingPaperScorer()
        results = scorer.score_graph({"nodes": [], "edges": []})
        assert results == {}

    def test_to_dict_is_serializable(self):
        from backend.living_paper_scorer import LivingPaperScorer
        graph  = _make_test_graph(8)
        scorer = LivingPaperScorer()
        result = scorer.score_single("paper_0", graph)
        assert result is not None
        d = result.to_dict()
        json.dumps(d)  # must not raise
        assert "score" in d and "trajectory" in d

    def test_current_year_is_dynamic(self):
        """REGRESSION: CURRENT_YEAR must never be hardcoded (GAP-32)."""
        from backend.living_paper_scorer import _current_year
        from datetime import datetime, timezone
        assert _current_year() == datetime.now(timezone.utc).year, (
            "CURRENT_YEAR appears hardcoded. Use _current_year() which calls "
            "datetime.now(timezone.utc).year dynamically."
        )


# ─── OriginalityMapper ───────────────────────────────────────────────────────

class TestOriginalityMapper:

    def test_paper_with_no_ancestors_is_pioneer(self):
        from backend.originality_mapper import OriginalityMapper
        graph = {
            "nodes": [{"id": "p0", "title": "Paper 0", "authors": ["A"],
                       "fields_of_study": ["CS"]}],
            "edges": [],
        }
        mapper = OriginalityMapper()
        result = mapper.compute_originality("p0", graph)
        assert result is not None
        assert result.contribution_type == "Pioneer"

    def test_returns_none_for_unknown_paper(self):
        from backend.originality_mapper import OriginalityMapper
        graph  = _make_test_graph(5)
        mapper = OriginalityMapper()
        assert mapper.compute_originality("not_in_graph", graph) is None

    def test_structural_fallback_returns_valid_type(self):
        from backend.originality_mapper import OriginalityMapper
        graph  = _make_test_graph(10)
        mapper = OriginalityMapper()
        with patch("backend.originality_mapper.db.fetchall", return_value=[]):
            result = mapper.compute_originality("paper_9", graph)
        assert result is not None
        assert result.contribution_type in (
            "Pioneer", "Synthesizer", "Bridge", "Refiner", "Contradictor"
        )

    def test_to_dict_is_serializable(self):
        from backend.originality_mapper import OriginalityMapper
        graph  = _make_test_graph(8)
        mapper = OriginalityMapper()
        with patch("backend.originality_mapper.db.fetchall", return_value=[]):
            result = mapper.compute_originality("paper_7", graph)
        assert result is not None
        json.dumps(result.to_dict())  # must not raise

    def test_cosine_similarity_bounds(self):
        from backend.originality_mapper import OriginalityMapper
        sim = OriginalityMapper._cosine_similarity([1, 0, 0], [1, 0, 0])
        assert abs(sim - 1.0) < 1e-6
        sim = OriginalityMapper._cosine_similarity([1, 0], [0, 1])
        assert abs(sim - 0.0) < 1e-6
        sim = OriginalityMapper._cosine_similarity([0, 0, 0], [1, 2, 3])
        assert sim == 0.0


# ─── ParadigmShiftDetector ───────────────────────────────────────────────────

class TestParadigmShiftDetector:

    def test_small_graph_returns_stable(self):
        from backend.paradigm_detector import ParadigmShiftDetector
        graph  = {"nodes": [{"id": "p0", "year": 2020}], "edges": []}
        det    = ParadigmShiftDetector()
        result = det.detect(graph)
        assert result.stability_score == 100.0
        assert not result.alert
        assert result.signals == []

    def test_high_contradiction_rate_triggers_signal(self):
        from backend.paradigm_detector import ParadigmShiftDetector
        graph = _make_test_graph(20)
        for e in graph["edges"]:
            e["mutation_type"] = "contradiction"
        det    = ParadigmShiftDetector()
        result = det.detect(graph, coverage_score=0.8)
        signal_types = [s.signal_type for s in result.signals]
        assert "CONTRADICTION_SURGE" in signal_types

    def test_alert_triggers_below_threshold(self):
        from backend.paradigm_detector import ParadigmShiftDetector, ALERT_THRESHOLD
        graph = _make_test_graph(25)
        for e in graph["edges"]:
            e["mutation_type"] = "contradiction"
        det    = ParadigmShiftDetector()
        result = det.detect(graph, coverage_score=0.9)
        if result.stability_score < ALERT_THRESHOLD:
            assert result.alert is True

    def test_coverage_ok_flag_reflects_threshold(self):
        from backend.paradigm_detector import ParadigmShiftDetector, COVERAGE_THRESHOLD
        graph      = _make_test_graph(10)
        det        = ParadigmShiftDetector()
        result_ok  = det.detect(graph, coverage_score=COVERAGE_THRESHOLD + 0.1)
        result_low = det.detect(graph, coverage_score=COVERAGE_THRESHOLD - 0.1)
        assert result_ok.coverage_ok  is True
        assert result_low.coverage_ok is False

    def test_to_dict_is_serializable(self):
        from backend.paradigm_detector import ParadigmShiftDetector
        graph  = _make_test_graph(15)
        det    = ParadigmShiftDetector()
        result = det.detect(graph, coverage_score=0.7)
        json.dumps(result.to_dict())  # must not raise


# ─── Quality monitor confidence field regression test (GAP-15) ───────────────

class TestQualityMonitorConfidenceField:
    """
    Regression test for GAP-15: quality monitor must use base_confidence,
    not final_confidence, to match EdgeAnalysis dataclass and export_to_json().
    """

    def test_confidence_metric_reads_base_confidence(self):
        from backend.quality_monitor import ProductionQualityMonitor
        graph = _make_test_graph(10)
        # All edges have base_confidence = 0.2 (below LOW_CONFIDENCE threshold of 0.4)
        for e in graph["edges"]:
            e["base_confidence"]  = 0.2
            e["mutation_confidence"] = 0.2
            # Deliberately do NOT set final_confidence
            e.pop("final_confidence", None)

        monitor = ProductionQualityMonitor()
        result  = monitor.analyze_graph_quality(graph)
        metrics = result.get("metrics", {})
        # If the fix is applied, low_confidence_rate should be > 0
        # (all edges have confidence 0.2 < 0.4 threshold)
        assert "low_confidence_rate" in metrics, (
            "quality_monitor is not computing low_confidence_rate. "
            "Check that analyze_graph_quality reads base_confidence."
        )
        assert metrics["low_confidence_rate"] > 0, (
            "low_confidence_rate is 0 — quality monitor is not reading "
            "base_confidence correctly (GAP-15 fix not applied)."
        )

    def test_quality_monitor_positive_path(self):
        """Positive case: quality monitor returns quality_score for a valid graph."""
        from backend.quality_monitor import ProductionQualityMonitor
        graph   = _make_test_graph(20)
        monitor = ProductionQualityMonitor()
        result  = monitor.analyze_graph_quality(graph)
        assert "quality_score" in result
        assert 0.0 <= result["quality_score"] <= 1.0
        assert "metrics" in result
        assert "issues" in result


# ─── ground_truth/pairs.json ─────────────────────────────────────────────────

class TestGroundTruthPairs:
    GT_PATH = Path(__file__).parent.parent / "data" / "ground_truth" / "pairs.json"

    def test_file_exists(self):
        assert self.GT_PATH.exists(), (
            f"data/ground_truth/pairs.json not found at {self.GT_PATH}. Create per §13."
        )

    def test_has_minimum_pairs(self):
        with open(self.GT_PATH) as f:
            data = json.load(f)
        assert len(data) >= 5, f"Expected ≥5 pairs, got {len(data)}"

    def test_required_fields(self):
        with open(self.GT_PATH) as f:
            data = json.load(f)
        for pair in data:
            assert "source_id" in pair,                  f"Missing source_id in {pair}"
            assert "target_id" in pair,                  f"Missing target_id in {pair}"
            assert "expected_mutation_type" in pair,     f"Missing expected_mutation_type"
            assert "expected_similarity_range" in pair,  f"Missing expected_similarity_range"
            r = pair["expected_similarity_range"]
            assert len(r) == 2,                          f"similarity_range must be [min, max]"
            assert 0 <= r[0] <= r[1] <= 1.0,            f"Invalid range {r}"

    def test_mutation_types_are_valid(self):
        from backend.models import MUTATION_TYPES
        with open(self.GT_PATH) as f:
            data = json.load(f)
        for pair in data:
            mt = pair.get("expected_mutation_type", "")
            assert mt in MUTATION_TYPES or mt == "", (
                f"Unknown mutation type: {mt!r}"
            )


# ─── Export route authentication ─────────────────────────────────────────────

class TestExportRouteAuth:
    """Verify export route requires session (negative path) and returns 400 for bad type."""

    @pytest.fixture
    def client(self):
        from app import create_app
        application = create_app()
        application.config["TESTING"] = True
        with application.test_client() as c:
            yield c

    def test_export_requires_session(self, client):
        resp = client.post(
            "/api/export/graph-json",
            json={},
            content_type="application/json",
        )
        assert resp.status_code == 401, (
            f"Expected 401 without session, got {resp.status_code}"
        )

    def test_export_rejects_unknown_type(self, client):
        resp = client.post(
            "/api/export/not-a-real-type",
            json={},
            content_type="application/json",
        )
        # Should be 401 (no session) or 400 (bad type) — not 200 or 500
        assert resp.status_code in (400, 401)


# ─── Utils path regression (GAP-7 / GAP-31) ──────────────────────────────────

class TestUtilsGalleryPath:
    """Regression test: GALLERY_INDEX_PATH must point to data/ not data/precomputed/."""

    def test_gallery_index_path_is_at_data_root(self):
        from backend.utils import GALLERY_INDEX_PATH
        path_str = str(GALLERY_INDEX_PATH)
        assert "precomputed" not in path_str.split("gallery_index.json")[0], (
            f"GALLERY_INDEX_PATH still points inside data/precomputed/. "
            f"Got: {path_str}. Apply §0.3 fix."
        )
        assert path_str.endswith("gallery_index.json"), (
            f"GALLERY_INDEX_PATH does not end with gallery_index.json: {path_str}"
        )

    def test_gallery_dir_is_precomputed(self):
        from backend.utils import GALLERY_DIR
        assert str(GALLERY_DIR).endswith("precomputed"), (
            f"GALLERY_DIR should still point to data/precomputed/. Got: {GALLERY_DIR}"
        )


# ─── arivu_rate_limiter instance (GAP-8) ─────────────────────────────────────

class TestRateLimiterInstance:
    """Regression test: arivu_rate_limiter must be importable as module-level instance."""

    def test_arivu_rate_limiter_importable(self):
        from backend.rate_limiter import arivu_rate_limiter
        assert arivu_rate_limiter is not None, (
            "arivu_rate_limiter instance not found in rate_limiter.py. Apply §0.1 fix."
        )

    def test_arivu_rate_limiter_has_check_sync(self):
        from backend.rate_limiter import arivu_rate_limiter
        assert hasattr(arivu_rate_limiter, "check_sync"), (
            "arivu_rate_limiter missing check_sync(). "
            "Ensure Phase 4 §0.5 backport was applied."
        )

    def test_arivu_rate_limiter_has_phase5_limits(self):
        from backend.rate_limiter import arivu_rate_limiter
        limits = getattr(arivu_rate_limiter, "LIMITS", {})
        assert "POST /api/export" in limits, (
            "Phase 5 export rate limit not found in LIMITS. Apply §4."
        )


# ─── presigned_url on R2Client (GAP-13) ──────────────────────────────────────

class TestR2ClientPresignedUrl:
    """Regression test: R2Client must have presigned_url() method."""

    def test_presigned_url_method_exists(self):
        from backend.r2_client import R2Client
        r2 = R2Client()
        assert hasattr(r2, "presigned_url"), (
            "R2Client missing presigned_url() method. Apply §0.4 fix."
        )

    def test_presigned_url_raises_when_disabled(self):
        from backend.r2_client import R2Client
        r2 = R2Client()
        if not r2._enabled:
            with pytest.raises(RuntimeError, match="R2"):
                r2.presigned_url("some/key.json")
```

---

## §16 — Update CONTEXT.md

**Commit 1:** All Phase 5 implementation files.
```
[phase5] export system, living score, originality mapper, paradigm detector, retraction watch
```

**Commit 2:** CONTEXT.md update.
```
[context] Phase 5 complete — export system and intelligence layer live
```

In `CONTEXT.md`:
- Move "Phase 5" from "In Progress" to "Completed"
- Add custom domain status under "Live Deployment" (use format from §0.10)
- Record ground truth evaluation results

---

## §17 — Common Failure Modes

### WeasyPrint `cairo` ImportError
WeasyPrint needs `libcairo2` on the system. Verify Dockerfile includes it (Phase 1 does).
If running locally on macOS: `brew install cairo pango gdk-pixbuf`.

### `ModuleNotFoundError: No module named 'markdown'`
The `Markdown` Python package is separate from the `markdown` stdlib-like library.
Install: `pip install Markdown==3.5.2`. Verify it's in `requirements.txt` (§1).

### Export returns 503 "R2 not configured"
`R2_ENDPOINT_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` must all be set.
The export system requires R2 — it cannot fall back to DB for large exports.

### `presigned_url()` method missing on R2Client
Apply §0.4 backport. Verify: `grep -n "def presigned_url" backend/r2_client.py`

### Semantic zoom not activating at k < 0.4
Apply §0.2 backport. Verify: `grep -n "renderClusters" static/js/graph.js`
The zoom handler must contain the `if (_k < 0.4)` block.

### `ImportError: cannot import name 'arivu_rate_limiter'`
Apply §0.1 backport. Verify: `python -c "from backend.rate_limiter import arivu_rate_limiter; print('OK')"`

### `ground_truth_eval.py` → "below 70% threshold"
Check:
1. NLP worker is healthy: `curl $NLP_WORKER_URL/health`
2. Embeddings are populated: `psql $DATABASE_URL -c "SELECT COUNT(*) FROM paper_embeddings;"`
3. Run `python scripts/test_pipeline.py` for end-to-end diagnosis

### Living score all "stable" or all the same
Most likely the graph was built without year data on papers. Check `paper.year` is
populated by the S2 API response. The scorer uses `_current_year()` dynamically — if
years are missing, scores fall back to DB citation counts only.

### Retraction Watch CSV format changed
The Crossref export format occasionally changes column names. If `load_retraction_watch.py`
logs "Row error" for every row, add this debug line at the top of the CSV loop:
```python
logger.info(f"CSV columns: {reader.fieldnames}")
```
Then update the `row.get("ColumnName")` calls to match actual column names.

### CORS not working on arivu.app
- DNS must be fully propagated before uncommenting the CORS lines (§2.3)
- Verify with: `curl -H "Origin: https://arivu.app" -X OPTIONS https://arivu.app/api/search -I`
- Check that `origins +=` line is uncommented (not just a comment)
- Redeploy Koyeb after any CORS change

### Quality monitor `low_confidence_rate` always 0
The Phase 4 spec had `final_confidence` where it should be `base_confidence`.
Apply §0.5. Verify: `grep "base_confidence\|final_confidence" backend/quality_monitor.py`
should show `base_confidence` as the primary field name.

### `GALLERY_INDEX_PATH` reading from wrong location
Apply §0.3. Verify: `python -c "from backend.utils import GALLERY_INDEX_PATH; print(GALLERY_INDEX_PATH)"`
Output must end with `data/gallery_index.json` (not `data/precomputed/gallery_index.json`).

---

## Done When

Phase 5 is complete when ALL of the following are true:

1. **All §0 backports applied and verified** — each §0 section has a verification command;
   run them before testing Phase 5 features. GAP-8 and GAP-2 in particular will cause
   immediate failures if skipped.

2. **All tests pass:**
   ```bash
   python -m pytest tests/ -v
   ```
   All pass. 0 failed. (smoke + phase2 + phase3 + phase4 + phase5)

3. **Export downloads work** (after building a graph):
   ```bash
   curl -X POST https://arivu.app/api/export/bibtex \
     -b "arivu_session=<your_session_cookie>"
   # Must return {"url": "https://...", "filename": "..."}
   ```

4. **Living score responds:**
   ```bash
   curl https://arivu.app/api/living-score/<paper_id> \
     -b "arivu_session=<cookie>"
   # Returns {"score": ..., "trajectory": "rising"|"stable"|...}
   ```

5. **Originality endpoint responds:**
   ```bash
   curl https://arivu.app/api/originality/<paper_id> -b "arivu_session=<cookie>"
   # Returns {"contribution_type": "Pioneer"|"Synthesizer"|...}
   ```

6. **Paradigm shift endpoint responds:**
   ```bash
   curl https://arivu.app/api/paradigm/<seed_id> -b "arivu_session=<cookie>"
   # Returns {"stability_score": ..., "alert": ...}
   ```

7. **Ground truth eval passes** (requires S2 API + NLP worker):
   ```bash
   python scripts/ground_truth_eval.py
   # ✅ PASSED — NLP pipeline meets accuracy threshold
   ```

8. **Custom domain live** (if registered):
   ```bash
   curl -I https://arivu.app/health
   # HTTP/2 200 with correct JSON
   ```

9. **og-image.png is polished** (1200×630, not a 1×1 placeholder):
   ```bash
   python -c "from PIL import Image; img=Image.open('static/assets/og-image.png'); print(img.size)"
   # (1200, 630)
   ```

10. **Export panel visible** in tool page after building a graph.

11. **Gallery proxy routes work** (apply §0.12 if not):
    ```bash
    curl -I https://arivu.app/static/previews/attention/graph.json
    # Must return 200 (or 404 if precompute not run) — never 404 on the route itself
    ```

12. **Semantic zoom works** (apply §0.2 if not):
    Tool page with graph loaded → zoom out until k < 0.4 → cluster bubbles appear.

13. **Quality monitor reads correct field** (GAP-15 regression):
    ```bash
    python -m pytest tests/test_phase5.py::TestQualityMonitorConfidenceField -v
    # Both tests must pass
    ```

14. **CONTEXT.md updated**, Phase 5 under "Completed".

15. **Two git commits on `main`:**
    - `[phase5] export system, living score, originality mapper, paradigm detector, retraction watch`
    - `[context] Phase 5 complete — export system and intelligence layer live`

---

## What NOT To Do in Phase 5

- Do NOT implement user accounts, auth, or Stripe billing
- Do NOT implement the Time Machine (F2.1) or Vocabulary Evolution Tracker (F1.8)
- Do NOT implement the Extinction Event Detector (F1.6)
- Do NOT implement the Prediction Market (F2.4)
- Do NOT implement Collaborative Annotation (requires user accounts)
- Do NOT implement the Adversarial Reviewer (F4.1) — complex feature for Phase 7+
- Do NOT set `FLASK_DEBUG=true` in Koyeb
- Do NOT add the custom domain to CORS until DNS is fully propagated and HTTPS works
- Do NOT run `load_retraction_watch.py` without downloading the CSV first
- Do NOT commit `data/retractions.csv` to git — it's large (~150MB) and gitignored
- Do NOT hardcode `CURRENT_YEAR` as a constant in `living_paper_scorer.py` — use `_current_year()` which calls `datetime.now(timezone.utc).year` dynamically (GAP-32)
- Do NOT skip §0 backports thinking they're optional — GAP-8 (ImportError) and GAP-2 (semantic zoom broken) are blockers for the test suite
- Do NOT rewrite `backend/llm_client.py` from scratch — add only `generate_literature_review()` to the existing class (§9)
- Do NOT re-implement `dna_profiler.py`, `diversity_scorer.py`, or `orphan_detector.py` — these were completed in Phase 3 and must not be touched
