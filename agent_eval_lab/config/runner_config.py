"""Runner configuration from config.yaml."""

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

from agent_eval_lab.errors import ConfigError


class HttpAgentConfig(BaseModel):
    """Configuration for HTTP agent adapter."""

    base_url: str = Field(default="http://localhost:8000")


class RunnerConfig(BaseModel):
    """Configuration for the evaluation runner."""

    provider: str = Field(
        default="openai", description="Provider: 'openai' or 'http_agent'"
    )
    model: str = Field(default="gpt-4o-mini", description="Model name")
    temperature: float = Field(default=0.0, ge=0.0, le=2.0)
    max_tokens: int = Field(default=512, ge=1, le=4096)
    max_concurrency: int = Field(default=3, ge=1, le=10)
    timeout_seconds: float = Field(default=30.0, ge=1.0)
    max_retries: int = Field(default=3, ge=1, le=10)
    base_url: str | None = Field(default=None)
    http_agent: HttpAgentConfig | None = Field(default=None)

    @classmethod
    def from_file(cls, path: Path) -> "RunnerConfig":
        """
        Load configuration from YAML file.

        Args:
            path: Path to config.yaml

        Returns:
            RunnerConfig instance

        Raises:
            ConfigError: If file cannot be loaded or validated
        """
        if not path.exists():
            # Return defaults if file doesn't exist
            return cls()

        try:
            with open(path) as f:
                data = yaml.safe_load(f)

            if not isinstance(data, dict):
                raise ConfigError(
                    f"Configuration file must contain a YAML object: {path}"
                )

            # Handle nested http_agent config
            if "http_agent" in data and isinstance(data["http_agent"], dict):
                data["http_agent"] = HttpAgentConfig(**data["http_agent"])

            return cls(**data)

        except yaml.YAMLError as e:
            raise ConfigError(f"Invalid YAML in {path}: {e}") from e
        except Exception as e:
            raise ConfigError(f"Error loading configuration: {e}") from e

    def to_openai_config(self) -> dict[str, Any]:
        """Convert to OpenAI adapter configuration."""
        return {
            "model": self.model,
            "base_url": self.base_url,
            "timeout_seconds": self.timeout_seconds,
            "max_concurrent_requests": self.max_concurrency,
        }

