"""Programmatic entry point for running evaluations from Next.js API."""

import asyncio
import json
import logging
import sys
from pathlib import Path
from typing import Any

from agent_eval_lab.runner.core import run_evaluation


def main() -> None:
    """
    Main entry point for programmatic evaluation.

    Reads JSON from stdin:
    {
        "scenario_ids": ["safety.jailbreak_basic.v1", ...],
        "scenarios_dir": "/path/to/scenario_definitions",
        "provider": "openai" | "http_agent",
        "model": "gpt-4o-mini",
        "temperature": 0.0,
        "max_tokens": 512,
        "max_concurrency": 3,
        "timeout_seconds": 30.0,
        "max_retries": 3,
        "base_url": null,
        "http_agent_base_url": null
    }

    Writes JSON to stdout:
    {
        "success": true,
        "results": [...],
        "summary": {...},
        "reports": {
            "html": "...",
            "md": "...",
            "json": "..."
        }
    }
    """
    # Configure logging to stderr ONLY to avoid interfering with JSON output
    # All logs must go to stderr, stdout is reserved for JSON only
    logging.basicConfig(
        level=logging.WARNING,
        format="%(levelname)s: %(message)s",
        stream=sys.stderr,
        force=True,  # Override any existing logging config
    )

    try:
        # Read input from stdin
        input_data = json.load(sys.stdin)

        # Extract parameters
        scenario_ids = input_data.get("scenario_ids", [])
        scenarios_dir = Path(input_data.get("scenarios_dir", "scenario_definitions"))
        provider = input_data.get("provider", "openai")
        model = input_data.get("model", "gpt-4o-mini")
        temperature = float(input_data.get("temperature", 0.0))
        max_tokens = int(input_data.get("max_tokens", 512))
        max_concurrency = int(input_data.get("max_concurrency", 3))
        timeout_seconds = float(input_data.get("timeout_seconds", 30.0))
        max_retries = int(input_data.get("max_retries", 3))
        base_url = input_data.get("base_url")
        http_agent_base_url = input_data.get("http_agent_base_url")

        # Validate required fields
        if not scenario_ids:
            raise ValueError("scenario_ids is required")

        if not scenarios_dir.exists():
            raise ValueError(f"scenarios_dir does not exist: {scenarios_dir}")

        # Run evaluation
        result = asyncio.run(
            run_evaluation(
                scenario_ids=scenario_ids,
                scenarios_dir=scenarios_dir,
                provider=provider,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                max_concurrency=max_concurrency,
                timeout_seconds=timeout_seconds,
                max_retries=max_retries,
                base_url=base_url,
                http_agent_base_url=http_agent_base_url,
            )
        )

        # Write result to stdout (JSON only, no indentation for cleaner parsing)
        output = {
            "success": True,
            **result,
        }
        # Write to stdout (file descriptor 1) directly to ensure clean JSON
        json_output = json.dumps(output)
        sys.stdout.write(json_output + "\n")
        sys.stdout.flush()

    except Exception as e:
        # Write error to stdout as JSON (errors also go to stdout for consistency)
        error_output = {
            "success": False,
            "error": str(e),
            "error_type": type(e).__name__,
        }
        json_output = json.dumps(error_output)
        sys.stdout.write(json_output + "\n")
        sys.stdout.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()

