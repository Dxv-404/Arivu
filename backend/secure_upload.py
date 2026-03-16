"""
backend/secure_upload.py — SecureFileUploadHandler for PDF uploads (Phase 7)

4-layer validation: size, magic bytes, MIME type, content scan.
Stores validated files in R2 only — never on local filesystem.

CONFLICT-010 resolution: This is a new file. backend/security.py remains a stub.
"""
import hashlib
import logging
from typing import Optional

from backend.config import Config

logger = logging.getLogger(__name__)

# PDF magic bytes
PDF_MAGIC = b"%PDF"
ALLOWED_MIMES = {"application/pdf"}
MAX_FILENAME_LENGTH = 255


class SecureFileUploadHandler:
    """Validates and processes uploaded PDF files."""

    def __init__(self, max_mb: int = None):
        self.max_bytes = (max_mb or Config.MAX_UPLOAD_MB) * 1024 * 1024

    def validate_and_hash(self, file_bytes: bytes, filename: str) -> dict:
        """
        Validate uploaded file. Returns dict with:
          - valid: bool
          - error: str (if invalid)
          - file_hash: str (SHA256, if valid)
          - size_bytes: int
        """
        # Layer 1: Size check
        if len(file_bytes) > self.max_bytes:
            return {
                "valid": False,
                "error": f"File too large. Maximum size: {Config.MAX_UPLOAD_MB}MB",
                "size_bytes": len(file_bytes),
            }

        if len(file_bytes) < 4:
            return {"valid": False, "error": "File too small to be a valid PDF"}

        # Layer 2: Magic bytes
        if not file_bytes[:4].startswith(PDF_MAGIC):
            return {"valid": False, "error": "File is not a valid PDF (magic bytes check failed)"}

        # Layer 3: MIME type via python-magic
        try:
            import magic
            mime = magic.from_buffer(file_bytes[:2048], mime=True)
            if mime not in ALLOWED_MIMES:
                return {"valid": False, "error": f"Invalid file type: {mime}. Only PDF is allowed."}
        except ImportError:
            logger.warning("python-magic not available — skipping MIME validation")
        except Exception as exc:
            logger.warning(f"MIME check failed (non-fatal): {exc}")

        # Layer 4: Content scan — try to open as PDF
        try:
            import fitz  # PyMuPDF
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            page_count = len(doc)
            doc.close()
            if page_count == 0:
                return {"valid": False, "error": "PDF has no pages"}
            if page_count > 200:
                return {"valid": False, "error": "PDF has too many pages (max 200)"}
        except ImportError:
            logger.warning("PyMuPDF not available — skipping content scan")
        except Exception as exc:
            return {"valid": False, "error": f"PDF content scan failed: {str(exc)[:200]}"}

        # Sanitize filename
        safe_name = self._sanitize_filename(filename)

        # Compute hash
        file_hash = hashlib.sha256(file_bytes).hexdigest()

        return {
            "valid": True,
            "file_hash": file_hash,
            "size_bytes": len(file_bytes),
            "filename": safe_name,
        }

    def _sanitize_filename(self, filename: str) -> str:
        """Strip path components, limit length, ensure .pdf extension."""
        import os
        name = os.path.basename(filename or "upload.pdf")
        # Remove anything that isn't alphanumeric, dash, underscore, or dot
        safe = "".join(c for c in name if c.isalnum() or c in ".-_")
        if not safe:
            safe = "upload.pdf"
        if not safe.lower().endswith(".pdf"):
            safe += ".pdf"
        return safe[:MAX_FILENAME_LENGTH]
