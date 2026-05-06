import { NextRequest, NextResponse } from "next/server";
import {
  apiKeyCanActAsRole,
  authenticateApiKeyFromRequest,
  hasRequiredScope,
} from "@/lib/api-keys";
import { prisma } from "@/lib/db";
import { normalizeReportJson } from "@/app/_utils/report-json";
import { extractCalibrationWarnings } from "@/lib/evaluation-gate";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getRequestBaseUrl(request: NextRequest): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (envUrl) {
    return envUrl;
  }
  const proto = request.headers.get("x-forwarded-proto") || "http";
  const host = request.headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

type ReportSummary = {
  total?: number;
  passed?: number;
  failed_minor?: number;
  failed_critical?: number;
  safety_score?: number;
};

/**
 * Poll public evaluation status (API key, evaluate:read).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
): Promise<NextResponse> {
  const apiKeyAuth = await authenticateApiKeyFromRequest(request);
  if (!apiKeyAuth) {
    return NextResponse.json(
      { error: "Unauthorized: API key required" },
      { status: 401 }
    );
  }
  if (!apiKeyAuth.ok) {
    return NextResponse.json(
      { error: apiKeyAuth.error || "Unauthorized" },
      { status: 401 }
    );
  }
  if (!apiKeyCanActAsRole(apiKeyAuth.role, "viewer")) {
    return NextResponse.json(
      {
        error: "Forbidden: viewer role required",
        requiredRole: "viewer",
        currentRole: apiKeyAuth.role,
      },
      { status: 403 }
    );
  }
  if (!hasRequiredScope(apiKeyAuth.scopes, "evaluate:read")) {
    return NextResponse.json(
      {
        error: "Forbidden: missing scope evaluate:read",
        requiredScope: "evaluate:read",
        scopes: apiKeyAuth.scopes ?? [],
      },
      { status: 403 }
    );
  }

  const organizationId = apiKeyAuth.organizationId;
  if (!organizationId) {
    return NextResponse.json(
      { error: "Organization context missing for API key" },
      { status: 400 }
    );
  }

  const resolvedParams = await Promise.resolve(params);
  const evaluationId = resolvedParams.id;

  let evaluation;
  try {
    evaluation = await prisma.evaluation.findFirst({
      where: {
        id: evaluationId,
        project: { organizationId },
      },
      select: {
        id: true,
        status: true,
        safetyScore: true,
        reportJson: true,
        errorMessage: true,
        completedAt: true,
        config: true,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to load evaluation", detail: message },
      { status: 500 }
    );
  }

  if (!evaluation) {
    return NextResponse.json({ error: "Evaluation not found" }, { status: 404 });
  }

  const base = getRequestBaseUrl(request);
  const pollUrl = `${base}/api/v1/eval/${evaluation.id}`;
  const reportUrl = `${base}/api/v1/eval/${evaluation.id}/report`;

  const configRecord = evaluation.config as { release_mode?: string } | null;
  const releaseMode = configRecord?.release_mode ?? "exploratory";

  const status = evaluation.status;

  if (status === "queued" || status === "pending" || status === "running") {
    return NextResponse.json({
      spec_version: "1.0" as const,
      evaluation_id: evaluation.id,
      status: status === "running" ? "running" : "queued",
      poll_url: pollUrl,
      poll_interval_seconds: 5,
    });
  }

  if (status === "cancelled") {
    return NextResponse.json({
      spec_version: "1.0" as const,
      evaluation_id: evaluation.id,
      status: "cancelled" as const,
    });
  }

  if (status === "failed") {
    return NextResponse.json({
      spec_version: "1.0" as const,
      evaluation_id: evaluation.id,
      status: "failed" as const,
      error: evaluation.errorMessage || "Evaluation failed",
      failed_at:
        evaluation.completedAt?.toISOString() ?? new Date().toISOString(),
    });
  }

  if (status === "completed") {
    const normalized = normalizeReportJson(evaluation.reportJson) as {
      summary?: ReportSummary;
    } | null;
    const summary = normalized?.summary ?? {};
    const safetyScore =
      typeof summary.safety_score === "number"
        ? summary.safety_score
        : (evaluation.safetyScore ?? 0);

    const calibration_warnings = extractCalibrationWarnings(
      evaluation.reportJson
    );
    const graders_calibrated = calibration_warnings.length === 0;

    return NextResponse.json({
      spec_version: "1.0" as const,
      evaluation_id: evaluation.id,
      status: "completed" as const,
      safety_score: safetyScore,
      summary: {
        total: summary.total ?? 0,
        passed: summary.passed ?? 0,
        failed_minor: summary.failed_minor ?? 0,
        failed_critical: summary.failed_critical ?? 0,
        safety_score: safetyScore,
      },
      release_mode: releaseMode,
      completed_at:
        evaluation.completedAt?.toISOString() ?? new Date().toISOString(),
      report_url: reportUrl,
      calibration_warnings,
      graders_calibrated,
    });
  }

  return NextResponse.json(
    { error: "Unknown evaluation status", status },
    { status: 500 }
  );
}
