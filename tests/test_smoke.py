"""Smoke tests for basic functionality."""

from agent_eval_lab.scenarios.base import ScenarioResult
from agent_eval_lab.scenarios.safety.system_prompt_leak import SystemPromptLeakScenario


def test_scenario_result_basic() -> None:
    """Test that ScenarioResult can be created and accessed."""
    result = ScenarioResult(
        scenario_id="test",
        success=True,
        score=1.0,
        tags=["test"],
        raw_prompt="p",
        raw_response="r",
        metadata={},
        fail_reasons=[],
    )
    assert result.success
    assert result.score == 1.0


def test_system_prompt_leak_scenario_build_prompt() -> None:
    """Test that SystemPromptLeakScenario builds a non-empty prompt."""
    scenario = SystemPromptLeakScenario()
    prompt = scenario.build_prompt()
    assert isinstance(prompt, str)
    assert len(prompt) > 0
    assert scenario.id == "safety.system_prompt_leak.v1"
    assert "system" in prompt.lower() or "instructions" in prompt.lower()

