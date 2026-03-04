"""Scenario loader for YAML-based scenario definitions."""

import logging
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field, field_validator

from agent_eval_lab.errors import ConfigError


class ScenarioDefinition(BaseModel):
    """Schema for scenario YAML files."""

    id: str
    name: str
    description: str
    attack_type: str
    max_attempts: int = Field(default=1, ge=1, le=10)
    prompt_template: str
    pass_criteria: list[str] = Field(default_factory=list)
    fail_criteria: dict[str, list[str]] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)

    @field_validator("fail_criteria")
    @classmethod
    def validate_fail_criteria(cls, v: dict[str, Any]) -> dict[str, Any]:
        """Ensure fail_criteria has minor and critical keys."""
        if not isinstance(v, dict):
            raise ValueError("fail_criteria must be a dictionary")

        if "minor" not in v:
            v["minor"] = []
        if "critical" not in v:
            v["critical"] = []

        minor = v.get("minor", [])
        critical = v.get("critical", [])
        if not isinstance(minor, list) or not isinstance(critical, list):
            raise ValueError(
                "fail_criteria.minor and fail_criteria.critical must be lists"
            )

        return v


class ScenarioLoader:
    """Loads and validates scenarios from YAML files."""

    def __init__(self, scenarios_dir: Path) -> None:
        """
        Initialize the scenario loader.

        Args:
            scenarios_dir: Directory containing scenario YAML files
        """
        self.scenarios_dir = Path(scenarios_dir)
        self._logger = logging.getLogger(__name__)
        if not self.scenarios_dir.exists():
            raise ConfigError(f"Scenarios directory not found: {scenarios_dir}")

    def load_all(self) -> list[ScenarioDefinition]:
        """
        Load all scenario YAML files from the scenarios directory (recursively).

        Returns:
            List of validated scenario definitions

        Raises:
            ConfigError: If any scenario file is invalid
        """
        scenarios: list[ScenarioDefinition] = []
        seen_ids: dict[str, tuple[int, Path]] = {}

        # Recursively find all YAML files in subdirectories
        yaml_files = list(self.scenarios_dir.rglob("*.yaml")) + list(
            self.scenarios_dir.rglob("*.yml")
        )

        if not yaml_files:
            raise ConfigError(
                f"No scenario YAML files found in {self.scenarios_dir}"
            )

        for yaml_file in sorted(yaml_files):
            try:
                scenario = self.load_scenario(yaml_file)
                if scenario.id in seen_ids:
                    index, previous_file = seen_ids[scenario.id]
                    self._logger.warning(
                        "Duplicate scenario id '%s': replacing %s with %s",
                        scenario.id,
                        previous_file,
                        yaml_file,
                    )
                    scenarios[index] = scenario
                    seen_ids[scenario.id] = (index, yaml_file)
                else:
                    scenarios.append(scenario)
                    seen_ids[scenario.id] = (len(scenarios) - 1, yaml_file)
            except Exception as e:
                raise ConfigError(
                    f"Error loading scenario from {yaml_file}: {e}"
                ) from e

        return scenarios

    def load_scenario(self, yaml_path: Path) -> ScenarioDefinition:
        """
        Load and validate a single scenario from a YAML file.

        Args:
            yaml_path: Path to the scenario YAML file

        Returns:
            Validated scenario definition

        Raises:
            ConfigError: If the file is invalid or cannot be parsed
        """
        if not yaml_path.exists():
            raise ConfigError(f"Scenario file not found: {yaml_path}")

        try:
            with open(yaml_path) as f:
                data = yaml.safe_load(f)

            if not isinstance(data, dict):
                raise ConfigError(
                    f"Scenario file must contain a YAML object: {yaml_path}"
                )

            # Validate required fields
            required_fields = ["id", "name", "description", "prompt_template"]
            for field in required_fields:
                if field not in data:
                    raise ConfigError(
                        f"Missing required field '{field}' in {yaml_path}"
                    )

            return ScenarioDefinition(**data)

        except yaml.YAMLError as e:
            raise ConfigError(f"Invalid YAML in {yaml_path}: {e}") from e
        except Exception as e:
            raise ConfigError(
                f"Error parsing scenario from {yaml_path}: {e}"
            ) from e
