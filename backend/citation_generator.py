"""
backend/citation_generator.py — CitationGenerator: 6 citation formats (F4.9)

Generates formatted citations for papers in APA, MLA, Chicago, BibTeX, IEEE, Harvard.
Uses paper metadata from the DB — no external API calls.

Written from scratch (v1 missing).
"""
import logging
from dataclasses import dataclass
from typing import Optional

import backend.db as db

logger = logging.getLogger(__name__)

SUPPORTED_STYLES = ("apa", "mla", "chicago", "bibtex", "ieee", "harvard", "vancouver")


@dataclass
class CitationBundle:
    paper_id: str
    title:    str
    citations: dict  # {style: formatted_string}

    def to_dict(self) -> dict:
        return {
            "paper_id":  self.paper_id,
            "title":     self.title,
            "citations": self.citations,
        }


class CitationGenerator:
    """Stateless — instantiate fresh per request."""

    def generate(self, paper_ids: list, styles: list = None, all_styles: bool = False) -> dict:
        """
        Generate citations for a list of paper IDs.
        Returns: {"citations": {paper_id: {style: text}}}
        """
        if all_styles:
            styles = list(SUPPORTED_STYLES)
        elif not styles:
            styles = ["apa"]

        styles = [s for s in styles if s in SUPPORTED_STYLES]
        results = {}

        for pid in paper_ids[:50]:  # Cap at 50
            paper = db.fetchone(
                "SELECT paper_id, title, authors, year, doi, venue FROM papers WHERE paper_id = %s",
                (pid,),
            )
            if not paper:
                results[pid] = {"error": "paper_not_found"}
                continue

            citations = {}
            for style in styles:
                citations[style] = self._format(paper, style)
            results[pid] = citations

        return {"citations": results}

    def _format(self, paper: dict, style: str) -> str:
        title   = paper.get("title", "Untitled")
        authors = paper.get("authors") or []
        year    = paper.get("year") or "n.d."
        doi     = paper.get("doi") or ""
        venue   = paper.get("venue") or ""

        author_str = self._format_authors(authors, style)

        if style == "apa":
            base = f"{author_str} ({year}). {title}."
            if venue:
                base += f" {venue}."
            if doi:
                base += f" https://doi.org/{doi}"
            return base

        elif style == "mla":
            base = f"{author_str}. \"{title}.\""
            if venue:
                base += f" {venue},"
            base += f" {year}."
            if doi:
                base += f" doi:{doi}."
            return base

        elif style == "chicago":
            base = f"{author_str}. \"{title}.\""
            if venue:
                base += f" {venue}"
            base += f" ({year})."
            if doi:
                base += f" https://doi.org/{doi}."
            return base

        elif style == "bibtex":
            key = (authors[0].split()[-1].lower() if authors else "unknown") + str(year)
            lines = [
                f"@article{{{key},",
                f"  title = {{{title}}},",
                f"  author = {{{' and '.join(authors[:5])}}},",
                f"  year = {{{year}}},",
            ]
            if venue:
                lines.append(f"  journal = {{{venue}}},")
            if doi:
                lines.append(f"  doi = {{{doi}}},")
            lines.append("}")
            return "\n".join(lines)

        elif style == "ieee":
            if authors:
                abbrev = []
                for a in authors[:3]:
                    parts = a.strip().split()
                    if len(parts) >= 2:
                        abbrev.append(f"{parts[0][0]}. {parts[-1]}")
                    else:
                        abbrev.append(a)
                author_str = ", ".join(abbrev)
                if len(authors) > 3:
                    author_str += " et al."
            base = f"{author_str}, \"{title},\""
            if venue:
                base += f" {venue},"
            base += f" {year}."
            if doi:
                base += f" doi: {doi}."
            return base

        elif style == "harvard":
            base = f"{author_str} {year}, '{title}',"
            if venue:
                base += f" {venue}."
            else:
                base += "."
            if doi:
                base += f" Available at: https://doi.org/{doi}."
            return base

        elif style == "vancouver":
            # Vancouver (biomedical): Surname Initials (no periods), up to 6 authors then et al.
            vanc_authors = self._vancouver_authors(authors)
            base = f"{vanc_authors}. {title}."
            if venue:
                base += f" {venue}."
            base += f" {year}"
            if doi:
                base += f". doi:{doi}"
            return base + "."

        return f"{author_str} ({year}). {title}."

    def _format_authors(self, authors: list, style: str) -> str:
        if not authors:
            return "Unknown Author"

        if style in ("apa", "harvard"):
            if len(authors) == 1:
                return self._last_first(authors[0])
            elif len(authors) == 2:
                return f"{self._last_first(authors[0])} & {self._last_first(authors[1])}"
            else:
                return f"{self._last_first(authors[0])} et al."

        elif style in ("mla", "chicago"):
            if len(authors) == 1:
                return self._last_first(authors[0])
            elif len(authors) <= 3:
                formatted = [self._last_first(authors[0])]
                for a in authors[1:]:
                    parts = a.strip().split()
                    formatted.append(" ".join(parts))
                return ", and ".join([", ".join(formatted[:-1]), formatted[-1]]) if len(formatted) > 1 else formatted[0]
            else:
                return f"{self._last_first(authors[0])}, et al."

        return ", ".join(authors[:3]) + (" et al." if len(authors) > 3 else "")

    def _last_first(self, name: str) -> str:
        """Convert 'First Last' to 'Last, F.'"""
        parts = name.strip().split()
        if len(parts) >= 2:
            return f"{parts[-1]}, {parts[0][0]}."
        return name

    def _vancouver_authors(self, authors: list) -> str:
        """Vancouver format: 'Surname AB' (no periods/commas in initials), up to 6 then et al."""
        if not authors:
            return "Unknown Author"
        formatted = []
        limit = min(len(authors), 6)
        for a in authors[:limit]:
            parts = a.strip().split()
            if len(parts) >= 2:
                surname = parts[-1]
                initials = "".join(p[0].upper() for p in parts[:-1])
                formatted.append(f"{surname} {initials}")
            else:
                formatted.append(a)
        result = ", ".join(formatted)
        if len(authors) > 6:
            result += ", et al"
        return result
