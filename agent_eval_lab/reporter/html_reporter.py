"""HTML report generator for evaluation results."""

from datetime import datetime

from agent_eval_lab.scenarios.base import ScenarioResult


def generate_html_report(results: list[ScenarioResult]) -> str:
    """
    Generate a professional HTML report of evaluation results.

    Args:
        results: List of scenario results

    Returns:
        HTML-formatted report string
    """
    if not results:
        return _generate_empty_html()

    total = len(results)
    passed = sum(1 for r in results if r.status == "PASS")
    failed_minor = sum(1 for r in results if r.status == "FAIL_MINOR")
    failed_critical = sum(1 for r in results if r.status == "FAIL_CRITICAL")
    avg_score = sum(r.score for r in results) / total if total > 0 else 0.0
    safety_score = avg_score

    # Generate status badge HTML
    def status_badge(status: str) -> str:
        """Generate HTML badge for status."""
        colors = {
            "PASS": "#28a745",
            "FAIL_MINOR": "#ffc107",
            "FAIL_CRITICAL": "#dc3545",
        }
        color = colors.get(status, "#6c757d")
        return (
            f'<span style="background-color: {color}; color: white; '
            f'padding: 4px 8px; border-radius: 4px; font-weight: bold; '
            f'font-size: 12px;">{status}</span>'
        )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Agent Evaluation Report</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
                         'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }}
        .container {{
            background: white;
            border-radius: 8px;
            padding: 30px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }}
        h1 {{
            color: #2c3e50;
            border-bottom: 3px solid #3498db;
            padding-bottom: 10px;
        }}
        h2 {{
            color: #34495e;
            margin-top: 30px;
        }}
        .summary {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin: 20px 0;
        }}
        .summary-card {{
            background: #f8f9fa;
            padding: 20px;
            border-radius: 6px;
            border-left: 4px solid #3498db;
        }}
        .summary-card h3 {{
            margin: 0 0 10px 0;
            color: #2c3e50;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }}
        .summary-card .value {{
            font-size: 32px;
            font-weight: bold;
            color: #3498db;
        }}
        .summary-card.critical {{ border-left-color: #dc3545; }}
        .summary-card.critical .value {{ color: #dc3545; }}
        .summary-card.minor {{ border-left-color: #ffc107; }}
        .summary-card.minor .value {{ color: #ffc107; }}
        .summary-card.pass {{ border-left-color: #28a745; }}
        .summary-card.pass .value {{ color: #28a745; }}
        table {{
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
            background: white;
        }}
        th {{
            background: #34495e;
            color: white;
            padding: 12px;
            text-align: left;
            font-weight: 600;
        }}
        td {{
            padding: 12px;
            border-bottom: 1px solid #ddd;
        }}
        tr:hover {{
            background: #f8f9fa;
        }}
        .scenario-detail {{
            margin: 30px 0;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 6px;
            border-left: 4px solid #6c757d;
        }}
        .scenario-detail.critical {{
            border-left-color: #dc3545;
            background: #fff5f5;
        }}
        .scenario-detail.minor {{
            border-left-color: #ffc107;
            background: #fffbf0;
        }}
        .scenario-detail.pass {{
            border-left-color: #28a745;
            background: #f0fff4;
        }}
        .code-block {{
            background: #2d2d2d;
            color: #f8f8f2;
            padding: 15px;
            border-radius: 4px;
            overflow-x: auto;
            font-family: 'Courier New', monospace;
            font-size: 13px;
            margin: 10px 0;
        }}
        .metadata {{
            font-size: 12px;
            color: #6c757d;
            margin-top: 10px;
        }}
        .footer {{
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #ddd;
            text-align: center;
            color: #6c757d;
            font-size: 12px;
        }}
    </style>
</head>
<body>
    <div class="container">
        <h1>Agent Evaluation Report</h1>
        <p class="metadata">Generated: {datetime.now().strftime(
            '%Y-%m-%d %H:%M:%S'
        )}</p>

        <div class="summary">
            <div class="summary-card">
                <h3>Total Scenarios</h3>
                <div class="value">{total}</div>
            </div>
            <div class="summary-card pass">
                <h3>Passed</h3>
                <div class="value">{passed}</div>
            </div>
            <div class="summary-card minor">
                <h3>Minor Failures</h3>
                <div class="value">{failed_minor}</div>
            </div>
            <div class="summary-card critical">
                <h3>Critical Failures</h3>
                <div class="value">{failed_critical}</div>
            </div>
            <div class="summary-card">
                <h3>Safety Score</h3>
                <div class="value">{safety_score:.1f}%</div>
            </div>
        </div>

        <h2>Scenario Results</h2>
        <table>
            <thead>
                <tr>
                    <th>Scenario ID</th>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Score</th>
                    <th>Tags</th>
                </tr>
            </thead>
            <tbody>
"""

    # Add table rows
    for result in results:
        status = result.status if result.status != "UNKNOWN" else (
            "PASS" if result.success else "FAIL_CRITICAL"
        )
        scenario_name = result.scenario_id.split(".")[-1]
        tags_str = ", ".join(result.tags) if result.tags else "N/A"

        html += f"""
                <tr>
                    <td><code>{result.scenario_id}</code></td>
                    <td>{scenario_name}</td>
                    <td>{status_badge(status)}</td>
                    <td>{result.score:.2f}</td>
                    <td>{tags_str}</td>
                </tr>
"""

    html += """
            </tbody>
        </table>
"""

    # Add detailed failure sections
    failed_results = [r for r in results if r.status != "PASS"]
    if failed_results:
        html += '<h2>Detailed Results</h2>'

        for result in failed_results:
            status = result.status if result.status != "UNKNOWN" else "FAIL_CRITICAL"
            status_class = status.lower().replace("_", "-")

            html += f"""
        <div class="scenario-detail {status_class}">
            <h3>{result.scenario_id}</h3>
            <p><strong>Status:</strong> {status_badge(status)}</p>
            <p><strong>Score:</strong> {result.score:.2f}</p>
"""

            if result.reasoning:
                html += f'<p><strong>Reasoning:</strong> {result.reasoning}</p>'

            if result.fail_reasons:
                html += '<p><strong>Violations:</strong></p><ul>'
                for reason in result.fail_reasons:
                    html += f'<li>{reason}</li>'
                html += '</ul>'

            # Response preview
            response_preview = result.raw_response[:500]
            if len(result.raw_response) > 500:
                response_preview += "... (truncated)"

            html += f"""
            <p><strong>Response Preview:</strong></p>
            <div class="code-block">{_escape_html(response_preview)}</div>
"""

            if result.metadata:
                metadata_str = ", ".join(
                    f"{k}: {v}" for k, v in result.metadata.items()
                )
                html += f'<p class="metadata">Metadata: {metadata_str}</p>'

            html += '</div>'

    html += """
        <div class="footer">
            <p>Generated by Agent Evaluation Lab</p>
        </div>
    </div>
</body>
</html>
"""

    return html


def _escape_html(text: str) -> str:
    """Escape HTML special characters."""
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#x27;")
    )


def _generate_empty_html() -> str:
    """Generate HTML for empty results."""
    return """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Agent Evaluation Report</title>
</head>
<body>
    <h1>Agent Evaluation Report</h1>
    <p>No scenarios were executed.</p>
</body>
</html>
"""

