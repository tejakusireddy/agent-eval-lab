"""Adapters for different AI agent providers."""

from agent_eval_lab.adapters.base import AgentAdapter
from agent_eval_lab.adapters.openai_adapter import OpenAIAdapter

__all__ = ["AgentAdapter", "OpenAIAdapter"]

