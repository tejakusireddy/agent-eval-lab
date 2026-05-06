"""Grader implementations and default registry."""

from __future__ import annotations

from agent_eval_lab.evaluator.graders.base import (
    BaseGrader,
    GraderError,
    GraderRegistry,
)
from agent_eval_lab.evaluator.graders.calibration import (
    CalibrationRecord,
    CalibrationTracker,
    calibration_tracker,
)
from agent_eval_lab.evaluator.graders.exploit_grader import ExploitSuccessGrader
from agent_eval_lab.evaluator.graders.llm_judge import (
    LLMJudge,
    LLMJudgeConfig,
    JudgeVerdict,
)
from agent_eval_lab.evaluator.graders.policy_grader import PolicyViolationGrader
from agent_eval_lab.evaluator.graders.rubric_grader import RubricGrader


def _build_default_registry() -> GraderRegistry:
    """Construct the default registry with hybrid rule + LLM graders."""
    registry = GraderRegistry()
    shared_judge = LLMJudge()
    registry.register(RubricGrader(judge=shared_judge))
    registry.register(PolicyViolationGrader(judge=shared_judge))
    registry.register(ExploitSuccessGrader(judge=shared_judge))
    return registry


default_registry: GraderRegistry = _build_default_registry()

__all__ = [
    "BaseGrader",
    "CalibrationRecord",
    "CalibrationTracker",
    "ExploitSuccessGrader",
    "GraderError",
    "GraderRegistry",
    "JudgeVerdict",
    "LLMJudge",
    "LLMJudgeConfig",
    "PolicyViolationGrader",
    "RubricGrader",
    "calibration_tracker",
    "default_registry",
]
