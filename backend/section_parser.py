"""
backend/section_parser.py

Splits plain-text academic paper content into named sections.
Works on text extracted from PDFs (PyMuPDF output) and Europe PMC XML.

Main entry point: extract_sections(text: str) → dict[str, str | None]
"""
import re


# Header patterns that identify the START of each section.
# Listed in detection priority order. Case-insensitive matching.
SECTION_PATTERNS = {
    "abstract": [
        r"^abstract\s*$",
        r"^abstract\s*[:—]",
    ],
    "introduction": [
        r"^1\.?\s+introduction\s*$",
        r"^introduction\s*$",
        r"^i\.\s+introduction\s*$",
    ],
    "related_work": [
        r"^(\d+\.?\s+)?(related work|prior work|background|literature review)\s*$",
        r"^ii\.\s+(related|background)",
    ],
    "methods": [
        r"^(\d+\.?\s+)?(methods?|approach|model|architecture|framework|our method|proposed method)\s*$",
        r"^iii\.\s+(methods?|approach|model)",
        r"^materials?\s+and\s+methods?\s*$",
    ],
    "results": [
        r"^(\d+\.?\s+)?(results?|experiments?|evaluation|benchmarks?|empirical|performance)\s*$",
        r"^iv\.\s+(results?|experiments?|evaluation)",
    ],
    "discussion": [
        r"^(\d+\.?\s+)?(discussions?|analysis|ablation)\s*$",
    ],
    "conclusion": [
        r"^(\d+\.?\s+)?(conclusions?|summary|future work|concluding)\s*$",
        r"^v\.\s+conclusions?",
    ],
    "acknowledgments": [
        r"^acknowledg(e?)ment(s?)\s*$",
    ],
}

# Compiled patterns grouped by section name
_COMPILED = {
    name: [re.compile(p, re.IGNORECASE | re.MULTILINE) for p in patterns]
    for name, patterns in SECTION_PATTERNS.items()
}


def extract_sections(text: str) -> dict:
    """
    Extract named sections from plain-text academic paper content.

    Algorithm:
    1. Split text into lines.
    2. Find lines that match known section header patterns.
    3. Content between consecutive header matches belongs to the preceding section.
    4. If no section headers found, treat entire text as raw (no sections detected).

    Returns dict with keys: abstract, introduction, related_work, methods,
    results, discussion, conclusion, acknowledgments.
    Missing sections have value None.
    """
    lines = text.split("\n")
    sections: dict[str, str | None] = {k: None for k in SECTION_PATTERNS}

    # Find header line indices
    boundaries: list[tuple[int, str]] = []  # (line_idx, section_name)

    for i, line in enumerate(lines):
        stripped = line.strip()
        if len(stripped) > 80 or len(stripped) < 2:
            # Headers are short; skip very long lines and blank lines
            continue
        for section_name, patterns in _COMPILED.items():
            for pattern in patterns:
                if pattern.match(stripped):
                    boundaries.append((i, section_name))
                    break

    if not boundaries:
        # No section structure detected — try to extract abstract by convention
        # (first 150-600 words often is the abstract in unstructured PDFs)
        word_count = 0
        abstract_lines = []
        for line in lines[:80]:
            if word_count > 600:
                break
            if word_count > 150 and line.strip() == "":
                break
            abstract_lines.append(line)
            word_count += len(line.split())
        abstract_text = " ".join(abstract_lines).strip()
        sections["abstract"] = abstract_text if len(abstract_text) > 50 else None
        return sections

    # Extract text between boundaries
    for idx, (line_start, section_name) in enumerate(boundaries):
        # Content starts from line after header
        content_start = line_start + 1
        # Content ends at the next section header or end of document
        content_end = boundaries[idx + 1][0] if idx + 1 < len(boundaries) else len(lines)

        section_text = "\n".join(lines[content_start:content_end]).strip()
        # Clean up excessive whitespace
        section_text = re.sub(r"\n{3,}", "\n\n", section_text)
        section_text = re.sub(r" {2,}", " ", section_text)

        if section_text and len(section_text) > 30:
            sections[section_name] = section_text

    return sections


def detect_text_tier(full_text_obj) -> int:
    """
    Determine text tier from a PaperFullText instance.
    1 = full text with sections (methods-level analysis)
    2 = abstract + introduction
    3 = abstract only
    4 = title only
    """
    if full_text_obj is None:
        return 4
    if full_text_obj.methods:
        return 1
    if full_text_obj.introduction:
        return 2
    if full_text_obj.abstract:
        return 3
    return 4
