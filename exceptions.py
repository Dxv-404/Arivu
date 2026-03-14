"""
exceptions.py — Custom exception hierarchy for Arivu.

All exceptions inherit from ArivuError. Flask's error handler catches
ArivuError and returns the correct HTTP status code and JSON body.
"""
import logging

logger = logging.getLogger(__name__)


# ---- Base -------------------------------------------------------------------

class ArivuError(Exception):
    """Base class for all Arivu errors. Carries HTTP status and error code."""
    def __init__(
        self,
        message: str,
        code: str = "INTERNAL_ERROR",
        status_code: int = 500,
        details: dict = None,
    ):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.details = details or {}

    def to_dict(self) -> dict:
        return {
            "error": self.code,
            "message": self.message,
            "details": self.details,
        }


# ---- Paper Resolution -------------------------------------------------------

class PaperNotFoundError(ArivuError):
    """Paper could not be found in any data source."""
    def __init__(self, identifier: str):
        super().__init__(
            message=f"Paper not found: {identifier}",
            code="PAPER_NOT_FOUND",
            status_code=404,
            details={"identifier": identifier},
        )


class PaperResolutionError(ArivuError):
    """Paper lookup encountered an error (API down, timeout, etc.)."""
    def __init__(self, identifier: str, reason: str):
        super().__init__(
            message=f"Could not resolve paper '{identifier}': {reason}",
            code="PAPER_RESOLUTION_ERROR",
            status_code=503,
            details={"identifier": identifier, "reason": reason},
        )


class NoAbstractError(ArivuError):
    """Paper exists but has no usable abstract from any source."""
    def __init__(self, paper_id: str):
        super().__init__(
            message=f"Paper {paper_id} has no abstract available from any source",
            code="NO_ABSTRACT",
            status_code=422,
            details={"paper_id": paper_id},
        )


# ---- Graph Building ---------------------------------------------------------

class GraphBuildError(ArivuError):
    """Fatal error during graph construction."""
    def __init__(self, seed_paper_id: str, reason: str):
        super().__init__(
            message=f"Graph build failed for {seed_paper_id}: {reason}",
            code="GRAPH_BUILD_ERROR",
            status_code=500,
            details={"seed_paper_id": seed_paper_id, "reason": reason},
        )


class GraphTooLargeError(ArivuError):
    """Graph would exceed safe rendering limits."""
    def __init__(self, estimated_size: int, limit: int):
        super().__init__(
            message=f"Graph would contain ~{estimated_size} papers, exceeding limit of {limit}",
            code="GRAPH_TOO_LARGE",
            status_code=422,
            details={"estimated_size": estimated_size, "limit": limit},
        )


class EmptyGraphError(ArivuError):
    """Paper has no references — graph cannot be built."""
    def __init__(self, paper_id: str):
        super().__init__(
            message=f"Paper {paper_id} has no references — cannot build ancestry graph",
            code="EMPTY_GRAPH",
            status_code=422,
            details={"paper_id": paper_id},
        )


# ---- NLP Worker -------------------------------------------------------------

class NLPWorkerError(ArivuError):
    """NLP worker service unavailable or returned an error."""
    def __init__(self, operation: str, reason: str):
        super().__init__(
            message=f"NLP operation '{operation}' failed: {reason}",
            code="NLP_WORKER_ERROR",
            status_code=503,
            details={"operation": operation, "reason": reason},
        )


class NLPTimeoutError(NLPWorkerError):
    """NLP worker took too long to respond."""
    def __init__(self, operation: str, timeout_seconds: int):
        super().__init__(operation, f"timed out after {timeout_seconds}s")
        self.code = "NLP_TIMEOUT"


# ---- Auth & Permissions -----------------------------------------------------

class AuthenticationError(ArivuError):
    """User is not authenticated."""
    def __init__(self):
        super().__init__(
            message="Authentication required",
            code="AUTHENTICATION_REQUIRED",
            status_code=401,
        )


class AuthorizationError(ArivuError):
    """User does not have the required tier."""
    def __init__(self, required_tier: str, current_tier: str):
        super().__init__(
            message=f"This feature requires the '{required_tier}' plan",
            code="INSUFFICIENT_TIER",
            status_code=403,
            details={
                "required_tier": required_tier,
                "current_tier": current_tier,
                "upgrade_url": "/pricing",
            },
        )


class GraphLimitReachedError(ArivuError):
    """Free user has reached their monthly graph limit."""
    def __init__(self, limit: int, reset_date: str):
        super().__init__(
            message=f"You've used all {limit} graphs for this month",
            code="GRAPH_LIMIT_REACHED",
            status_code=429,
            details={"limit": limit, "reset_date": reset_date, "upgrade_url": "/pricing"},
        )


# ---- Rate Limiting ----------------------------------------------------------

class RateLimitError(ArivuError):
    """Request rate limit exceeded on Arivu's own endpoints."""
    def __init__(self, endpoint: str, retry_after: int):
        super().__init__(
            message=f"Rate limit exceeded for {endpoint}. Retry after {retry_after} seconds.",
            code="RATE_LIMIT_EXCEEDED",
            status_code=429,
            details={"endpoint": endpoint, "retry_after": retry_after},
        )


# ---- External APIs ----------------------------------------------------------

class ExternalAPIError(ArivuError):
    """An external API (S2, OpenAlex, etc.) returned an error."""
    def __init__(self, api_name: str, upstream_status: int, message: str):
        super().__init__(
            message=f"{api_name} returned {upstream_status}: {message}",
            code="EXTERNAL_API_ERROR",
            status_code=502,
            details={"api": api_name, "upstream_status": upstream_status},
        )


class ExternalAPIRateLimitError(ExternalAPIError):
    """An external API returned 429 Too Many Requests."""
    def __init__(self, api_name: str, retry_after: int = None):
        super().__init__(api_name, 429, "Rate limit exceeded")
        self.code = "UPSTREAM_RATE_LIMITED"
        self.retry_after = retry_after


# ---- Storage ----------------------------------------------------------------

class StorageError(ArivuError):
    """Cloudflare R2 or file storage operation failed."""
    def __init__(self, operation: str, key: str, reason: str):
        super().__init__(
            message=f"Storage {operation} failed for '{key}': {reason}",
            code="STORAGE_ERROR",
            status_code=500,
            details={"operation": operation, "key": key},
        )


# ---- Validation -------------------------------------------------------------

class ValidationError(ArivuError):
    """Request input failed validation."""
    def __init__(self, field: str, message: str):
        super().__init__(
            message=f"Validation error: {message}",
            code="VALIDATION_ERROR",
            status_code=400,
            details={"field": field},
        )


# ---- Flask Error Handler Registration ---------------------------------------

def register_error_handlers(app):
    """Register all Arivu error types with the Flask app."""
    from flask import jsonify

    @app.errorhandler(ArivuError)
    def handle_arivu_error(e: ArivuError):
        return jsonify(e.to_dict()), e.status_code

    @app.errorhandler(404)
    def handle_404(e):
        return jsonify({"error": "NOT_FOUND", "message": "Page not found"}), 404

    @app.errorhandler(500)
    def handle_500(e):
        logger.error(f"Unhandled exception: {e}", exc_info=True)
        return jsonify({"error": "INTERNAL_ERROR", "message": "An unexpected error occurred"}), 500
