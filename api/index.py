"""Vercel serverless entry point — exports the FastAPI ASGI app."""
import sys
import os

# Ensure the project root is importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.main import app  # noqa: F401 — Vercel detects the `app` ASGI variable
