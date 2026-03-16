"""
backend/vocabulary_tracker.py — VocabularyEvolutionTracker (F1.8)

FIX (GAP-P7-N5): build_heatmap_cached() reads/writes vocabulary_snapshots table.
"""
import json
import logging
import math
import re
from collections import defaultdict

import backend.db as db

logger = logging.getLogger(__name__)

STOP_WORDS = {
    "the","a","an","and","or","but","in","on","at","to","for","of","with",
    "by","from","as","is","was","are","were","be","been","being","have","has",
    "had","do","does","did","will","would","could","should","may","might","must",
    "this","that","these","those","it","its","we","our","they","their",
    "paper","study","method","approach","results","using","used","based","which",
    "also","show","shows","shown","propose","proposed","present","presents","work",
}
MIN_TERM_LENGTH = 3
MAX_TERMS_PER_YEAR = 30


class VocabularyEvolutionTracker:

    def build_heatmap_cached(
        self, graph_json: dict, min_year: int, max_year: int, graph_id: str
    ) -> dict:
        """
        Build vocabulary heatmap with DB caching.
        Reads per-year snapshots from vocabulary_snapshots; writes any missing years.
        """
        if not graph_id:
            return self.build_heatmap(graph_json, min_year, max_year)

        # Load all cached years for this graph
        rows = db.fetchall(
            "SELECT year, terms_json FROM vocabulary_snapshots WHERE graph_id = %s",
            (graph_id,),
        )
        cached: dict = {r["year"]: r["terms_json"] for r in rows}

        needed_years = [y for y in range(min_year, max_year + 1) if y not in cached]
        if needed_years:
            full_heatmap = self.build_heatmap(graph_json, min_year, max_year)
            for year in needed_years:
                terms = full_heatmap.get(year, {})
                try:
                    db.execute(
                        """
                        INSERT INTO vocabulary_snapshots (graph_id, year, terms_json)
                        VALUES (%s, %s, %s::jsonb)
                        ON CONFLICT (graph_id, year) DO UPDATE SET terms_json=EXCLUDED.terms_json
                        """,
                        (graph_id, year, json.dumps(terms)),
                    )
                except Exception as exc:
                    logger.warning(f"Failed to cache vocab snapshot: {exc}")
                cached[year] = terms

        return {y: cached.get(y, {}) for y in range(min_year, max_year + 1)}

    def build_heatmap(self, graph_json: dict, min_year: int, max_year: int) -> dict:
        """Build vocabulary heatmap without caching."""
        nodes = graph_json.get("nodes", [])
        if not nodes:
            return {}

        docs_by_year: dict = defaultdict(list)
        for node in nodes:
            year = node.get("year")
            if not year:
                continue
            text = node.get("abstract") or node.get("title") or ""
            if text:
                docs_by_year[year].append(text.lower())

        if not docs_by_year:
            return {}

        year_term_freqs: dict = {}
        all_terms: set = set()

        for year, texts in docs_by_year.items():
            combined = " ".join(texts)
            tokens   = re.findall(r'\b[a-z][a-z\-]{2,}\b', combined)
            freq: dict = defaultdict(int)
            for tok in tokens:
                if tok not in STOP_WORDS and len(tok) >= MIN_TERM_LENGTH:
                    freq[tok] += 1
            total = max(sum(freq.values()), 1)
            year_term_freqs[year] = {term: count / total for term, count in freq.items()}
            all_terms.update(freq.keys())

        year_count = len(year_term_freqs)
        idf: dict = {}
        for term in all_terms:
            docs_with_term = sum(1 for yf in year_term_freqs.values() if term in yf)
            idf[term] = math.log((year_count + 1) / (docs_with_term + 1)) + 1

        heatmap: dict = {}
        for year in range(min_year, max_year + 1):
            if year not in year_term_freqs:
                heatmap[year] = {}
                continue
            tf    = year_term_freqs[year]
            tfidf = {term: tf_score * idf.get(term, 1.0) for term, tf_score in tf.items()}
            top   = sorted(tfidf.items(), key=lambda x: x[1], reverse=True)[:MAX_TERMS_PER_YEAR]
            max_s = top[0][1] if top else 1.0
            heatmap[year] = {term: round(score / max_s, 3) for term, score in top}

        return heatmap

    def find_term_trajectories(self, heatmap: dict) -> list:
        all_terms: set = set()
        for year_data in heatmap.values():
            all_terms.update(year_data.keys())

        years   = sorted(heatmap.keys())
        results = []

        for term in all_terms:
            scores = [(y, heatmap[y].get(term, 0)) for y in years]
            present = [(y, s) for y, s in scores if s > 0]
            if len(present) < 2:
                continue

            first_year = present[0][0]
            peak_year  = max(present, key=lambda x: x[1])[0]
            last_year  = present[-1][0]
            last_score = present[-1][1]
            peak_score = max(s for _, s in present)

            if last_year == years[-1] and last_score > 0.5 * peak_score:
                trajectory = "emerging" if first_year >= years[-3] else "rising"
            elif peak_year < years[-2] and last_score < 0.3 * peak_score:
                trajectory = "declining"
            else:
                trajectory = "peaked"

            results.append({
                "term":       term,
                "trajectory": trajectory,
                "peak_year":  peak_year,
                "first_year": first_year,
                "peak_score": round(peak_score, 3),
            })

        return sorted(results, key=lambda x: x["peak_score"], reverse=True)[:50]
