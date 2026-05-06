"""Remote evaluator HTTP service for production platform deployments."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from agent_eval_lab.runner.core import run_evaluation


class EvaluationRequest(BaseModel):
    scenario_ids: list[str] = Field(default_factory=list)
    scenarios_dir: str | None = None
    provider: str = "openai"
    model: str = "gpt-4o-mini"
    temperature: float = 0.0
    max_tokens: int = 512
    max_concurrency: int = 3
    timeout_seconds: float = 30.0
    max_retries: int = 3
    base_url: str | None = None
    http_agent_base_url: str | None = None
    http_agent_config: dict[str, Any] | None = None
    defense_config: dict[str, Any] | None = None


app = FastAPI(title="Agent Eval Lab Runner Service", version="1.0.0")


def _resolve_scenarios_dir(request_dir: str | None) -> Path:
    configured = (
        os.getenv("SCENARIO_DEFINITIONS_DIR")
        or os.getenv("EVAL_RUNNER_SCENARIOS_DIR")
        or request_dir
        or "scenario_definitions"
    )
    resolved = Path(configured).resolve()
    if not resolved.exists():
        raise HTTPException(
            status_code=400,
            detail=f"Scenario directory does not exist: {resolved}",
        )
    return resolved


def _authorize(authorization: str | None) -> None:
    expected_token = os.getenv("EVAL_RUNNER_TOKEN", "").strip()
    if not expected_token:
        return

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = authorization[7:].strip()
    if token != expected_token:
        raise HTTPException(status_code=401, detail="Invalid bearer token")


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "service": "agent-eval-runner"}


@app.post("/v1/evaluate")
async def evaluate(
    payload: EvaluationRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    _authorize(authorization)

    if not payload.scenario_ids:
        raise HTTPException(status_code=400, detail="scenario_ids is required")

    scenarios_dir = _resolve_scenarios_dir(payload.scenarios_dir)
    result = await run_evaluation(
        scenario_ids=payload.scenario_ids,
        scenarios_dir=scenarios_dir,
        provider=payload.provider,
        model=payload.model,
        temperature=payload.temperature,
        max_tokens=payload.max_tokens,
        max_concurrency=payload.max_concurrency,
        timeout_seconds=payload.timeout_seconds,
        max_retries=payload.max_retries,
        base_url=payload.base_url,
        http_agent_base_url=payload.http_agent_base_url,
        http_agent_config=payload.http_agent_config,
        defense_config=payload.defense_config,
    )
    return {
        "success": True,
        **result,
    }
