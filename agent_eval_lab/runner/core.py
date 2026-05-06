"""Shared core evaluation runner for both CLI and web API."""

import asyncio
import logging
import secrets
from pathlib import Path
from typing import Any

import structlog

from agent_eval_lab.adapters.base import AgentAdapter
from agent_eval_lab.adapters.http_agent_adapter import (
    HttpAgentAdapter,
    HttpAgentAdapterConfig,
)
from agent_eval_lab.adapters.openai_adapter import OpenAIAdapter, OpenAIAdapterConfig
from agent_eval_lab.errors import ConfigError
from agent_eval_lab.evaluator.scoring import ScenarioStatus
from agent_eval_lab.reporter.html_reporter import generate_html_report
from agent_eval_lab.reporter.json_reporter import generate_json_report
from agent_eval_lab.reporter.markdown_reporter import generate_markdown_report
from agent_eval_lab.runner.defenses import DefenseConfig, DefenseInterceptor
from agent_eval_lab.runner.enhanced_runner import EnhancedScenarioRunner
from agent_eval_lab.runner.multi_step_runner import MultiStepRunner
from agent_eval_lab.scenarios.base import Scenario
from agent_eval_lab.scenarios.loader import ScenarioLoader
from agent_eval_lab.scenarios.yaml_scenario import YAMLScenario
from agent_eval_lab.trace.models import EvalSpanModel

MULTI_STEP_TAGS = frozenset(
    {
        "tool_use",
        "multi_turn",
        "adversarial_tools",
        "indirect_injection",
        "multi_step",
    }
)


def _scenario_needs_multi_step(scenario: Scenario) -> bool:
    """True if scenario tags indicate tool/multi-step execution."""
    return any(t.lower() in MULTI_STEP_TAGS for t in scenario.tags)


def _scenario_opts_out_of_multi_step(scenario: Scenario) -> bool:
    """
    Return True if this scenario explicitly opts out of multi-step execution.

    A scenario opts out if it has the tag ``single_turn_only`` or ``no_tool_env``
    in its tags. This allows scenario authors to force single-turn for scenarios
    that do not use the tool environment (e.g. pure text checks, latency benchmarks).
    """
    opt_out_tags = frozenset({"single_turn_only", "no_tool_env"})
    return any(t.lower() in opt_out_tags for t in scenario.tags)


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
    http_agent_config: dict[str, Any] | None = None,
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
        http_agent_config: Advanced HTTP adapter settings

    Returns:
        AgentAdapter instance

    Raises:
        ConfigError: If configuration is invalid
        ProviderError: If adapter creation fails
    """
    if provider == "http_agent":
        raw_http_config = http_agent_config or {}
        configured_base_url = raw_http_config.get("base_url")
        resolved_base_url = (
            http_agent_base_url
            or (configured_base_url if isinstance(configured_base_url, str) else None)
        )

        if not resolved_base_url:
            raise ConfigError("http_agent_base_url is required for http_agent provider")

        def get_str(name: str, fallback: str | None = None) -> str | None:
            value = raw_http_config.get(name)
            if isinstance(value, str):
                value = value.strip()
                return value or fallback
            return fallback

        adapter_config = HttpAgentAdapterConfig(
            base_url=resolved_base_url,
            timeout_seconds=timeout_seconds,
            max_retries=max_retries,
            endpoint_path=get_str("endpoint_path", "/agent") or "/agent",
            health_path=get_str("health_path", "/health") or "/health",
            method=get_str("method", "POST") or "POST",
            prompt_field=get_str("prompt_field", "query") or "query",
            response_path=get_str("response_path", "answer") or "answer",
            auth_header=get_str("auth_header", "Authorization") or "Authorization",
            auth_token_env_var=get_str("auth_token_env_var"),
            auth_scheme=get_str("auth_scheme", "Bearer") or "Bearer",
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
    http_agent_config: dict[str, Any] | None = None,
    logger: logging.Logger | None = None,
    tool_env_url: str | None = None,
    tool_env_session_token: str | None = None,
    max_steps: int = 10,
    defense_config: dict[str, Any] | None = None,
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
        http_agent_config: Advanced HTTP adapter settings
        logger: Optional logger instance
        tool_env_url: Base URL for the tool sandbox (e.g. http://tool-env:8002)
        tool_env_session_token: Optional ``X-Session-Token`` for tool env
        max_steps: Max tool/agent steps per multi-step scenario
        defense_config: Optional defense pipeline (``enabled``, ``defenses``)

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
    """
    if logger is None:
        logger = logging.getLogger(__name__)

    slog = structlog.get_logger(__name__)

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

    if tool_env_url:
        multi_step_scenarios = [
            s for s in scenarios if not _scenario_opts_out_of_multi_step(s)
        ]
        single_turn_scenarios = [
            s for s in scenarios if _scenario_opts_out_of_multi_step(s)
        ]
        if single_turn_scenarios:
            logger.info(
                f"{len(single_turn_scenarios)} scenario(s) opted out "
                "of multi-step execution (single_turn_only tag)"
            )
    else:
        for sc in scenarios:
            if _scenario_needs_multi_step(sc):
                logger.warning(
                    f"Scenario {sc.id} has tool tags but "
                    "tool_env_url is not set. "
                    "Running single-turn (degraded mode). "
                    "Set TOOL_ENV_URL to enable full evaluation."
                )
        multi_step_scenarios = []
        single_turn_scenarios = list(scenarios)

    logger.info(
        f"Execution routing: {len(multi_step_scenarios)} multi-step, "
        f"{len(single_turn_scenarios)} single-turn "
        f"(tool_env_url={'set' if tool_env_url else 'not set'})"
    )

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
        http_agent_config=http_agent_config,
    )

    defense_interceptor: DefenseInterceptor | None = None
    if defense_config is not None:
        try:
            dc = DefenseConfig.model_validate(defense_config)
            if dc.enabled:
                defense_interceptor = DefenseInterceptor(dc)
                slog.info(
                    "defense_interceptor_active",
                    defenses=list(dc.defenses),
                )
        except Exception as exc:
            slog.warning("defense_config_invalid", error=str(exc))

    # Run evaluation (single-turn + optional multi-step in parallel)
    logger.info(f"Running {len(scenarios)} scenario(s)")
    single_runner = EnhancedScenarioRunner(
        adapter,
        max_concurrency=max_concurrency,
        logger=logger,
        defense_interceptor=defense_interceptor,
    )
    multi_runner = (
        MultiStepRunner(
            adapter,
            tool_env_url=tool_env_url,
            session_token=tool_env_session_token,
            max_steps=max_steps,
            max_concurrency=max_concurrency,
            defense_interceptor=defense_interceptor,
        )
        if tool_env_url and multi_step_scenarios
        else None
    )

    evaluation_trace_id = secrets.token_hex(16)
    all_spans_ordered: list[EvalSpanModel] = []
    all_spans: list[EvalSpanModel] = []

    try:
        if single_turn_scenarios and multi_runner:
            (single_results, single_spans), (multi_results, multi_spans) = (
                await asyncio.gather(
                    single_runner.run_scenarios(
                        single_turn_scenarios,
                        trace_id=evaluation_trace_id,
                    ),
                    multi_runner.run_scenarios(
                        multi_step_scenarios,
                        trace_id=evaluation_trace_id,
                    ),
                )
            )
            combined = list(single_results) + list(multi_results)
            all_spans_ordered = list(single_spans) + list(multi_spans)
        elif single_turn_scenarios:
            combined, all_spans_ordered = await single_runner.run_scenarios(
                single_turn_scenarios,
                trace_id=evaluation_trace_id,
            )
        elif multi_runner:
            combined, all_spans_ordered = await multi_runner.run_scenarios(
                multi_step_scenarios,
                trace_id=evaluation_trace_id,
            )
        else:
            combined = []
            all_spans_ordered = []

        by_id = {r.scenario_id: r for r in combined}
        results = [by_id[sid] for sid in scenario_ids if sid in by_id]

        span_order = {sid: i for i, sid in enumerate(scenario_ids)}
        all_spans = sorted(
            all_spans_ordered,
            key=lambda sp: (
                span_order.get(sp.scenario_id or "", 10_000),
                sp.started_at,
            ),
        )
    finally:
        if hasattr(adapter, "close"):
            await adapter.close()

    # Calculate statistics
    total = len(results)
    passed = sum(
        1 for r in results if r.status == ScenarioStatus.PASS or r.score == 100.0
    )
    failed_minor = sum(1 for r in results if r.status == ScenarioStatus.FAIL_MINOR)
    failed_critical = sum(
        1 for r in results if r.status == ScenarioStatus.FAIL_CRITICAL
    )

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
        "results": [result.model_dump(mode="json") for result in results],
        "summary": summary,
        "spans": [sp.model_dump(mode="json") for sp in all_spans],
        "reports": {
            "html": html_content,
            "md": markdown_content,
            "json": json_content,
        },
    }
