"""
backend/prompt_sanitizer.py

PromptSanitizer: injection prevention for LLM calls.
Detects prompt injection attempts and enforces length limits.
Implemented in Phase 3.
"""
import re
import logging

logger = logging.getLogger(__name__)

MAX_INPUT_LENGTH = 2000

# Patterns indicating prompt injection attempts (case-insensitive)
INJECTION_PATTERNS = [
    r"ignore\s+(previous|all|above|prior)\s+(instructions|prompts|rules)",
    r"system\s+prompt",
    r"\bDAN\b",
    r"jailbreak",
    r"reveal\s+(api[_\s]?key|secret|password|token|credentials)",
    r"unrestricted\s+mode",
    r"\bsudo\b",
    r"pretend\s+(you\s+are|to\s+be)",
    r"act\s+as\s+(if|a|an)",
    r"bypass\s+(filter|safety|content|restriction)",
    r"override\s+(instruction|rule|constraint|safety)",
    r"forget\s+(everything|all|previous)",
    r"new\s+instructions?\s*:",
    r"you\s+are\s+now",
    r"disregard\s+(previous|all|above)",
]

_COMPILED_INJECTIONS = [
    re.compile(p, re.IGNORECASE) for p in INJECTION_PATTERNS
]


class PromptSanitizer:
    """
    Sanitize user input before sending to LLM.
    Detects injection attempts, enforces length limits.
    """

    def sanitize(self, input_text: str) -> tuple:
        """
        Sanitize user input text.

        Returns:
            tuple[str | None, str]: (cleaned_text, status)
            status is one of: "clean", "injection_attempt", "truncated", "empty"
        """
        if not input_text or not input_text.strip():
            return (None, "empty")

        text = input_text.strip()

        # Check for injection patterns
        for pattern in _COMPILED_INJECTIONS:
            if pattern.search(text):
                logger.warning("Prompt injection attempt detected")
                return (None, "injection_attempt")

        # Enforce length limit
        if len(text) > MAX_INPUT_LENGTH:
            truncated = text[:MAX_INPUT_LENGTH]
            return (truncated, "truncated")

        return (text, "clean")


# Module-level singleton
prompt_sanitizer = PromptSanitizer()
