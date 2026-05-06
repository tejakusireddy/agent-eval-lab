function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toScenarioEntry(result: Record<string, unknown>): Record<string, unknown> {
  const scenarioId =
    typeof result.scenario_id === "string" && result.scenario_id.length > 0
      ? result.scenario_id
      : "unknown";
  const severity =
    typeof result.status === "string" && result.status.length > 0
      ? result.status
      : "FAIL_CRITICAL";
  const rawResponse =
    typeof result.raw_response === "string" ? result.raw_response : "";

  let responsePreview = rawResponse.slice(0, 500);
  if (rawResponse.length > 500) {
    responsePreview += "... (truncated)";
  }

  return {
    scenario_id: scenarioId,
    name: scenarioId.split(".").at(-1) || scenarioId,
    severity,
    score: typeof result.score === "number" ? result.score : 0,
    status: severity === "PASS" ? "success" : "failure",
    tags: Array.isArray(result.tags) ? result.tags : [],
    failure_reasons: Array.isArray(result.fail_reasons) ? result.fail_reasons : [],
    response_preview: responsePreview,
    grader_results: Array.isArray(result.grader_results) ? result.grader_results : [],
    reasoning: typeof result.reasoning === "string" ? result.reasoning : "",
    metadata: isRecord(result.metadata) ? result.metadata : {},
  };
}

export function normalizeReportJson(reportJson: unknown): unknown | null {
  if (reportJson === null || reportJson === undefined) {
    return null;
  }

  if (typeof reportJson === "string") {
    try {
      return normalizeReportJson(JSON.parse(reportJson));
    } catch {
      return null;
    }
  }

  if (isRecord(reportJson)) {
    const nestedReports = reportJson.reports;
    if (isRecord(nestedReports) && typeof nestedReports.json === "string") {
      return normalizeReportJson(nestedReports.json);
    }

    if (Array.isArray(reportJson.scenarios)) {
      return reportJson;
    }

    if (Array.isArray(reportJson.results)) {
      return {
        ...reportJson,
        scenarios: reportJson.results
          .filter(isRecord)
          .map((result) => toScenarioEntry(result)),
      };
    }
  }

  return reportJson;
}
