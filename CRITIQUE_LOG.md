# Arivu — Critique & Conflict Audit Log

Append-only. Every conflict, hallucination catch, scope question, spec critique, and out-of-plan detection goes here.

---

## [2026-03-14] [PHASE 1] [CONFLICT] bcrypt version mismatch between Phase 1 §14 and CLAUDE.md

**Type:** CONFLICT
**Status:** RESOLVED
**Affects:** requirements.txt — bcrypt version
**Severity:** LOW

### Finding
Phase 1 §14 specifies `bcrypt==4.1.3`. CLAUDE.md Part 12 baseline says `bcrypt==4.1.2`. CONFLICT-008 in CLAUDE.md Part 22 pre-resolves this to `bcrypt==4.1.2`.

### Impact
Wrong version could cause subtle behavior differences or install failures in later phases.

### Resolution
Using `bcrypt==4.1.2` per CONFLICT-008 pre-resolution in CLAUDE.md.

---

## [2026-03-14] [PHASE 1] [DRIFT] Stub phase attribution corrections applied

**Type:** DRIFT
**Status:** RESOLVED
**Affects:** backend/ stub file comments (6 files)
**Severity:** LOW

### Finding
Phase 1 stub table has incorrect phase attributions for 6 files. CLAUDE.md Part 16 provides corrections:
- `dna_profiler.py` — Phase 3 (Phase 1 said Phase 4)
- `diversity_scorer.py` — Phase 3 (Phase 1 said Phase 4)
- `orphan_detector.py` — Phase 3 (Phase 1 said Phase 4)
- `quality_monitor.py` — Phase 4 (Phase 1 said Phase 6)
- `precompute_gallery.py` — Phase 3 (Phase 1 said Phase 5)
- `load_retraction_watch.py` — Phase 5 (Phase 1 said Phase 2)

### Impact
Incorrect phase comments could mislead future sessions about when to implement each module.

### Resolution
Applied all 6 corrections from CLAUDE.md Part 16 to stub comments.

---

## [2026-03-14] [PHASE 1] [SPEC_GAP] Stub phase attribution for llm_client, chat_guide, prompt_sanitizer

**Type:** SPEC_GAP
**Status:** RESOLVED
**Affects:** backend/llm_client.py, backend/chat_guide.py, backend/prompt_sanitizer.py stub comments
**Severity:** LOW

### Finding
Phase 1 stub table assigns these three files to Phase 4. CLAUDE.md Part 7 (project structure) lists them as "← Phase 3". Part 16 does not include them in the 6 explicit corrections. Unclear which is correct.

### Impact
Only affects stub comments — no functional impact in Phase 1. Will be resolved when Phase 3 or Phase 4 implementation begins.

### Resolution
CLAUDE.md Part 7 is authoritative: these files are Phase 3 implementations. Part 7 explicitly marks `llm_client.py ← Phase 3`, `chat_guide.py ← Phase 3`, `prompt_sanitizer.py ← Phase 3`. Phase 2 §18 confirms: "Do not implement backend/llm_client.py, backend/chat_guide.py — Phase 4" but CLAUDE.md Part 7 takes precedence as the project structure authority. The stub comments remain as-is (Phase 4) since Part 16 did not list them as corrections; actual implementation will happen in Phase 3 per Part 7.

---

## [2026-03-14] [PHASE 1] [CONFLICT] gallery_index.json path

**Type:** CONFLICT
**Status:** RESOLVED
**Affects:** data/precomputed/gallery_index.json vs data/gallery_index.json
**Severity:** LOW

### Finding
Phase 1 file manifest and utils.py §6 both place gallery_index.json at `data/precomputed/gallery_index.json`. CLAUDE.md Part 6.4 says the canonical path from Phase 4 onward is `data/gallery_index.json`. Phase 5 §0.3 formalizes the fix.

### Impact
Path will need to change in Phase 4/5. No impact on Phase 1 since the file is an empty `[]` placeholder.

### Resolution
Following Phase 1 spec exactly: `data/precomputed/gallery_index.json`. Phase 5 §0.3 will move it.

---

## [2026-03-14] [PHASE 1] [CONFLICT] resend version incompatible with requests

**Type:** CONFLICT
**Status:** RESOLVED
**Affects:** requirements.txt — resend and requests versions
**Severity:** MEDIUM

### Finding
Phase 1 §14 specifies `resend==0.7.2` which has a hard dependency on `requests==2.31.0`. This conflicts with the separately pinned `requests==2.32.3`. Installation fails with `ResolutionImpossible`. CLAUDE.md CONFLICT-007 already notes Phase 6 §0.4 specifies `resend==2.3.0`.

### Impact
Cannot install dependencies at all with `resend==0.7.2` and `requests==2.32.3` together.

### Resolution
Updated to `resend==2.3.0` per CONFLICT-007 (Phase 6 value). Resend is only used in Phase 6+ — this change has zero functional impact on Phase 1.

---

## [2026-03-14] [PHASE 2] [DRIFT] structlog.stdlib.TimeStamper → structlog.processors.TimeStamper

**Type:** DRIFT
**Status:** RESOLVED
**Affects:** app.py — structlog configuration
**Severity:** LOW

### Finding
Phase 2 §15 specifies `structlog.stdlib.TimeStamper(fmt="iso")` in the app.py import block. In `structlog==24.1.0` (the pinned version), `TimeStamper` is in `structlog.processors`, not `structlog.stdlib`. This caused an `AttributeError` at module import time, breaking all tests.

### Impact
All tests fail with `AttributeError: module 'structlog.stdlib' has no attribute 'TimeStamper'`.

### Resolution
Changed to `structlog.processors.TimeStamper(fmt="iso")` which is the correct location in structlog 24.1.0.
