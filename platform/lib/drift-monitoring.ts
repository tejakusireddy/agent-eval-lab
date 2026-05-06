import { normalizeReportJson } from "@/app/_utils/report-json";
import { prisma } from "@/lib/db";

export interface DriftMonitorParams {
  organizationId: string;
  lookbackDays?: number;
  windowDays?: number;
  minimumSamples?: number;
  safetyDropThreshold?: number;
  criticalIncreaseThreshold?: number;
  minimumSafetyScore?: number;
}

export interface DriftWindowMetrics {
  evaluations: number;
  avgSafetyScore: number;
  avgFailedCritical: number;
  avgFailedMinor: number;
  passRate: number;
}

export interface DriftSignal {
  code: string;
  severity: "warning" | "critical";
  message: string;
  actual: number;
  threshold: number;
}

export interface DriftTrendPoint {
  date: string;
  evaluations: number;
  avgSafetyScore: number;
  avgFailedCritical: number;
  avgFailedMinor: number;
}

export interface DriftReport {
  generatedAt: string;
  parameters: {
    lookbackDays: number;
    windowDays: number;
    minimumSamples: number;
    safetyDropThreshold: number;
    criticalIncreaseThreshold: number;
    minimumSafetyScore: number;
  };
  sampleSizes: {
    total: number;
    baseline: number;
    current: number;
  };
  windows: {
    baseline: DriftWindowMetrics;
    current: DriftWindowMetrics;
  };
  deltas: {
    safetyScore: number;
    failedCritical: number;
    failedMinor: number;
    passRate: number;
  };
  drift: {
    detected: boolean;
    severity: "info" | "warning" | "critical";
    status: "insufficient_data" | "ok" | "drift_detected";
    signals: DriftSignal[];
  };
  trend: DriftTrendPoint[];
}

interface EvaluationMetrics {
  createdAt: Date;
  safetyScore: number;
  failedCritical: number;
  failedMinor: number;
  passed: number;
  total: number;
}

function toBoundedInt(
  value: number | undefined,
  fallback: number,
  minValue: number,
  maxValue: number
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minValue, Math.min(maxValue, Math.floor(value as number)));
}

function toBoundedFloat(
  value: number | undefined,
  fallback: number,
  minValue: number,
  maxValue: number
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minValue, Math.min(maxValue, Number(value)));
}

function avg(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function safeSummaryFromReportJson(reportJson: unknown): {
  safetyScore: number | null;
  failedCritical: number;
  failedMinor: number;
  passed: number;
  total: number;
} {
  const normalized = normalizeReportJson(reportJson);
  if (!normalized || typeof normalized !== "object") {
    return {
      safetyScore: null,
      failedCritical: 0,
      failedMinor: 0,
      passed: 0,
      total: 0,
    };
  }

  const summary = (normalized as any).summary || {};
  const safetyScore =
    typeof summary.safety_score === "number" && Number.isFinite(summary.safety_score)
      ? Number(summary.safety_score)
      : null;
  const failedCritical = Number.isFinite(Number(summary.failed_critical))
    ? Math.max(0, Math.floor(Number(summary.failed_critical)))
    : 0;
  const failedMinor = Number.isFinite(Number(summary.failed_minor))
    ? Math.max(0, Math.floor(Number(summary.failed_minor)))
    : 0;
  const passed = Number.isFinite(Number(summary.passed))
    ? Math.max(0, Math.floor(Number(summary.passed)))
    : 0;
  const total = Number.isFinite(Number(summary.total))
    ? Math.max(0, Math.floor(Number(summary.total)))
    : 0;

  return {
    safetyScore,
    failedCritical,
    failedMinor,
    passed,
    total,
  };
}

function computeWindowMetrics(evaluations: EvaluationMetrics[]): DriftWindowMetrics {
  const avgSafetyScore = round(avg(evaluations.map((item) => item.safetyScore)));
  const avgFailedCritical = round(avg(evaluations.map((item) => item.failedCritical)));
  const avgFailedMinor = round(avg(evaluations.map((item) => item.failedMinor)));
  const totalPassed = evaluations.reduce((sum, item) => sum + item.passed, 0);
  const totalScenarios = evaluations.reduce((sum, item) => sum + item.total, 0);
  const passRate =
    totalScenarios > 0 ? round((totalPassed / totalScenarios) * 100) : 0;

  return {
    evaluations: evaluations.length,
    avgSafetyScore,
    avgFailedCritical,
    avgFailedMinor,
    passRate,
  };
}

export async function buildDriftReport(params: DriftMonitorParams): Promise<DriftReport> {
  const lookbackDays = toBoundedInt(params.lookbackDays, 30, 7, 180);
  const windowDays = toBoundedInt(params.windowDays, 7, 2, 60);
  const minimumSamples = toBoundedInt(params.minimumSamples, 3, 1, 50);
  const safetyDropThreshold = toBoundedFloat(params.safetyDropThreshold, 5, 0, 100);
  const criticalIncreaseThreshold = toBoundedFloat(
    params.criticalIncreaseThreshold,
    1,
    0,
    50
  );
  const minimumSafetyScore = toBoundedFloat(params.minimumSafetyScore, 80, 0, 100);

  const now = new Date();
  const lookbackStart = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const currentWindowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const baselineWindowStart = new Date(
    currentWindowStart.getTime() - windowDays * 24 * 60 * 60 * 1000
  );

  const evaluationsRaw = await prisma.evaluation.findMany({
    where: {
      status: "completed",
      createdAt: {
        gte: lookbackStart,
      },
      project: {
        organizationId: params.organizationId,
      },
    },
    select: {
      createdAt: true,
      safetyScore: true,
      reportJson: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const evaluations: EvaluationMetrics[] = evaluationsRaw.map((evaluation) => {
    const parsed = safeSummaryFromReportJson(evaluation.reportJson);
    const safetyScore = round(
      typeof parsed.safetyScore === "number"
        ? parsed.safetyScore
        : typeof evaluation.safetyScore === "number"
          ? evaluation.safetyScore
          : 0
    );
    return {
      createdAt: evaluation.createdAt,
      safetyScore,
      failedCritical: parsed.failedCritical,
      failedMinor: parsed.failedMinor,
      passed: parsed.passed,
      total: parsed.total,
    };
  });

  const baseline = evaluations.filter(
    (item) => item.createdAt >= baselineWindowStart && item.createdAt < currentWindowStart
  );
  const current = evaluations.filter((item) => item.createdAt >= currentWindowStart);

  const baselineMetrics = computeWindowMetrics(baseline);
  const currentMetrics = computeWindowMetrics(current);

  const deltas = {
    safetyScore: round(currentMetrics.avgSafetyScore - baselineMetrics.avgSafetyScore),
    failedCritical: round(currentMetrics.avgFailedCritical - baselineMetrics.avgFailedCritical),
    failedMinor: round(currentMetrics.avgFailedMinor - baselineMetrics.avgFailedMinor),
    passRate: round(currentMetrics.passRate - baselineMetrics.passRate),
  };

  const signals: DriftSignal[] = [];
  const hasEnoughSamples =
    baselineMetrics.evaluations >= minimumSamples &&
    currentMetrics.evaluations >= minimumSamples;

  if (currentMetrics.evaluations > 0 && currentMetrics.avgSafetyScore < minimumSafetyScore) {
    signals.push({
      code: "minimum_safety_breach",
      severity: "critical",
      message: `Current window average safety score is below minimum (${currentMetrics.avgSafetyScore} < ${minimumSafetyScore})`,
      actual: currentMetrics.avgSafetyScore,
      threshold: minimumSafetyScore,
    });
  }

  if (hasEnoughSamples) {
    if (deltas.safetyScore <= -safetyDropThreshold) {
      signals.push({
        code: "safety_score_drop",
        severity: deltas.safetyScore <= -(safetyDropThreshold * 2) ? "critical" : "warning",
        message: `Safety score dropped by ${Math.abs(deltas.safetyScore)} points over baseline window`,
        actual: deltas.safetyScore,
        threshold: -safetyDropThreshold,
      });
    }

    if (deltas.failedCritical >= criticalIncreaseThreshold) {
      signals.push({
        code: "critical_failures_increase",
        severity:
          deltas.failedCritical >= criticalIncreaseThreshold * 2 ? "critical" : "warning",
        message: `Average critical failures increased by ${deltas.failedCritical} per evaluation`,
        actual: deltas.failedCritical,
        threshold: criticalIncreaseThreshold,
      });
    }
  }

  const driftDetected = signals.length > 0;
  const severity: "info" | "warning" | "critical" = driftDetected
    ? signals.some((signal) => signal.severity === "critical")
      ? "critical"
      : "warning"
    : "info";

  const status: "insufficient_data" | "ok" | "drift_detected" = driftDetected
    ? "drift_detected"
    : hasEnoughSamples
      ? "ok"
      : "insufficient_data";

  const trendMap = new Map<
    string,
    { safetyScores: number[]; failedCritical: number[]; failedMinor: number[] }
  >();
  for (const evaluation of evaluations) {
    const date = evaluation.createdAt.toISOString().slice(0, 10);
    if (!trendMap.has(date)) {
      trendMap.set(date, { safetyScores: [], failedCritical: [], failedMinor: [] });
    }
    const bucket = trendMap.get(date)!;
    bucket.safetyScores.push(evaluation.safetyScore);
    bucket.failedCritical.push(evaluation.failedCritical);
    bucket.failedMinor.push(evaluation.failedMinor);
  }

  const trend: DriftTrendPoint[] = Array.from(trendMap.entries()).map(([date, bucket]) => ({
    date,
    evaluations: bucket.safetyScores.length,
    avgSafetyScore: round(avg(bucket.safetyScores)),
    avgFailedCritical: round(avg(bucket.failedCritical)),
    avgFailedMinor: round(avg(bucket.failedMinor)),
  }));

  return {
    generatedAt: new Date().toISOString(),
    parameters: {
      lookbackDays,
      windowDays,
      minimumSamples,
      safetyDropThreshold,
      criticalIncreaseThreshold,
      minimumSafetyScore,
    },
    sampleSizes: {
      total: evaluations.length,
      baseline: baselineMetrics.evaluations,
      current: currentMetrics.evaluations,
    },
    windows: {
      baseline: baselineMetrics,
      current: currentMetrics,
    },
    deltas,
    drift: {
      detected: driftDetected,
      severity,
      status,
      signals,
    },
    trend,
  };
}
