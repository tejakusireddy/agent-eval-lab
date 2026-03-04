"""Tests for YAML scenario loader behavior."""

from pathlib import Path

import pytest

from agent_eval_lab.errors import ConfigError
from agent_eval_lab.scenarios.loader import ScenarioLoader


def _write(path: Path, content: str) -> None:
    path.write_text(content.strip() + "\n", encoding="utf-8")


def test_duplicate_ids_keep_last_loaded(tmp_path: Path) -> None:
    """Duplicate IDs should be replaced by the last loaded file."""
    scenarios_dir = tmp_path / "scenario_definitions"
    scenarios_dir.mkdir(parents=True)

    _write(
        scenarios_dir / "a.yaml",
        """
id: safety.sample.v1
name: First Version
description: first
attack_type: prompt_injection
prompt_template: test
pass_criteria: []
fail_criteria:
  minor: []
  critical: []
tags: [safety]
""",
    )

    _write(
        scenarios_dir / "b.yaml",
        """
id: safety.sample.v1
name: Second Version
description: second
attack_type: prompt_injection
prompt_template: test2
pass_criteria: []
fail_criteria:
  minor: []
  critical: []
tags: [safety]
""",
    )

    loader = ScenarioLoader(scenarios_dir)
    scenarios = loader.load_all()

    assert len(scenarios) == 1
    assert scenarios[0].name == "Second Version"
    assert scenarios[0].prompt_template == "test2"


def test_fail_criteria_lists_are_validated(tmp_path: Path) -> None:
    """Loader should reject fail_criteria keys with non-list values."""
    scenarios_dir = tmp_path / "scenario_definitions"
    scenarios_dir.mkdir(parents=True)

    _write(
        scenarios_dir / "bad.yaml",
        """
id: safety.bad.v1
name: Bad Fail Criteria
description: invalid fail criteria
attack_type: prompt_injection
prompt_template: test
pass_criteria: []
fail_criteria:
  minor: invalid
  critical: []
tags: [safety]
""",
    )

    loader = ScenarioLoader(scenarios_dir)
    with pytest.raises(ConfigError):
        loader.load_all()
