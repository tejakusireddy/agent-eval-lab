"""Custom exception types for agent-eval-lab."""


class AgentEvalError(Exception):
    """Base exception for all agent evaluation errors."""

    pass


class ProviderError(AgentEvalError):
    """Raised when there's an error communicating with an AI provider."""

    pass


class ScenarioExecutionError(AgentEvalError):
    """Raised when a scenario execution fails."""

    pass


class ConfigError(AgentEvalError):
    """Raised when there's a configuration error."""

    pass

