"""Resolve configured :class:`ArtifactStorage` implementation."""

from __future__ import annotations

import os

from agent_eval_lab.storage.base import ArtifactStorage, StorageBackend, StorageError
from agent_eval_lab.storage.local import LocalArtifactStorage
from agent_eval_lab.storage.s3 import S3ArtifactStorage


def get_storage_backend() -> ArtifactStorage:
    """
    Return the configured storage backend.

    Reads ``ARTIFACT_STORAGE_BACKEND`` env var:

    * ``"s3"`` → :class:`S3ArtifactStorage` (requires S3 env vars)
    * ``"local"`` → :class:`LocalArtifactStorage` (default)

    This is the single entry point for all storage access.
    Call once at startup or lazily — it is not a singleton
    but construction is cheap for local.

    Never raises on missing S3 config if backend is ``"local"``.
    Raises :class:`StorageError` immediately if backend is ``"s3"`` and
    ``ARTIFACT_S3_BUCKET`` is not set (via :class:`S3ArtifactStorage` ``__init__``).
    """
    raw = os.environ.get("ARTIFACT_STORAGE_BACKEND", "local").strip().lower()
    if raw == StorageBackend.S3.value:
        return S3ArtifactStorage()
    return LocalArtifactStorage()
