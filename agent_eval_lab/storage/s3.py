"""AWS S3 artifact storage (optional boto3)."""

from __future__ import annotations

import os
from typing import Any

from agent_eval_lab.storage.base import ArtifactStorage, StorageError


class S3ArtifactStorage(ArtifactStorage):
    """
    AWS S3 storage backend.

    Required env vars:
      ``ARTIFACT_S3_BUCKET`` — bucket name
      ``ARTIFACT_S3_REGION`` — AWS region (default: us-east-1)
      ``AWS_ACCESS_KEY_ID`` — AWS credentials
      ``AWS_SECRET_ACCESS_KEY`` — AWS credentials

    Optional:
      ``ARTIFACT_S3_PREFIX`` — key prefix (default: ``artifacts/``)
      ``ARTIFACT_S3_ENDPOINT_URL`` — override endpoint (for testing)
    """

    def __init__(
        self,
        bucket: str | None = None,
        region: str | None = None,
        prefix: str | None = None,
        endpoint_url: str | None = None,
    ) -> None:
        self.bucket = bucket or os.environ.get("ARTIFACT_S3_BUCKET", "")
        self.region = region or os.environ.get("ARTIFACT_S3_REGION", "us-east-1")
        self.prefix = prefix or os.environ.get("ARTIFACT_S3_PREFIX", "artifacts/")
        raw_endpoint = endpoint_url or os.environ.get("ARTIFACT_S3_ENDPOINT_URL")
        self.endpoint_url: str | None = (
            raw_endpoint.strip() if raw_endpoint and raw_endpoint.strip() else None
        )
        if not self.bucket:
            raise StorageError("ARTIFACT_S3_BUCKET is required for S3 storage")

    def _client(self) -> Any:
        try:
            import boto3
        except ImportError as e:
            raise StorageError(
                "boto3 is required for S3 storage: pip install boto3"
            ) from e
        return boto3.client(
            "s3",
            region_name=self.region,
            endpoint_url=self.endpoint_url,
        )

    def _full_key(self, path: str) -> str:
        p = path.replace("\\", "/").lstrip("/")
        prefix = self.prefix.rstrip("/")
        return f"{prefix}/{p}" if prefix else p

    def put(
        self,
        path: str,
        data: bytes,
        content_type: str = "application/octet-stream",
        metadata: dict[str, str] | None = None,
    ) -> str:
        key = self._full_key(path)
        client = self._client()
        extra: dict[str, Any] = {
            "Bucket": self.bucket,
            "Key": key,
            "Body": data,
            "ContentType": content_type,
        }
        if metadata:
            extra["Metadata"] = metadata
        try:
            client.put_object(**extra)
        except Exception as e:
            raise StorageError(f"S3 put_object failed for {key!r}: {e}") from e
        return f"s3://{self.bucket}/{key}"

    def get(self, path: str) -> bytes:
        from botocore.exceptions import ClientError

        key = self._full_key(path)
        client = self._client()
        try:
            resp = client.get_object(Bucket=self.bucket, Key=key)
            body = resp["Body"].read()
            if not isinstance(body, bytes):
                raise StorageError(f"S3 body was not bytes for {key!r}")
            return body
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            if code in ("404", "NoSuchKey", "NotFound"):
                raise StorageError(f"Artifact not found: {path!r}") from e
            raise StorageError(f"S3 get_object failed for {key!r}: {e}") from e
        except Exception as e:
            raise StorageError(f"S3 read failed for {key!r}: {e}") from e

    def delete(self, path: str) -> None:
        from botocore.exceptions import ClientError

        key = self._full_key(path)
        client = self._client()
        try:
            client.delete_object(Bucket=self.bucket, Key=key)
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            if code in ("404", "NoSuchKey", "NotFound"):
                return
            raise StorageError(f"S3 delete_object failed for {key!r}: {e}") from e
        except Exception as e:
            raise StorageError(f"S3 delete failed for {key!r}: {e}") from e

    def exists(self, path: str) -> bool:
        from botocore.exceptions import ClientError

        key = self._full_key(path)
        client = self._client()
        try:
            client.head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            if code in ("404", "NoSuchKey", "NotFound"):
                return False
            raise StorageError(f"S3 head_object failed for {key!r}: {e}") from e
        except Exception as e:
            raise StorageError(f"S3 exists check failed for {key!r}: {e}") from e

    def get_url(self, path: str, expires_in_seconds: int = 3600) -> str:
        key = self._full_key(path)
        client = self._client()
        try:
            return client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.bucket, "Key": key},
                ExpiresIn=expires_in_seconds,
            )
        except Exception as e:
            raise StorageError(
                f"S3 generate_presigned_url failed for {key!r}: {e}"
            ) from e
