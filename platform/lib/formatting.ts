export function humanizeLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function formatFallback<T>(
  value: T | null | undefined,
  fallback = "Not available"
): string {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "--" || trimmed === "undefined" || trimmed === "null") {
      return fallback;
    }
    return trimmed;
  }

  return String(value);
}

export function formatStatusLabel(status: string | null | undefined): string {
  const normalized = formatFallback(status, "").toLowerCase();
  if (!normalized) {
    return "Unknown";
  }

  const mapping: Record<string, string> = {
    queued: "Queued",
    pending: "Pending",
    running: "Running",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
    mixed: "Mixed",
  };

  return mapping[normalized] || humanizeLabel(normalized);
}

export function formatGateOutcome(status: string | null | undefined): string {
  const normalized = formatFallback(status, "").toLowerCase();
  const mapping: Record<string, string> = {
    go: "Release approved",
    block: "Release blocked",
    pending: "Gate pending",
    unavailable: "Gate unavailable",
  };
  return mapping[normalized] || "Gate unavailable";
}

export function formatSeverityLabel(severity: string | null | undefined): string {
  const normalized = formatFallback(severity, "").toUpperCase();
  const mapping: Record<string, string> = {
    PASS: "Passed",
    FAIL_MINOR: "Minor failure",
    FAIL_CRITICAL: "Critical failure",
    ERROR: "Error",
  };
  return mapping[normalized] || humanizeLabel(normalized.toLowerCase());
}

export function formatPercent(
  value: number | null | undefined,
  digits = 1,
  fallback = "Not available"
): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return `${value.toFixed(digits)}%`;
}

export function formatScore(
  value: number | null | undefined,
  digits = 1,
  fallback = "Not scored"
): string {
  return formatPercent(value, digits, fallback);
}

export function formatDurationMs(
  value: number | null | undefined,
  fallback = "Not available"
): string {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    return fallback;
  }

  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }

  const totalSeconds = Math.round(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function formatDurationBetween(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined,
  fallback = "Not available"
): string {
  if (!start || !end) {
    return fallback;
  }
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
    return fallback;
  }
  return formatDurationMs(endTime - startTime, fallback);
}

export function formatDateTime(
  value: Date | string | null | undefined,
  fallback = "Not available"
): string {
  if (!value) {
    return fallback;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  return date.toLocaleString();
}

export function formatInteger(
  value: number | null | undefined,
  fallback = "0"
): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Intl.NumberFormat().format(value);
}

export function formatLatency(
  value: number | null | undefined,
  fallback = "Not available"
): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return formatDurationMs(value, fallback);
}

export function formatListSummary(
  values: Array<string | null | undefined> | null | undefined,
  fallback = "None"
): string {
  const list = (values || [])
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
  return list.length > 0 ? list.join(", ") : fallback;
}
