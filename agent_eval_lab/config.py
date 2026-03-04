"""Configuration management using Pydantic."""

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

from agent_eval_lab.errors import ConfigError


class OpenAIConfig(BaseModel):
    """Configuration for OpenAI provider."""

    model: str = Field(default="gpt-4o-mini", description="OpenAI model name")
    base_url: str | None = Field(default=None, description="Custom base URL for API")
    timeout_seconds: float = Field(
        default=30.0, description="Request timeout in seconds"
    )
    max_concurrent_requests: int = Field(
        default=4, description="Maximum concurrent requests"
    )


class EvalConfig(BaseModel):
    """Configuration for evaluation scenarios."""

    scenarios: list[str] = Field(
        default_factory=list, description="List of scenario IDs to run"
    )


class AppConfig(BaseModel):
    """Top-level application configuration."""

    openai: OpenAIConfig | None = Field(
        default=None, description="OpenAI configuration"
    )
    eval: EvalConfig = Field(
        default_factory=EvalConfig, description="Evaluation config"
    )

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AppConfig":
        """
        Create AppConfig from a dictionary.

        Handles the nested structure from YAML files.
        """
        # Transform YAML structure to our model structure
        config_dict: dict[str, Any] = {"eval": EvalConfig()}

        if "agent" in data:
            agent_data = data["agent"]
            if agent_data.get("provider") == "openai":
                config_dict["openai"] = OpenAIConfig(
                    model=agent_data.get("model", "gpt-4o-mini"),
                    base_url=agent_data.get("base_url"),
                    timeout_seconds=agent_data.get("timeout_seconds", 30.0),
                    max_concurrent_requests=agent_data.get(
                        "max_concurrent_requests", 4
                    ),
                )

        if "evaluation" in data:
            eval_data = data["evaluation"]
            config_dict["eval"] = EvalConfig(
                scenarios=eval_data.get("scenarios", [])
            )

        return cls(**config_dict)


def load_app_config(path: Path) -> AppConfig:
    """
    Load and validate application configuration from a YAML file.

    Args:
        path: Path to the YAML configuration file

    Returns:
        Validated AppConfig instance

    Raises:
        ConfigError: If the file cannot be read or validated
    """
    if not path.exists():
        raise ConfigError(f"Configuration file not found: {path}")

    try:
        with open(path) as f:
            data = yaml.safe_load(f)

        if not isinstance(data, dict):
            raise ConfigError(f"Configuration file must contain a YAML object: {path}")

        return AppConfig.from_dict(data)

    except yaml.YAMLError as e:
        raise ConfigError(f"Invalid YAML in configuration file: {e}") from e
    except Exception as e:
        raise ConfigError(f"Error loading configuration: {e}") from e

