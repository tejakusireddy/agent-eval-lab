"""Logging configuration with safety defaults."""

import logging
import re


def redact_sensitive(text: str) -> str:
    """
    Redact potentially sensitive information from text.

    TODO: Implement more sophisticated patterns:
    - API key patterns (sk-..., etc.)
    - Email addresses
    - Credit card numbers
    - PII patterns
    """
    # Basic redaction: remove common API key patterns
    patterns = [
        (r"sk-[a-zA-Z0-9]{20,}", "sk-***REDACTED***"),
        (
            r"api[_-]?key['\"]?\s*[:=]\s*['\"]?[a-zA-Z0-9]{20,}",
            "api_key=***REDACTED***",
        ),
    ]

    result = text
    for pattern, replacement in patterns:
        result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)

    return result


def configure_logging(level: int = logging.INFO) -> None:
    """
    Configure application-wide logging.

    Args:
        level: Logging level (default: INFO)
    """
    logging.basicConfig(
        level=level,
        format="%(asctime)s - %(levelname)s - %(name)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Suppress noisy third-party loggers
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

