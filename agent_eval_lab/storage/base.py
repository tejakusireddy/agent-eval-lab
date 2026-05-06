"""Abstract artifact storage interface."""

from __future__ import annotations

from abc import ABC, abstractmethod
from enum import Enum


class StorageBackend(str, Enum):
    """Supported storage backend identifiers (env ``ARTIFACT_STORAGE_BACKEND``)."""

    LOCAL = "local"
    S3 = "s3"


class StorageError(Exception):
    """Raised when a storage operation fails unrecoverably."""

    pass


class ArtifactStorage(ABC):
    """
    Abstract storage backend for evaluation artifacts.

    All paths use forward slashes regardless of OS.
    Path format: ``{evaluation_id}/{artifact_type}/{filename}``
    Example: ``eval_abc123/reports/report.html``
    """

    @abstractmethod
    def put(
        self,
        path: str,
        data: bytes,
        content_type: str = "application/octet-stream",
        metadata: dict[str, str] | None = None,
    ) -> str:
        """
        Store artifact. Returns the canonical URL or path.

        Args:
            path: Storage path (forward-slash separated)
            data: Raw bytes to store
            content_type: MIME type
            metadata: Optional key-value metadata

        Returns:
            Canonical reference string (``s3://bucket/path`` or
            ``file:///abs/path``)

        Raises:
            StorageError: If write fails unrecoverably
        """
        ...

    @abstractmethod
    def get(self, path: str) -> bytes:
        """
        Retrieve artifact by path.

        Raises:
            StorageError: If not found or read fails
        """
        ...

    @abstractmethod
    def delete(self, path: str) -> None:
        """Delete artifact. No-op if not found."""
        ...

    @abstractmethod
    def exists(self, path: str) -> bool:
        """Return True if artifact exists."""
        ...

    @abstractmethod
    def get_url(self, path: str, expires_in_seconds: int = 3600) -> str:
        """
        Return a URL to access the artifact.

        Local: ``file://`` URL.
        S3: presigned URL valid for ``expires_in_seconds``.
        """
        ...
