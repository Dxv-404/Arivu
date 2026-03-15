#!/usr/bin/env python3
"""
scripts/verify_deployment.py

End-to-end smoke test for a deployed Arivu instance.

Usage:
    python scripts/verify_deployment.py                         # uses KOYEB_URL env var
    python scripts/verify_deployment.py https://app.koyeb.app
    python scripts/verify_deployment.py http://localhost:5000   # local dev

Exit: 0 = all passed, 1 = one or more failed.
"""
import sys
import os
import json
import time

try:
    import httpx
except ImportError:
    print("ERROR: httpx not installed.")
    print("Run: pip install httpx  OR  activate your venv: source venv/bin/activate")
    sys.exit(1)

BASE_URL = (sys.argv[1] if len(sys.argv) > 1
            else os.environ.get("KOYEB_URL", "http://localhost:5000")).rstrip("/")

GALLERY_SLUGS = ["attention", "alexnet", "bert", "gans", "word2vec", "resnet", "gpt2"]

PASS = "✓"
FAIL = "✗"
SKIP = "⊘"
results = []


def check(name: str, fn):
    try:
        status, detail = fn()
        symbol = PASS if status else FAIL
        results.append((status, name, detail))
        print(f"  {symbol} {name}: {detail}")
        return status
    except Exception as e:
        results.append((False, name, f"ERROR: {e}"))
        print(f"  {FAIL} {name}: ERROR — {e}")
        return False


def main():
    print(f"\nArivu deployment verification")
    print(f"Target: {BASE_URL}")
    print(f"Time:   {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}\n")

    client = httpx.Client(timeout=30.0, follow_redirects=True)

    # ── 1. Health Check ───────────────────────────────────────────
    print("1. Health Check")

    def check_health():
        r = client.get(f"{BASE_URL}/health")
        if r.status_code != 200:
            return False, f"HTTP {r.status_code}"
        data = r.json()
        overall = data.get("status", "unknown")
        checks  = data.get("checks", {})
        detail  = f"status={overall} | " + " | ".join(f"{k}={v}" for k, v in checks.items())
        return overall in ("healthy", "degraded"), detail

    check("GET /health", check_health)

    # ── 2. Page Routes ────────────────────────────────────────────
    print("\n2. Page Routes")

    for path, name in [("/", "Landing page"), ("/tool", "Tool page"), ("/explore", "Gallery page")]:
        def _page_check(p=path):
            r = client.get(f"{BASE_URL}{p}")
            return r.status_code == 200, f"HTTP {r.status_code}, {len(r.text)} bytes"
        check(f"GET {path} — {name}", _page_check)

    # ── 3. API Endpoints ──────────────────────────────────────────
    print("\n3. API Endpoints")

    def check_search():
        r = client.post(f"{BASE_URL}/api/search",
                        json={"query": "attention is all you need"},
                        headers={"Content-Type": "application/json"})
        return r.status_code in (200, 401, 429), f"HTTP {r.status_code}"

    check("POST /api/search", check_search)

    def check_prune_no_session():
        r = client.post(f"{BASE_URL}/api/prune",
                        json={"paper_ids": ["test"], "graph_seed_id": "test"})
        return r.status_code == 401, f"HTTP {r.status_code} (expected 401)"

    check("POST /api/prune requires session", check_prune_no_session)

    def check_quality_no_session():
        r = client.get(f"{BASE_URL}/api/quality")
        if r.status_code == 401:
            return True, "HTTP 401 (correct — session required)"
        if r.status_code == 200:
            try:
                data = r.json()
                has = "quality_score" in data
                return has, f"HTTP 200, quality_score={'present' if has else 'MISSING'}"
            except Exception:
                return False, "HTTP 200 but invalid JSON"
        return False, f"Unexpected HTTP {r.status_code}"

    check("GET /api/quality (auth check)", check_quality_no_session)

    # ── 4. Gallery Previews ───────────────────────────────────────
    print("\n4. Gallery Previews (R2 proxy routes)")

    for slug in GALLERY_SLUGS:
        def _gallery_check(s=slug):
            r = client.get(f"{BASE_URL}/static/previews/{s}/graph.json", timeout=15.0)
            if r.status_code == 200:
                try:
                    data  = r.json()
                    nodes = len(data.get("nodes", []))
                    return True, f"HTTP 200, {nodes} nodes"
                except Exception:
                    return False, "HTTP 200 but invalid JSON"
            elif r.status_code == 503:
                return False, "HTTP 503 — R2 not configured or precompute not run"
            else:
                return False, f"HTTP {r.status_code}"
        check(f"GET /static/previews/{slug}/graph.json", _gallery_check)

    # ── 5. Gallery SVG Previews ───────────────────────────────────
    print("\n5. Gallery SVG Previews")

    for slug in ["attention", "bert", "resnet"]:
        def _svg_check(s=slug):
            r = client.get(f"{BASE_URL}/static/previews/{s}.svg")
            if r.status_code == 200 and r.headers.get("content-type","").startswith("image/svg"):
                return True, f"HTTP 200, {len(r.text)} bytes SVG"
            elif r.status_code == 200:
                return r.text.strip().startswith("<svg"), (
                    f"HTTP 200, content-type={r.headers.get('content-type')}")
            return False, f"HTTP {r.status_code}"
        check(f"GET /static/previews/{slug}.svg", _svg_check)

    # ── 6. Gallery Index JSON ─────────────────────────────────────
    print("\n6. Gallery Index")

    def check_gallery_index():
        r = client.get(f"{BASE_URL}/static/gallery_index.json")
        if r.status_code != 200:
            return False, f"HTTP {r.status_code}"
        try:
            data = r.json()
            return isinstance(data, list) and len(data) == 7, f"HTTP 200, {len(data)} entries"
        except Exception:
            return False, "HTTP 200 but invalid JSON"

    check("GET /static/gallery_index.json", check_gallery_index)

    # ── 7. NLP Worker ─────────────────────────────────────────────
    print("\n7. NLP Worker")

    nlp_url = os.environ.get("NLP_WORKER_URL", "")
    if nlp_url:
        def check_nlp():
            r = httpx.get(f"{nlp_url}/health", timeout=10.0)
            data   = r.json()
            loaded = data.get("model_loaded", False)
            return r.status_code == 200 and loaded, f"HTTP {r.status_code}, model_loaded={loaded}"
        check(f"GET {nlp_url}/health", check_nlp)
    else:
        print(f"  {SKIP} NLP worker check skipped (NLP_WORKER_URL not set)")

    # ── 8. Summary ────────────────────────────────────────────────
    print()
    passed = sum(1 for ok, _, _ in results if ok)
    failed = sum(1 for ok, _, _ in results if not ok)
    total  = len(results)

    print(f"Results: {passed}/{total} passed, {failed} failed")

    if failed:
        print("\nFailed checks:")
        for ok, name, detail in results:
            if not ok:
                print(f"  {FAIL} {name}: {detail}")
        sys.exit(1)
    else:
        print(f"\n{PASS} All checks passed. Arivu is healthy.")
        sys.exit(0)


if __name__ == "__main__":
    main()
