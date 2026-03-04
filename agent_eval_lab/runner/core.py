"""Shared core evaluation runner for both CLI and web API."""

import asyncio
import logging
from pathlib import Path
from typing import Any

from agent_eval_lab.adapters.base import AgentAdapter
from agent_eval_lab.adapters.http_agent_adapter import (
    HttpAgentAdapter,
    HttpAgentAdapterConfig,
)
from agent_eval_lab.adapters.openai_adapter import OpenAIAdapter, OpenAIAdapterConfig
from agent_eval_lab.errors import ConfigError, ProviderError
from agent_eval_lab.reporter.html_reporter import generate_html_report
from agent_eval_lab.reporter.json_reporter import generate_json_report
from agent_eval_lab.reporter.markdown_reporter import generate_markdown_report
from agent_eval_lab.runner.enhanced_runner import EnhancedScenarioRunner
from agent_eval_lab.scenarios.base import ScenarioResult
from agent_eval_lab.scenarios.loader import ScenarioLoader
from agent_eval_lab.scenarios.yaml_scenario import YAMLScenario


def create_adapter(
    provider: str,
    model: str = "gpt-4o-mini",
    temperature: float = 0.0,
    max_tokens: int = 512,
    max_concurrency: int = 3,
    timeout_seconds: float = 30.0,
    max_retries: int = 3,
    base_url: str | None = None,
    http_agent_base_url: str | None = None,
) -> AgentAdapter:
    """
    Create an agent adapter based on provider configuration.

    Args:
        provider: Provider type ("openai" or "http_agent")
        model: Model name (for OpenAI)
        temperature: Temperature setting
        max_tokens: Maximum tokens
        max_concurrency: Maximum concurrent requests
        timeout_seconds: Request timeout
        max_retries: Maximum retry attempts
        base_url: Base URL for OpenAI (optional)
        http_agent_base_url: Base URL for HTTP agent (required for http_agent)

    Returns:
        AgentAdapter instance

    Raises:
        ConfigError: If configuration is invalid
        ProviderError: If adapter creation fails
    """
    if provider == "http_agent":
        if not http_agent_base_url:
            raise ConfigError("http_agent_base_url is required for http_agent provider")
        adapter_config = HttpAgentAdapterConfig(
            base_url=http_agent_base_url,
            timeout_seconds=timeout_seconds,
            max_retries=max_retries,
        )
        return HttpAgentAdapter(adapter_config)
    else:
        adapter_config = OpenAIAdapterConfig(
            model=model,
            base_url=base_url,
            timeout_seconds=timeout_seconds,
            max_concurrent_requests=max_concurrency,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return OpenAIAdapter(adapter_config)


async def run_evaluation(
    scenario_ids: list[str],
    scenarios_dir: Path,
    provider: str = "openai",
    model: str = "gpt-4o-mini",
    temperature: float = 0.0,
    max_tokens: int = 512,
    max_concurrency: int = 3,
    timeout_seconds: float = 30.0,
    max_retries: int = 3,
    base_url: str | None = None,
    http_agent_base_url: str | None = None,
    logger: logging.Logger | None = None,
) -> dict[str, Any]:
    """
    Run evaluation for selected scenarios.

    This is the shared core function used by both CLI and web API.

    Args:
        scenario_ids: List of scenario IDs to run
        scenarios_dir: Directory containing scenario YAML files
        provider: Provider type ("openai" or "http_agent")
        model: Model name (for OpenAI)
        temperature: Temperature setting
        max_tokens: Maximum tokens
        max_concurrency: Maximum concurrent scenario executions
        timeout_seconds: Request timeout
        max_retries: Maximum retry attempts
        base_url: Base URL for OpenAI (optional)
        http_agent_base_url: Base URL for HTTP agent
        logger: Optional logger instance

    Returns:
        Dictionary with results, summary, and report paths:
        {
            "results": [...],
            "summary": {...},
            "report_paths": {
                "html": "...",
                "md": "...",
                "json": "..."
            }
        }

    Raises:
        ConfigError: If configuration is invalid
        ProviderError: If provider errors occur
    """
    if logger is None:
        logger = logging.getLogger(__name__)

    # Load scenarios
    loader = ScenarioLoader(scenarios_dir)
    all_scenario_defs = loader.load_all()

    # Filter to selected scenarios
    scenario_defs = [
        defn for defn in all_scenario_defs if defn.id in scenario_ids
    ]

    if not scenario_defs:
        raise ConfigError(
            f"No scenarios found for IDs: {scenario_ids}. "
            f"Available scenarios: {[d.id for d in all_scenario_defs]}"
        )

    # Convert to YAML scenarios
    scenarios = [YAMLScenario(defn) for defn in scenario_defs]

    # Create adapter
    adapter = create_adapter(
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

    # Run evaluation
    logger.info(f"Running {len(scenarios)} scenario(s)")
    runner = EnhancedScenarioRunner(
        adapter, max_concurrency=max_concurrency, logger=logger
    )

    try:
        results = await runner.run_scenarios(scenarios)
    finally:
        if hasattr(adapter, "close"):
            await adapter.close()

    # Calculate statistics
    total = len(results)
    passed = sum(1 for r in results if r.status == "PASS" or r.score == 100.0)
    failed_minor = sum(1 for r in results if r.status == "FAIL_MINOR")
    failed_critical = sum(1 for r in results if r.status == "FAIL_CRITICAL")

    # Safety Score: sum of scores / number of scenarios, capped at 100.0
    total_score = sum(r.score for r in results)
    safety_score = min(100.0, max(0.0, total_score / total if total > 0 else 0.0))

    summary = {
        "total": total,
        "passed": passed,
        "failed_minor": failed_minor,
        "failed_critical": failed_critical,
        "safety_score": round(safety_score, 2),
    }

    # Generate reports
    markdown_content = generate_markdown_report(results)
    html_content = generate_html_report(results)
    json_content = generate_json_report(
        results,
        model=model,
        model_temperature=temperature,
        max_tokens=max_tokens,
    )

    return {
        "results": [result.model_dump() for result in results],
        "summary": summary,
        "reports": {
            "html": html_content,
            "md": markdown_content,
            "json": json_content,
        },
    }

