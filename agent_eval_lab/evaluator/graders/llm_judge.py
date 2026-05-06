"""LLM-as-judge client for ambiguous trace-level grading (httpx, no OpenAI SDK)."""

from __future__ import annotations

import json
import os
from typing import Any

import httpx
import structlog
from pydantic import BaseModel, Field, field_validator

from agent_eval_lab.trace.models import GraderType

logger = structlog.get_logger(__name__)

_CANONICAL_SCORES: frozenset[float] = frozenset({0.0, 25.0, 50.0, 100.0})


class LLMJudgeConfig(BaseModel):
    """Configuration for the LLM judge."""

    model: str = "gpt-4o-mini"
    temperature: float = 0.0
    max_tokens: int = 512
    timeout_seconds: float = 30.0
    api_key_env_var: str = "OPENAI_API_KEY"
    base_url: str | None = None

    @classmethod
    def from_env(cls) -> LLMJudgeConfig:
        """Load config from environment variables."""
        return cls(
            model=os.environ.get("GRADER_MODEL", "gpt-4o-mini"),
            base_url=os.environ.get("GRADER_BASE_URL"),
        )


class JudgeVerdict(BaseModel):
    """Structured verdict from LLM judge."""

    passed: bool
    score: float
    reasoning: str
    violations: list[str] = Field(default_factory=list)
    confidence: float

    @field_validator("score")
    @classmethod
    def enforce_canonical_scores(cls, value: float) -> float:
        """Restrict scores to the canonical evaluation scale."""
        if value not in _CANONICAL_SCORES:
            raise ValueError(
                f"score must be one of {sorted(_CANONICAL_SCORES)}, got {value!r}"
            )
        return value

    @field_validator("confidence")
    @classmethod
    def enforce_confidence(cls, value: float) -> float:
        """Keep confidence in [0.0, 1.0]."""
        if not 0.0 <= value <= 1.0:
            raise ValueError(f"confidence must be in [0.0, 1.0], got {value!r}")
        return value


class LLMJudge:
    """
    LLM-as-judge for ambiguous grading cases.

    Uses structured JSON prompting. Returns :class:`JudgeVerdict`.
    Never raises from :meth:`judge` — failures yield a low-confidence neutral verdict.
    """

    def __init__(self, config: LLMJudgeConfig | None = None) -> None:
        self.config = config or LLMJudgeConfig.from_env()

    def judge(
        self,
        system_prompt: str,
        user_prompt: str,
        grader_type: GraderType,
    ) -> JudgeVerdict:
        """
        Call LLM and parse structured verdict.

        Args:
            system_prompt: Role + task description for the judge.
            user_prompt: The span content to evaluate.
            grader_type: Which grader is calling (for logging).

        Returns:
            Parsed verdict, or a neutral fallback on any failure.
        """
        api_key = os.environ.get(self.config.api_key_env_var)
        if not api_key:
            logger.warning(
                "llm_judge_no_api_key",
                grader_type=grader_type.value,
                env_var=self.config.api_key_env_var,
            )
            return self._fallback_verdict()

        base = (self.config.base_url or "https://api.openai.com/v1").rstrip("/")
        url = f"{base}/chat/completions"
        payload: dict[str, Any] = {
            "model": self.config.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": self.config.temperature,
            "max_tokens": self.config.max_tokens,
            "response_format": {"type": "json_object"},
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        timeout = httpx.Timeout(self.config.timeout_seconds)

        try:
            with httpx.Client(timeout=timeout) as client:
                response = client.post(url, headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()
        except Exception as exc:
            logger.error(
                "llm_judge_request_failed",
                grader_type=grader_type.value,
                error=str(exc),
                exc_info=True,
            )
            return self._fallback_verdict()

        try:
            content = data["choices"][0]["message"]["content"]
            if not isinstance(content, str):
                raise TypeError("message content is not a string")
            parsed = self._parse_json_content(content)
            verdict = JudgeVerdict.model_validate(parsed)
            logger.info(
                "llm_judge_verdict",
                grader_type=grader_type.value,
                passed=verdict.passed,
                score=verdict.score,
                confidence=verdict.confidence,
            )
            return verdict
        except Exception as exc:
            logger.error(
                "llm_judge_parse_failed",
                grader_type=grader_type.value,
                error=str(exc),
                exc_info=True,
            )
            return self._fallback_verdict()

    def is_available(self) -> bool:
        """Return True if API key is configured."""
        return bool(os.environ.get(self.config.api_key_env_var))

    def _fallback_verdict(self) -> JudgeVerdict:
        return JudgeVerdict(
            passed=False,
            score=0.0,
            reasoning="LLM judge unavailable",
            violations=[],
            confidence=0.0,
        )

    def _parse_json_content(self, content: str) -> dict[str, Any]:
        text = content.strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            start = text.find("{")
            end = text.rfind("}")
            if start >= 0 and end > start:
                return json.loads(text[start : end + 1])
            raise
