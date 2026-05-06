"""Load fixture YAML into a dict for :class:`~agent_eval_lab.tool_env.session.Session`."""

from __future__ import annotations

from importlib import resources
from pathlib import Path
from typing import Any, cast

import yaml

_FIXTURES_DIR = Path(__file__).resolve().parent


def load_fixture(name: str) -> dict[str, Any]:
    """
    Load a fixture by name (``default`` → ``default.yaml``).

    Resolution order: package resources, sibling ``fixtures/`` directory on disk,
    then ``name`` as an absolute or relative filesystem path.
    """
    if not name.endswith(".yaml") and not name.endswith(".yml"):
        filename = f"{name}.yaml"
    else:
        filename = name

    try:
        pkg = resources.files("agent_eval_lab.tool_env.fixtures")
        candidate = pkg / filename
        if candidate.is_file():
            raw = candidate.read_bytes()
            loaded = yaml.safe_load(raw.decode("utf-8"))
            if not isinstance(loaded, dict):
                raise ValueError("fixture root must be a mapping")
            return cast(dict[str, Any], loaded)
    except (TypeError, FileNotFoundError, OSError, ValueError):
        pass

    sibling = _FIXTURES_DIR / filename
    if sibling.is_file():
        with sibling.open("r", encoding="utf-8") as f:
            loaded = yaml.safe_load(f)
        if not isinstance(loaded, dict):
            raise ValueError("fixture root must be a mapping")
        return cast(dict[str, Any], loaded)

    path = Path(filename)
    if path.is_file():
        with path.open("r", encoding="utf-8") as f:
            loaded = yaml.safe_load(f)
        if not isinstance(loaded, dict):
            raise ValueError("fixture root must be a mapping")
        return cast(dict[str, Any], loaded)
    raise FileNotFoundError(f"Fixture not found: {name!r}")
