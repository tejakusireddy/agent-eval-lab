export function normalizeReportJson(reportJson: unknown): unknown | null {
  if (reportJson === null || reportJson === undefined) {
    return null;
  }

  if (typeof reportJson === "string") {
    try {
      return JSON.parse(reportJson);
    } catch {
      return null;
    }
  }

  return reportJson;
}
