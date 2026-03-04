"""Markdown report generator for evaluation results."""

from agent_eval_lab.scenarios.base import ScenarioResult


def generate_markdown_report(results: list[ScenarioResult]) -> str:
    """
    Generate a human-readable Markdown summary of all scenario results.

    Args:
        results: List of scenario results

    Returns:
        Markdown-formatted report string

    The report includes:
    - Overall counts
    - Safety score (average of scores * 100)
    - Table of scenarios
    - Example failure summaries
    """
    if not results:
        return "# Evaluation Report\n\nNo scenarios were executed.\n"

    total = len(results)
    passed = sum(1 for r in results if r.success)
    failed = total - passed
    avg_score = sum(r.score for r in results) / total if total > 0 else 0.0
    safety_score = avg_score * 100

    lines = [
        "# Agent Evaluation Report",
        "",
        "## Summary",
        "",
        f"- **Total Scenarios**: {total}",
        f"- **Passed**: {passed}",
        f"- **Failed**: {failed}",
        f"- **Safety Score**: {safety_score:.1f}%",
        "",
        "## Scenario Results",
        "",
        "| Scenario ID | Name | Status | Score | Tags |",
        "|--------------|------|--------|-------|------|",
    ]

    # Add scenario rows
    for result in results:
        status = result.status if result.status != "UNKNOWN" else (
            "PASS" if result.success else "FAIL"
        )
        tags_str = ", ".join(result.tags)
        scenario_name = result.scenario_id.split(".")[-1]
        row = (
            f"| `{result.scenario_id}` | {scenario_name} | "
            f"{status} | {result.score:.2f} | {tags_str} |"
        )
        lines.append(row)

    # Add failure details
    failed_results = [r for r in results if not r.success]
    if failed_results:
        lines.extend([
            "",
            "## Failure Details",
            "",
        ])

        for result in failed_results:
            status = result.status if result.status != "UNKNOWN" else "FAIL"
            lines.extend([
                f"### {result.scenario_id}",
                "",
                f"**Status**: {status}",
                "",
            ])

            if result.reasoning:
                lines.extend([
                    f"**Reasoning**: {result.reasoning}",
                    "",
                ])

            if result.fail_reasons:
                lines.append("**Failure Reasons**:")
                for reason in result.fail_reasons:
                    lines.append(f"- {reason}")
                lines.append("")

            # Truncate response for display
            response_preview = result.raw_response[:300]
            if len(result.raw_response) > 300:
                response_preview += "... (truncated)"

            lines.extend([
                "**Response Preview**:",
                "",
                "```",
                response_preview,
                "```",
                "",
            ])

    return "\n".join(lines)

