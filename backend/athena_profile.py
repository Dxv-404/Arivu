"""
backend/athena_profile.py

Session profile for adaptive behavior. Stub in Phase A, real in Phase F.
Per ATHENA_CLAUDE.md Section 2.11 and ATHENA_PHASE_A.md Section 2.1.16.
"""


class SessionProfile:
    """Stub. Returns neutral profile. Real implementation in Phase F."""

    def get_model_config(self):
        return {"model_override": None, "max_prose_tokens": 300, "skip_gemini": False}

    def to_context_string(self):
        return ""

    def update(self, *args, **kwargs):
        pass

    def to_dict(self):
        return {"message_count": 0, "depth_preference": "balanced"}
