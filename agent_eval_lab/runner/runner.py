"""Scenario runner implementation."""

import asyncio
import logging

from agent_eval_lab.adapters.base import AgentAdapter
from agent_eval_lab.errors import ProviderError
from agent_eval_lab.evaluator.scoring import ScenarioEvaluator, ScenarioStatus
from agent_eval_lab.scenarios.base import Scenario, ScenarioResult


class ScenarioRunner:
    """
    Executes scenarios against an agent adapter.

    Handles concurrency, error handling, and result collection.
    """

    def __init__(
        self, agent: AgentAdapter, logger: logging.Logger | None = None
    ) -> None:
        """
        Initialize the scenario runner.

        Args:
            agent: The agent adapter to test
            logger: Optional logger instance
        """
        self.agent = agent
        self._logger = logger or logging.getLogger(__name__)
        self._concurrency_limit = 4  # TODO: Extract from config

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
        semaphore = asyncio.Semaphore(self._concurrency_limit)

        async def run_with_limit(scenario: Scenario) -> ScenarioResult:
            async with semaphore:
                return await self._run_single_scenario(scenario)

        tasks = [run_with_limit(scenario) for scenario in scenarios]
        results = await asyncio.gather(*tasks)

        return list(results)

    async def _run_single_scenario(self, scenario: Scenario) -> ScenarioResult:
        """
        Run a single scenario.

        Args:
            scenario: The scenario to execute

        Returns:
            ScenarioResult with the outcome
        """
        self._logger.info(
            f"Running scenario: {scenario.id} - {scenario.name}"
        )

        try:
            prompt = scenario.build_prompt()
            response = await self.agent.generate(prompt)

            evaluator = ScenarioEvaluator(scenario.get_definition())
            result = evaluator.evaluate(response)

            return ScenarioResult(
                scenario_id=scenario.id,
                status=result["status"],
                score=result["score"],
                reasoning=result["reasoning"],
                tags=scenario.tags,
                raw_prompt=prompt,
                raw_response=response,
                metadata=result["metadata"],
                fail_reasons=result["metadata"].get("violations", []),
            )

        except ProviderError as e:
            self._logger.error(f"Provider error in scenario {scenario.id}: {e}")
            return ScenarioResult(
                scenario_id=scenario.id,
                status=ScenarioStatus.FAIL_CRITICAL,
                score=0.0,
                tags=scenario.tags,
                raw_prompt=scenario.build_prompt(),
                raw_response="",
                reasoning=f"Provider error: {str(e)}",
                metadata={"error_type": "ProviderError"},
                fail_reasons=[str(e)],
            )

        except Exception as e:
            self._logger.error(
                f"Unexpected error in scenario {scenario.id}: {e}", exc_info=True
            )
            return ScenarioResult(
                scenario_id=scenario.id,
                status=ScenarioStatus.FAIL_CRITICAL,
                score=0.0,
                tags=scenario.tags,
                raw_prompt=scenario.build_prompt(),
                raw_response="",
                reasoning=f"Unexpected error: {str(e)}",
                metadata={"error_type": type(e).__name__},
                fail_reasons=[f"Unexpected error: {str(e)}"],
            )
