"""Enhanced scenario runner with retries and YAML scenario support."""

import asyncio
import logging
import time

from agent_eval_lab.adapters.base import AgentAdapter
from agent_eval_lab.errors import ProviderError
from agent_eval_lab.evaluator.scoring import (
    ScenarioEvaluator,
    ScenarioStatus,
)
from agent_eval_lab.scenarios.base import Scenario, ScenarioResult
from agent_eval_lab.scenarios.loader import ScenarioDefinition
from agent_eval_lab.scenarios.yaml_scenario import YAMLScenario


class EnhancedScenarioRunner:
    """
    Enhanced scenario runner with retry logic and YAML scenario support.

    Supports multiple attempts per scenario and comprehensive evaluation.
    """

    def __init__(
        self,
        agent: AgentAdapter,
        max_concurrency: int = 3,
        logger: logging.Logger | None = None,
    ) -> None:
        """
        Initialize the enhanced scenario runner.

        Args:
            agent: The agent adapter to test
            max_concurrency: Maximum concurrent scenario executions
            logger: Optional logger instance
        """
        self.agent = agent
        self.max_concurrency = max_concurrency
        self._logger = logger or logging.getLogger(__name__)

    async def run_scenarios(
        self,
        scenarios: list[Scenario],
    ) -> list[ScenarioResult]:
        """
        Run a list of scenarios against the agent.

        Args:
            scenarios: List of scenarios to execute

        Returns:
            List of scenario results
        """
        semaphore = asyncio.Semaphore(self.max_concurrency)

        async def run_with_limit(scenario: Scenario) -> ScenarioResult:
            async with semaphore:
                return await self._run_single_scenario(scenario)

        tasks = [run_with_limit(scenario) for scenario in scenarios]
        results = await asyncio.gather(*tasks)

        return list(results)

    async def _run_single_scenario(self, scenario: Scenario) -> ScenarioResult:
        """
        Run a single scenario with retry logic.

        Args:
            scenario: The scenario to execute

        Returns:
            ScenarioResult with the outcome
        """
        self._logger.info(
            f"Running scenario: {scenario.id} - {scenario.name}"
        )

        # Get scenario definition if it's a YAML scenario
        scenario_def: ScenarioDefinition | None = None
        if isinstance(scenario, YAMLScenario):
            scenario_def = scenario.definition
            max_attempts = scenario_def.max_attempts
        else:
            max_attempts = 1

        best_result: ScenarioResult | None = None
        best_score = -1.0
        scenario_start_time = time.time()

        for attempt in range(1, max_attempts + 1):
            attempt_start_time = time.time()
            try:
                prompt = scenario.build_prompt()
                response = await self.agent.generate(prompt)
                attempt_duration_ms = int((time.time() - attempt_start_time) * 1000)

                # Evaluate response
                if scenario_def:
                    evaluator = ScenarioEvaluator(scenario_def)
                    evaluation = evaluator.evaluate(response, attempt)

                    status = evaluation["status"]
                    score = evaluation["score"]
                    reasoning = evaluation["reasoning"]
                    metadata = evaluation["metadata"]

                    # PASS detection: score == 100.0 → status = PASS
                    # Ensure status is PASS if score is 100.0
                    final_status = status
                    if score == 100.0:
                        final_status = ScenarioStatus.PASS

                    # Determine success based on final status
                    success = final_status == ScenarioStatus.PASS

                    # Add execution time to metadata
                    execution_time_ms = int((time.time() - scenario_start_time) * 1000)
                    metadata["execution_time_ms"] = execution_time_ms
                    metadata["attempt_duration_ms"] = attempt_duration_ms

                    result = ScenarioResult(
                        scenario_id=scenario.id,
                        success=success,
                        score=min(100.0, max(0.0, score)),  # Ensure score is 0-100
                        status=final_status.value,
                        tags=scenario.tags,
                        raw_prompt=prompt,
                        raw_response=response,
                        reasoning=reasoning,
                        metadata=metadata,
                        fail_reasons=metadata.get("violations", []),
                    )

                    # Track best result
                    if score > best_score:
                        best_score = score
                        best_result = result

                    # If we got a PASS, we can stop early
                    if status == ScenarioStatus.PASS:
                        self._logger.info(
                            f"Scenario {scenario.id} passed on attempt {attempt}"
                        )
                        return result

                    self._logger.debug(
                        f"Scenario {scenario.id} attempt {attempt}: "
                        f"{status.value} (score: {score})"
                    )

                else:
                    # Fallback to legacy evaluation for non-YAML scenarios
                    success = True
                    score = 100.0
                    status = ScenarioStatus.PASS.value

                    result = ScenarioResult(
                        scenario_id=scenario.id,
                        success=success,
                        score=score,
                        status=status,
                        tags=scenario.tags,
                        raw_prompt=prompt,
                        raw_response=response,
                        reasoning="Legacy evaluation",
                        metadata={"attempt": attempt},
                        fail_reasons=[],
                    )

                    if score > best_score:
                        best_score = score
                        best_result = result

            except ProviderError as e:
                self._logger.warning(
                    f"Provider error in scenario {scenario.id} "
                    f"attempt {attempt}: {e}"
                )

                # If this is the last attempt, return error result
                if attempt == max_attempts:
                    return ScenarioResult(
                        scenario_id=scenario.id,
                        success=False,
                        score=0.0,
                        status=ScenarioStatus.FAIL_CRITICAL.value,
                        tags=scenario.tags,
                        raw_prompt=scenario.build_prompt(),
                        raw_response="",
                        reasoning=f"Provider error: {str(e)}",
                        metadata={"error_type": "ProviderError", "attempt": attempt},
                        fail_reasons=[str(e)],
                    )

                # Wait before retry with exponential backoff
                await asyncio.sleep(2**attempt)

            except Exception as e:
                self._logger.error(
                    f"Unexpected error in scenario {scenario.id} "
                    f"attempt {attempt}: {e}",
                    exc_info=True,
                )

                if attempt == max_attempts:
                    return ScenarioResult(
                        scenario_id=scenario.id,
                        success=False,
                        score=0.0,
                        status=ScenarioStatus.FAIL_CRITICAL.value,
                        tags=scenario.tags,
                        raw_prompt=scenario.build_prompt(),
                        raw_response="",
                        reasoning=f"Unexpected error: {str(e)}",
                        metadata={
                            "error_type": type(e).__name__,
                            "attempt": attempt,
                        },
                        fail_reasons=[f"Unexpected error: {str(e)}"],
                    )

                await asyncio.sleep(2**attempt)

        # Return best result if we have one, otherwise return failure
        if best_result:
            self._logger.info(
                f"Scenario {scenario.id} completed: "
                f"{best_result.status} (score: {best_result.score})"
            )
            return best_result

        # Fallback: return a failure result
        return ScenarioResult(
            scenario_id=scenario.id,
            success=False,
            score=0.0,
            status=ScenarioStatus.FAIL_CRITICAL.value,
            tags=scenario.tags,
            raw_prompt=scenario.build_prompt(),
            raw_response="",
            reasoning="All attempts failed",
            metadata={"attempts": max_attempts},
            fail_reasons=["All attempts failed"],
        )

