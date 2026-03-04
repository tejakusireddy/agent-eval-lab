"""CLI commands for agent evaluation."""

import asyncio
import logging
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from agent_eval_lab.config.runner_config import RunnerConfig
from agent_eval_lab.errors import ConfigError, ProviderError
from agent_eval_lab.logging_config import configure_logging
from agent_eval_lab.scenarios.loader import ScenarioLoader


def run_all_scenarios(
    scenarios_dir: str = typer.Option(
        "scenario_definitions", help="Directory containing scenario YAML files"
    ),
    config_file: str = typer.Option(
        "config.yaml", help="Path to config.yaml file"
    ),
    output_dir: str = typer.Option(
        "reports", help="Directory to save reports"
    ),
    model: str | None = typer.Option(None, help="Override model name"),
    temperature: float | None = typer.Option(None, help="Override temperature"),
    max_tokens: int | None = typer.Option(None, help="Override max_tokens"),
    max_concurrency: int | None = typer.Option(
        None, help="Override max_concurrency"
    ),
) -> None:
    """
    Run all scenarios from YAML files and generate reports.

    This command loads all scenarios from the scenarios directory,
    runs them against the configured agent, and generates both
    Markdown and HTML reports.
    """
    configure_logging(logging.INFO)
    logger = logging.getLogger(__name__)
    console = Console()

    # Load runner configuration
    config_path = Path(config_file)
    try:
        runner_config = RunnerConfig.from_file(config_path)
    except ConfigError as e:
        console.print(f"[red]Configuration error: {e}[/red]")
        raise typer.Exit(1) from e

    # Apply CLI overrides
    if model:
        runner_config.model = model
    if temperature is not None:
        runner_config.temperature = temperature
    if max_tokens is not None:
        runner_config.max_tokens = max_tokens
    if max_concurrency is not None:
        runner_config.max_concurrency = max_concurrency

    # Load scenarios
    scenarios_path = Path(scenarios_dir)
    try:
        loader = ScenarioLoader(scenarios_path)
        scenario_defs = loader.load_all()
        console.print(
            f"[green]Loaded {len(scenario_defs)} scenario(s) from "
            f"{scenarios_path}[/green]"
        )
    except ConfigError as e:
        console.print(f"[red]Scenario loading error: {e}[/red]")
        raise typer.Exit(1) from e

    # Run evaluation using shared core
    from agent_eval_lab.runner.core import run_evaluation

    # Get all scenario IDs (run all scenarios)
    scenario_ids = [defn.id for defn in scenario_defs]

    # Run evaluation
    try:
        result = asyncio.run(
            run_evaluation(
                scenario_ids=scenario_ids,
                scenarios_dir=scenarios_path,
                provider=runner_config.provider,
                model=runner_config.model,
                temperature=runner_config.temperature,
                max_tokens=runner_config.max_tokens,
                max_concurrency=runner_config.max_concurrency,
                timeout_seconds=runner_config.timeout_seconds,
                max_retries=runner_config.max_retries,
                base_url=runner_config.base_url,
                http_agent_base_url=runner_config.http_agent.base_url
                if runner_config.http_agent
                else None,
                logger=logger,
            )
        )

        summary = result["summary"]

        # Extract statistics from summary
        total = summary["total"]
        passed = summary["passed"]
        failed_minor = summary["failed_minor"]
        failed_critical = summary["failed_critical"]
        safety_score = summary["safety_score"]

        # Display adapter info
        if runner_config.provider == "http_agent":
            http_base_url = (
                runner_config.http_agent.base_url
                if runner_config.http_agent
                else "N/A"
            )
            console.print(
                f"[green]Using HTTP agent adapter: {http_base_url}[/green]"
            )
        else:
            console.print(
                f"[green]Using OpenAI adapter: {runner_config.model}[/green]"
            )
    except ProviderError as e:
        console.print(f"[red]Provider error: {e}[/red]")
        raise typer.Exit(1) from e

    # Display summary with per-severity breakdown
    console.print("\n[bold]Evaluation Summary[/bold]")
    table = Table(show_header=True, header_style="bold magenta")
    table.add_column("Metric", style="cyan")
    table.add_column("Value", style="green")

    table.add_row("Total Scenarios", str(total))
    table.add_row("PASS", f"[green]{passed}[/green]")
    table.add_row("FAIL_MINOR", f"[yellow]{failed_minor}[/yellow]")
    table.add_row("FAIL_CRITICAL", f"[red]{failed_critical}[/red]")
    table.add_row("Safety Score", f"{safety_score:.1f}%")

    console.print(table)

    # Per-severity summary
    console.print("\n[bold]Per-Severity Summary[/bold]")
    severity_table = Table(show_header=True, header_style="bold magenta")
    severity_table.add_column("Severity", style="cyan")
    severity_table.add_column("Count", style="green")
    severity_table.add_column("Percentage", style="green")

    if total > 0:
        severity_table.add_row(
            "PASS", str(passed), f"{(passed/total)*100:.1f}%"
        )
        severity_table.add_row(
            "FAIL_MINOR",
            str(failed_minor),
            f"{(failed_minor/total)*100:.1f}%",
        )
        severity_table.add_row(
            "FAIL_CRITICAL",
            str(failed_critical),
            f"{(failed_critical/total)*100:.1f}%",
        )
    else:
        severity_table.add_row("PASS", "0", "0.0%")
        severity_table.add_row("FAIL_MINOR", "0", "0.0%")
        severity_table.add_row("FAIL_CRITICAL", "0", "0.0%")

    console.print(severity_table)

    # Reports are generated by core; save them to output_dir.
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # Save reports from core result
    markdown_path = output_path / "evaluation_report.md"
    with open(markdown_path, "w") as f:
        f.write(result["reports"]["md"])
    console.print(f"\n[green]Markdown report saved to: {markdown_path}[/green]")

    html_path = output_path / "evaluation_report.html"
    with open(html_path, "w") as f:
        f.write(result["reports"]["html"])
    console.print(f"[green]HTML report saved to: {html_path}[/green]")

    json_path = output_path / "evaluation_report.json"
    with open(json_path, "w") as f:
        f.write(result["reports"]["json"])
    logger.info(f"JSON report saved to: {json_path}")
    console.print(f"[green]JSON report saved to: {json_path}[/green]")

    # Exit with error code if any critical failures
    if failed_critical > 0:
        console.print(
            f"\n[red]Critical failures detected: {failed_critical}[/red]"
        )
        raise typer.Exit(1)

    if failed_minor > 0:
        console.print(
            f"\n[yellow]Minor failures detected: {failed_minor}[/yellow]"
        )
