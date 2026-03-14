"""
conftest.py — pytest root configuration.

CRITICAL: load_dotenv() MUST be called here at module level, before any
other imports. This ensures .env is loaded before Config.__init__() runs
when backend.config is first imported. If load_dotenv() runs after
backend.config is imported, _require("FLASK_SECRET_KEY") will call
sys.exit(1) because the var is not yet in os.environ.

pytest always processes conftest.py before importing test files, so the
ordering is guaranteed: load_dotenv() -> Config() -> test imports.
"""
import sys
from pathlib import Path

# Step 1: Load .env FIRST — before any app imports
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass  # python-dotenv not installed; rely on vars already being set in env

# Step 2: Add project root to sys.path so `from app import create_app` works
sys.path.insert(0, str(Path(__file__).parent))
