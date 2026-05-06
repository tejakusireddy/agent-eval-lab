"""Local filesystem artifact storage."""

from __future__ import annotations

import os
from pathlib import Path

from agent_eval_lab.storage.base import ArtifactStorage, StorageError


class LocalArtifactStorage(ArtifactStorage):
    """
    Local filesystem storage backend.

    Used for development and when S3 is not configured.
    Base directory: ``ARTIFACT_LOCAL_PATH`` env var, default:
    ``{repo_root}/artifacts/`` (repo root is parent of ``agent_eval_lab`` package).
    """

    def __init__(self, base_path: Path | None = None) -> None:
        default_root = (Path(__file__).resolve().parent.parent.parent / "artifacts").resolve()
        if base_path is not None:
            self.base_path = Path(base_path).resolve()
        else:
            env_path = os.environ.get("ARTIFACT_LOCAL_PATH")
            self.base_path = (
                Path(env_path).resolve() if env_path else default_root
            )
        self.base_path.mkdir(parents=True, exist_ok=True)

    def _abs_path(self, path: str) -> Path:
        normalized = path.replace("\\", "/").lstrip("/")
        dest = (self.base_path / normalized).resolve()
        try:
            dest.relative_to(self.base_path)
        except ValueError as e:
            raise StorageError(
                f"Invalid storage path (outside base directory): {path!r}"
            ) from e
        return dest

    def put(
        self,
        path: str,
        data: bytes,
        content_type: str = "application/octet-stream",
        metadata: dict[str, str] | None = None,
    ) -> str:
        _ = content_type, metadata  # local backend does not persist MIME or metadata
        dest = self._abs_path(path)
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
        except OSError as e:
            raise StorageError(f"Failed to write artifact {path!r}: {e}") from e
        return dest.as_uri()

    def get(self, path: str) -> bytes:
        dest = self._abs_path(path)
        try:
            if not dest.is_file():
                raise StorageError(f"Artifact not found: {path!r}")
            return dest.read_bytes()
        except OSError as e:
            raise StorageError(f"Failed to read artifact {path!r}: {e}") from e

    def delete(self, path: str) -> None:
        dest = self._abs_path(path)
        try:
            if dest.is_file():
                dest.unlink()
        except OSError:
            return

    def exists(self, path: str) -> bool:
        dest = self._abs_path(path)
        return dest.is_file()

    def get_url(self, path: str, expires_in_seconds: int = 3600) -> str:
        _ = expires_in_seconds  # not applicable for local files
        return self._abs_path(path).as_uri()
