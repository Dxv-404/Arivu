"""
backend/researcher_profiles.py — ResearcherProfileBuilder (F3.1)

Builds researcher profiles from graph data. Profiles include contribution type
classification, intellectual heroes, and citation patterns.
"""
import hashlib
import logging
from collections import defaultdict
from dataclasses import dataclass
from typing import Optional

import backend.db as db

logger = logging.getLogger(__name__)


@dataclass
class ResearcherProfile:
    author_id:          str
    display_name:       str
    paper_count:        int
    contribution_type:  Optional[str]
    contribution_types: dict  # {type: count}
    intellectual_heroes: list
    h_index:            Optional[int]

    def to_dict(self) -> dict:
        return {
            "author_id":          self.author_id,
            "display_name":       self.display_name,
            "paper_count":        self.paper_count,
            "contribution_type":  self.contribution_type,
            "contribution_types": self.contribution_types,
            "intellectual_heroes": self.intellectual_heroes,
            "h_index":            self.h_index,
        }


class ResearcherProfileBuilder:
    """Stateless — instantiate fresh per request."""

    def build_for_author(self, author_id: str, graph_json: Optional[dict] = None) -> dict:
        """Route-facing alias."""
        return self.build_profile(author_id, graph_json)

    def build_profile(self, author_id: str, graph_json: Optional[dict] = None) -> dict:
        """Build or retrieve a researcher profile."""
        # Check for cached profile
        cached = db.fetchone(
            "SELECT profile_json, display_name, paper_count, contribution_type, "
            "h_index, intellectual_heroes FROM researcher_profiles WHERE author_id = %s",
            (author_id,),
        )
        if cached and cached.get("profile_json"):
            return cached["profile_json"]

        # Build from graph if available
        if graph_json:
            return self._build_from_graph(author_id, graph_json)

        # Minimal profile from DB
        row = db.fetchone(
            "SELECT display_name FROM researcher_profiles WHERE author_id = %s",
            (author_id,),
        )
        if row:
            return {"author_id": author_id, "display_name": row["display_name"],
                    "paper_count": 0, "contribution_type": None,
                    "contribution_types": {}, "intellectual_heroes": [], "h_index": None}

        return {"error": "author_not_found", "author_id": author_id}

    def _build_from_graph(self, author_id: str, graph_json: dict) -> dict:
        nodes = graph_json.get("nodes", [])
        edges = graph_json.get("edges", [])

        # Find papers by this author
        author_papers = []
        display_name  = author_id
        for node in nodes:
            authors = node.get("authors") or []
            for a in authors:
                a_id = hashlib.sha256(a.strip().lower().encode()).hexdigest()[:32]
                if a_id == author_id:
                    author_papers.append(node)
                    display_name = a
                    break

        if not author_papers:
            return {"author_id": author_id, "display_name": display_name,
                    "paper_count": 0, "contribution_type": None,
                    "contribution_types": {}, "intellectual_heroes": [], "h_index": None}

        # Classify contribution types from edges
        contribution_types: dict = defaultdict(int)
        for e in edges:
            src = e.get("source") or e.get("citing_paper_id", "")
            if any(n["id"] == src for n in author_papers):
                mt = e.get("mutation_type", "unknown")
                contribution_types[mt] += 1

        # Determine primary contribution type
        type_mapping = {
            "adoption":       "synthesizer",
            "generalization": "pioneer",
            "specialization": "refiner",
            "contradiction":  "contradictor",
            "hybridization":  "bridge",
        }
        primary_type = None
        if contribution_types:
            top_mutation = max(contribution_types, key=contribution_types.get)
            primary_type = type_mapping.get(top_mutation, "synthesizer")

        # Find intellectual heroes (most cited by this author)
        hero_counts: dict = defaultdict(int)
        author_ids = {n["id"] for n in author_papers}
        for e in edges:
            src = e.get("source") or e.get("citing_paper_id", "")
            tgt = e.get("target") or e.get("cited_paper_id", "")
            if src in author_ids:
                hero_counts[tgt] += 1

        node_by_id = {n["id"]: n for n in nodes}
        heroes = sorted(hero_counts.items(), key=lambda x: x[1], reverse=True)[:5]
        intellectual_heroes = [
            {"paper_id": pid, "title": node_by_id.get(pid, {}).get("title", ""), "citation_count": cnt}
            for pid, cnt in heroes
        ]

        profile = ResearcherProfile(
            author_id=author_id,
            display_name=display_name,
            paper_count=len(author_papers),
            contribution_type=primary_type,
            contribution_types=dict(contribution_types),
            intellectual_heroes=intellectual_heroes,
            h_index=None,
        )

        # Cache the profile
        try:
            import json
            db.execute(
                """
                UPDATE researcher_profiles
                SET display_name=%s, paper_count=%s, contribution_type=%s,
                    intellectual_heroes=%s, profile_json=%s, computed_at=NOW()
                WHERE author_id=%s
                """,
                (display_name, len(author_papers), primary_type,
                 json.dumps(intellectual_heroes), json.dumps(profile.to_dict()),
                 author_id),
            )
        except Exception as exc:
            logger.warning(f"Profile cache update failed: {exc}")

        return profile.to_dict()

    def list_profiles(self, limit: int = 20) -> list:
        rows = db.fetchall(
            "SELECT author_id, display_name, paper_count, contribution_type, h_index "
            "FROM researcher_profiles WHERE paper_count > 0 "
            "ORDER BY paper_count DESC LIMIT %s",
            (limit,),
        )
        return [dict(r) for r in rows]
