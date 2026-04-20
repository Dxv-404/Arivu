# conftest.py — pytest root configuration.
# Updated for async test support in Phase 2.
# pytest-asyncio requires asyncio_mode="auto" (set in pytest.ini) for
# coroutine test functions. The conftest sets up the path and env.

import sys
import os
from pathlib import Path

# Step 1: Load .env FIRST — before any app imports
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass  # python-dotenv not installed; rely on vars already being set in env

# Step 2: Add project root to sys.path so all backend imports resolve
sys.path.insert(0, str(Path(__file__).parent))

# Step 3: Shared Flask test client fixture for all test files
import pytest

@pytest.fixture
def client():
    """Create a Flask test client. Available to all test files."""
    from app import create_app
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c
