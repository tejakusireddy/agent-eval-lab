"""CLI entry point for agent-eval-lab."""

import asyncio
import logging
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from agent_eval_lab.adapters.openai_adapter import OpenAIAdapter
from agent_eval_lab.config import load_app_config
from agent_eval_lab.errors import ConfigError, ProviderError
from agent_eval_lab.logging_config import configure_logging
from agent_eval_lab.reporter.markdown_reporter import generate_markdown_report
from agent_eval_lab.runner.runner import ScenarioRunner
from agent_eval_lab.scenarios.base import Scenario, ScenarioResult
from agent_eval_lab.scenarios.safety.system_prompt_leak import SystemPromptLeakScenario
from agent_eval_lab.cli.commands import run_all_scenarios

app = typer.Typer(help="Agent evaluation framework for AI agents")
console = Console()


@app.callback(invoke_without_command=True)
def main(ctx: typer.Context) -> None:
    """Agent evaluation framework for AI agents."""
    if ctx.invoked_subcommand is None:
        msg = (
            "[yellow]No command specified. "
            "Use --help to see available commands.[/yellow]"
        )
        console.print(msg)
        raise typer.Exit(1)


@app.command(name="run-openai-basic")
def run_openai_basic() -> None:
    """
    Run basic OpenAI evaluation with system prompt leak scenario.

    Loads configuration from examples/openai_basic_agent/config.yml
    and generates a report at examples/openai_basic_agent/report.md
    """
    configure_logging(logging.INFO)
    logger = logging.getLogger(__name__)

    # Load configuration
    config_path = Path("examples/openai_basic_agent/config.yml")
    try:
        config = load_app_config(config_path)
    except ConfigError as e:
        console.print(f"[red]Configuration error: {e}[/red]")
        raise typer.Exit(1) from e

    if not config.openai:
        console.print("[red]OpenAI configuration is required for this command[/red]")
        raise typer.Exit(1)

    # Initialize adapter
    try:
        adapter = OpenAIAdapter(config.openai)
    except ProviderError as e:
        console.print(f"[red]Provider error: {e}[/red]")
        raise typer.Exit(1) from e

    # Build scenario list
    scenarios: list[Scenario] = [SystemPromptLeakScenario()]

    # Run evaluation with proper cleanup
    logger.info(f"Running {len(scenarios)} scenario(s)")
    runner = ScenarioRunner(adapter, logger)

    async def run_with_cleanup() -> list[ScenarioResult]:
        """Run scenarios and ensure adapter is closed."""
        try:
            return await runner.run_scenarios(scenarios)
        finally:
            if hasattr(adapter, "close"):
                await adapter.close()

    results = asyncio.run(run_with_cleanup())

    # Display summary
    total = len(results)
    passed = sum(1 for r in results if r.success)
    failed = total - passed
    avg_score = sum(r.score for r in results) / total if total > 0 else 0.0
    safety_score = avg_score * 100

    console.print("\n[bold]Evaluation Summary[/bold]")
    table = Table(show_header=True, header_style="bold magenta")
    table.add_column("Metric", style="cyan")
    table.add_column("Value", style="green")

    table.add_row("Total Scenarios", str(total))
    table.add_row("Passed", str(passed))
    table.add_row("Failed", str(failed))
    table.add_row("Safety Score", f"{safety_score:.1f}%")

    console.print(table)

    # Generate and save report
    report_content = generate_markdown_report(results)
    report_path = Path("examples/openai_basic_agent/report.md")
    report_path.parent.mkdir(parents=True, exist_ok=True)

    with open(report_path, "w") as f:
        f.write(report_content)

    console.print(f"\n[green]Report saved to: {report_path}[/green]")

    # Exit with error code if any failures
    if failed > 0:
        raise typer.Exit(1)


# Register new command
app.command(name="run-all-scenarios")(run_all_scenarios)


if __name__ == "__main__":
    app()

