"""
backend/adversarial_reviewer.py — AdversarialReviewer (F4.1)

Analyzes a paper (PDF or abstract) and generates an adversarial review:
- Missing citations, weak citation claims
- Novelty assessment against existing literature
- Intellectual positioning
- Reviewer criticisms and strengths

FIX: LLMClient → get_llm_client() (spec bug)
FIX: R2Client().upload_bytes() → R2Client().upload() (spec bug)
FIX: ExportGenerator.generate_pdf() → inline PDF generation (spec bug)
"""
import json
import logging
import hashlib
from dataclasses import dataclass, field
from typing import Optional

import backend.db as db
from backend.config import Config

logger = logging.getLogger(__name__)

MAX_LANDSCAPE_PAPERS = 15
MAX_ABSTRACT_CHARS   = 4000


@dataclass
class AdversarialReviewResult:
    paper_title:          str
    paper_abstract:       str
    weak_citation_claims: list
    missing_citations:    list
    missing_by_type:      dict
    novelty_ancestors:    list
    novelty_assessment:   str
    intellectual_position: str
    natural_comparators:  list
    reviewer_criticisms:  list
    identified_strengths: list
    confidence:           str

    def to_dict(self) -> dict:
        return {
            "paper_title":         self.paper_title,
            "paper_abstract":      self.paper_abstract[:500] + ("..." if len(self.paper_abstract) > 500 else ""),
            "confidence":          self.confidence,
            "citation_weaknesses": self.weak_citation_claims,
            "missing_citations": {
                "all":     self.missing_citations,
                "by_type": self.missing_by_type,
            },
            "novelty": {
                "ancestors":  self.novelty_ancestors,
                "assessment": self.novelty_assessment,
            },
            "landscape": {
                "position":            self.intellectual_position,
                "natural_comparators": self.natural_comparators,
            },
            "reviewer_criticisms": self.reviewer_criticisms,
            "strengths":           self.identified_strengths,
        }


class AdversarialReviewer:

    def review_from_pdf(
        self, pdf_bytes: bytes, filename: str, user_id: str, review_id: str = ""
    ) -> AdversarialReviewResult:
        """Full review from PDF upload. Generates PDF report and stores in R2."""
        try:
            import fitz  # PyMuPDF
            doc  = fitz.open(stream=pdf_bytes, filetype="pdf")
            text = "\n".join(page.get_text() for page in doc)
            doc.close()
        except Exception as exc:
            logger.warning(f"PDF extraction failed: {exc} — falling back to abstract-only")
            return self._review_abstract_only("Uploaded PDF", "", "pdf_extraction_failed")

        abstract = self._extract_abstract(text)
        title    = self._extract_title(text)
        result   = self._run_analysis(title, abstract, text, confidence="full_text")

        # Generate PDF report and upload to R2
        if review_id:
            try:
                self._generate_and_store_report(result, review_id)
            except Exception as exc:
                logger.warning(f"PDF report generation failed (non-fatal): {exc}")

        return result

    def _generate_and_store_report(self, result: "AdversarialReviewResult", review_id: str):
        """Generate a text-based report and upload to R2."""
        from backend.r2_client import R2Client

        # Build a plain-text report since ExportGenerator.generate_pdf() doesn't exist
        lines = [
            f"ADVERSARIAL REVIEW REPORT",
            f"{'=' * 60}",
            f"Paper: {result.paper_title}",
            f"Confidence: {result.confidence}",
            f"",
            f"INTELLECTUAL POSITION",
            f"{'-' * 40}",
            result.intellectual_position,
            f"",
            f"MISSING CITATIONS ({len(result.missing_citations)} found)",
            f"{'-' * 40}",
        ]
        for m in result.missing_citations[:10]:
            lines.append(f"  - {m.get('title', '?')} (similarity: {m.get('similarity', 0):.2f})")

        lines.extend([
            f"",
            f"NOVELTY ASSESSMENT",
            f"{'-' * 40}",
            f"Assessment: {result.novelty_assessment}",
            f"Closest ancestors: {len(result.novelty_ancestors)}",
            f"",
            f"REVIEWER CRITICISMS ({len(result.reviewer_criticisms)})",
            f"{'-' * 40}",
        ])
        for c in result.reviewer_criticisms:
            lines.append(f"  [{c.get('severity', '?').upper()}] {c.get('criticism', '?')}")

        lines.extend([
            f"",
            f"STRENGTHS ({len(result.identified_strengths)})",
            f"{'-' * 40}",
        ])
        for s in result.identified_strengths:
            lines.append(f"  + {s.get('strength', '')}")

        report_text = "\n".join(lines)
        r2_key = f"adversarial_reviews/{review_id}/report.txt"

        try:
            R2Client().upload(r2_key, report_text.encode("utf-8"), content_type="text/plain")
            db.execute(
                "UPDATE adversarial_reviews SET report_r2_key = %s WHERE review_id = %s::uuid",
                (r2_key, review_id),
            )
            logger.info(f"Adversarial review report stored: {r2_key}")
        except Exception as exc:
            logger.warning(f"R2 upload failed: {exc}")

    def review_from_abstract(self, title: str, abstract: str) -> AdversarialReviewResult:
        return self._run_analysis(title, abstract, abstract, confidence="abstract_only")

    def _review_abstract_only(self, title, abstract, confidence):
        return AdversarialReviewResult(
            paper_title=title,
            paper_abstract=abstract or "",
            weak_citation_claims=[],
            missing_citations=[],
            missing_by_type={},
            novelty_ancestors=[],
            novelty_assessment="insufficient_data",
            intellectual_position="Could not determine — PDF extraction failed.",
            natural_comparators=[],
            reviewer_criticisms=[],
            identified_strengths=[],
            confidence=confidence,
        )

    def _run_analysis(self, title, abstract, full_text, confidence) -> AdversarialReviewResult:
        from backend.llm_client import get_llm_client
        llm            = get_llm_client()
        abstract_trunc = abstract[:MAX_ABSTRACT_CHARS]
        landscape      = self._find_landscape_papers(abstract_trunc)
        missing, missing_by_type = self._find_missing_citations(abstract_trunc, landscape, full_text)
        novelty_ancestors, novelty_assessment = self._assess_novelty(abstract_trunc, landscape)
        natural_comparators = landscape[:5]
        criticisms, strengths = self._generate_criticisms(title, abstract_trunc, missing, novelty_assessment, llm)
        weak_claims = self._check_citation_claims(full_text, landscape) if confidence == "full_text" else []
        position    = self._describe_position(abstract_trunc, landscape, llm)

        return AdversarialReviewResult(
            paper_title=title or "Untitled",
            paper_abstract=abstract_trunc,
            weak_citation_claims=weak_claims,
            missing_citations=missing,
            missing_by_type=missing_by_type,
            novelty_ancestors=novelty_ancestors,
            novelty_assessment=novelty_assessment,
            intellectual_position=position,
            natural_comparators=natural_comparators,
            reviewer_criticisms=criticisms,
            identified_strengths=strengths,
            confidence=confidence,
        )

    def _find_landscape_papers(self, abstract: str) -> list:
        try:
            import httpx
            resp = httpx.post(
                f"{Config.NLP_WORKER_URL}/encode_batch",
                json={"texts": [abstract], "model": "abstract"},
                headers={"X-API-Key": Config.WORKER_SECRET},
                timeout=15.0,
            )
            emb     = resp.json()["embeddings"][0]
            emb_str = "[" + ",".join(str(x) for x in emb) + "]"
            rows    = db.fetchall(
                """
                SELECT p.paper_id, p.title, p.year, p.citation_count,
                       p.fields_of_study, p.abstract,
                       1 - (pe.embedding <=> %s::vector) AS similarity
                FROM paper_embeddings pe
                JOIN papers p ON p.paper_id = pe.paper_id
                WHERE p.abstract IS NOT NULL
                  AND 1 - (pe.embedding <=> %s::vector) > 0.5
                ORDER BY pe.embedding <=> %s::vector
                LIMIT %s
                """,
                (emb_str, emb_str, emb_str, MAX_LANDSCAPE_PAPERS),
            )
            return [dict(r) for r in rows]
        except Exception as exc:
            logger.warning(f"Landscape search failed: {exc}")
            return []

    def _find_missing_citations(self, abstract, landscape, full_text):
        mentioned_ids: set = set()
        for paper in landscape:
            title_words = set((paper.get("title") or "").lower().split())
            text_words = set(abstract.lower().split())
            if len(title_words & text_words) > 3:
                mentioned_ids.add(paper["paper_id"])

        missing = [p for p in landscape
                   if p["paper_id"] not in mentioned_ids and p.get("similarity", 0) > 0.65]

        by_type: dict = {"unknown_concurrent": [], "known_skipped": [], "conspicuous": []}
        for paper in missing:
            sim = paper.get("similarity", 0)
            if sim > 0.80:
                by_type["conspicuous"].append({"paper_id": paper["paper_id"], "title": paper.get("title", ""), "similarity": sim})
            elif sim > 0.70:
                by_type["known_skipped"].append({"paper_id": paper["paper_id"], "title": paper.get("title", ""), "similarity": sim})
            else:
                by_type["unknown_concurrent"].append({"paper_id": paper["paper_id"], "title": paper.get("title", ""), "similarity": sim})

        missing_out = [{"paper_id": p["paper_id"], "title": p.get("title", ""),
                        "similarity": p.get("similarity", 0), "category": "missing"} for p in missing]
        return missing_out, by_type

    def _assess_novelty(self, abstract, landscape):
        ancestors = [{"paper_id": p["paper_id"], "title": p.get("title", ""),
                      "similarity": p.get("similarity", 0)}
                     for p in landscape if p.get("similarity", 0) > 0.72]
        if not ancestors:
            return [], "clear_contribution"
        if any(a["similarity"] > 0.85 for a in ancestors):
            return ancestors, "potential_overlap"
        return ancestors, "incremental_extension"

    def _check_citation_claims(self, full_text, landscape):
        """Check for weak citation claims in full text."""
        weak = []
        import re
        # Look for hedging language near citations
        patterns = [
            r'(?:it has been shown|some studies|previous work)\b',
            r'(?:widely known|well established|common knowledge)\b',
        ]
        for pattern in patterns:
            matches = re.findall(pattern, full_text.lower())
            if matches:
                weak.append({
                    "claim_type": "hedging_language",
                    "count": len(matches),
                    "suggestion": "Replace vague attribution with specific citations.",
                })
        return weak[:5]

    def _generate_criticisms(self, title, abstract, missing, novelty, llm):
        try:
            system = (
                "You are a tough but fair peer reviewer. Given a paper's abstract and analysis data, "
                "generate 3-5 criticisms (each with severity: minor/major/critical) and 2-3 strengths. "
                "Format: CRITICISM: [severity] description\\nSTRENGTH: description"
            )
            user = (
                f"Title: {title}\nAbstract: {abstract[:1500]}\n"
                f"Missing citations: {len(missing)}\nNovelty: {novelty}\n"
                f"Generate criticisms and strengths."
            )
            response = llm.generate_chat_response(system, user) or ""
            criticisms = []
            strengths = []
            for line in response.strip().split("\n"):
                line = line.strip()
                if line.startswith("CRITICISM:"):
                    text = line[len("CRITICISM:"):].strip()
                    # Extract severity
                    severity = "minor"
                    for s in ["critical", "major", "minor"]:
                        if text.lower().startswith(f"[{s}]"):
                            severity = s
                            text = text[len(f"[{s}]"):].strip()
                            break
                    criticisms.append({"severity": severity, "criticism": text})
                elif line.startswith("STRENGTH:"):
                    strengths.append({"strength": line[len("STRENGTH:"):].strip()})
            return criticisms or [{"severity": "minor", "criticism": "No specific criticisms generated."}], strengths
        except Exception as exc:
            logger.warning(f"Criticism generation failed: {exc}")
            return [{"severity": "minor", "criticism": "Analysis unavailable."}], []

    def _describe_position(self, abstract, landscape, llm):
        if not landscape:
            return "No comparable papers found in the database."
        try:
            system = "Describe this paper's intellectual position relative to the landscape in 2-3 sentences."
            comparators = ", ".join(p.get("title", "?")[:60] for p in landscape[:5])
            user = f"Abstract: {abstract[:1000]}\nClosest papers: {comparators}"
            return llm.generate_chat_response(system, user) or "Position analysis unavailable."
        except Exception:
            return "Position analysis unavailable."

    def _extract_abstract(self, text: str) -> str:
        """Extract abstract from full text."""
        import re
        match = re.search(r'abstract[:\s]*\n?(.*?)(?:\n\s*\n|\bintroduction\b|\b1[\.\s])',
                          text, re.IGNORECASE | re.DOTALL)
        if match:
            return match.group(1).strip()[:MAX_ABSTRACT_CHARS]
        return text[:MAX_ABSTRACT_CHARS]

    def _extract_title(self, text: str) -> str:
        """Extract title from first meaningful line of text."""
        lines = text.strip().split("\n")
        for line in lines[:10]:
            line = line.strip()
            if len(line) > 10 and len(line) < 300:
                return line
        return "Untitled"
