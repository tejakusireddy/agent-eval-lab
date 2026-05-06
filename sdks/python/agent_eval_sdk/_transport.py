"""HTTP transport using stdlib only (urllib)."""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from typing import Any

from agent_eval_sdk.models import TracerConfig


def _normalize_base_url(url: str) -> str:
    """Strip trailing slashes from base URL."""
    return url.rstrip("/")


def send_event(event: dict[str, Any], config: TracerConfig) -> None:
    """POST ``event`` to the ingest endpoint.

    On any failure (network, timeout, HTTP error), logs to stderr and returns
    without raising.
    """
    if not config.enabled or not config.api_key:
        return
    url = f"{_normalize_base_url(config.base_url)}/api/v1/sdk/events"
    body = json.dumps(event).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=config.timeout_seconds) as resp:
            _ = resp.read()
    except urllib.error.HTTPError as e:
        print(
            f"[agent-eval-sdk] HTTP {e.code} sending event: {e.reason}",
            file=sys.stderr,
        )
    except urllib.error.URLError as e:
        print(f"[agent-eval-sdk] URL error: {e.reason}", file=sys.stderr)
    except TimeoutError:
        print("[agent-eval-sdk] request timed out", file=sys.stderr)
    except OSError as e:
        print(f"[agent-eval-sdk] I/O error: {e}", file=sys.stderr)
    except Exception as e:
        print(f"[agent-eval-sdk] unexpected error: {e}", file=sys.stderr)
