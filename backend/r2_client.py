"""
r2_client.py — Cloudflare R2 object storage client.

R2 is S3-compatible. We use boto3 with a custom endpoint_url.
Credentials come exclusively from Config (environment variables).

Key naming conventions (never deviate from these):
    graphs/{graph_id}.json         — built graph JSON for D3.js
    full_text/{paper_id}.txt       — extracted full text (section-structured)
    exports/{session_id}/{name}    — generated export files
    precomputed/{slug}.json        — pre-built gallery graphs
"""
import json
import logging
from typing import Optional

import boto3
from botocore.exceptions import ClientError

from exceptions import StorageError

logger = logging.getLogger(__name__)


class R2Client:
    """
    Cloudflare R2 object storage wrapper.

    Instantiated once per process. The Config object is passed in so this
    class never reads os.environ directly.
    """

    def __init__(self, config):
        """
        Args:
            config: the Config singleton from backend/config.py
        """
        self._bucket = config.R2_BUCKET_NAME
        self._enabled = config.R2_ENABLED

        if not self._enabled:
            logger.warning(
                "R2 credentials not configured — R2Client running in no-op mode. "
                "Graph caching disabled."
            )
            self._client = None
            return

        self._client = boto3.client(
            "s3",
            endpoint_url=(
                f"https://{config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
            ),
            aws_access_key_id=config.R2_ACCESS_KEY_ID,
            aws_secret_access_key=config.R2_SECRET_ACCESS_KEY,
            region_name="auto",
        )
        logger.info(f"R2Client initialized — bucket: {self._bucket}")

    # ─── Core operations ─────────────────────────────────────────────────────

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        """Upload bytes. Silently skips if R2 is not configured."""
        if not self._enabled:
            return
        try:
            self._client.put_object(
                Bucket=self._bucket,
                Key=key,
                Body=data,
                ContentType=content_type,
            )
            logger.debug(f"R2 PUT {key} ({len(data)} bytes)")
        except ClientError as e:
            raise StorageError("upload", key, str(e)) from e

    def get(self, key: str) -> Optional[bytes]:
        """
        Download and return bytes, or None if the key does not exist.
        Returns None (not raises) on missing key — callers check None.
        """
        if not self._enabled:
            return None
        try:
            response = self._client.get_object(Bucket=self._bucket, Key=key)
            return response["Body"].read()
        except ClientError as e:
            code = e.response["Error"]["Code"]
            if code in ("NoSuchKey", "404"):
                return None
            raise StorageError("download", key, str(e)) from e

    def exists(self, key: str) -> bool:
        """Return True if the key exists. Returns False if R2 not configured."""
        if not self._enabled:
            return False
        try:
            self._client.head_object(Bucket=self._bucket, Key=key)
            return True
        except ClientError as e:
            if e.response["Error"]["Code"] in ("404", "NoSuchKey"):
                return False
            raise StorageError("exists", key, str(e)) from e

    def delete(self, key: str) -> None:
        """Delete a key. Silently skips if R2 not configured or key missing."""
        if not self._enabled:
            return
        try:
            self._client.delete_object(Bucket=self._bucket, Key=key)
        except ClientError as e:
            raise StorageError("delete", key, str(e)) from e

    # ─── JSON convenience methods ─────────────────────────────────────────────

    def put_json(self, key: str, data: dict) -> None:
        """Serialize dict to UTF-8 JSON and upload as application/json."""
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.put(key, payload, content_type="application/json")

    def get_json(self, key: str) -> Optional[dict]:
        """Download and deserialize JSON. Returns None if key missing."""
        raw = self.get(key)
        if raw is None:
            return None
        return json.loads(raw.decode("utf-8"))

    # ─── Text convenience methods ─────────────────────────────────────────────

    def put_text(self, key: str, text: str) -> None:
        """Upload a UTF-8 text string."""
        self.put(key, text.encode("utf-8"), content_type="text/plain; charset=utf-8")

    def get_text(self, key: str) -> Optional[str]:
        """Download a UTF-8 text string. Returns None if key missing."""
        raw = self.get(key)
        if raw is None:
            return None
        return raw.decode("utf-8")
