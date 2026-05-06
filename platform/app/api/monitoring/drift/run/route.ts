import { NextRequest, NextResponse } from "next/server";

import {
  apiKeyCanActAsRole,
  authenticateApiKeyFromRequest,
  hasRequiredScope,
} from "@/lib/api-keys";
import { sendAuditEvent } from "@/lib/alerts";
import { getAuth } from "@/lib/auth";
import { buildDriftReport } from "@/lib/drift-monitoring";
import { ensureOrganizationByClerkId } from "@/lib/org";
import { authorizeRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function toOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

export async function POST(request: NextRequest) {
  try {
    const { userId, orgId } = getAuth();
    let organizationId: string | null = null;
    let organizationClerkId: string | null = null;
    let actorUserId: string | null = userId || null;
    let role = "viewer";

    if (userId) {
      if (!orgId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const authz = await authorizeRole({
        userId,
        orgId,
        requiredRole: "release_manager",
      });
      if (!authz.ok) {
        return NextResponse.json(
          { error: "Forbidden: release_manager role required", currentRole: authz.role },
          { status: 403 }
        );
      }
      const org = await ensureOrganizationByClerkId({ clerkId: orgId });
      organizationId = org.id;
      organizationClerkId = org.clerkId;
      role = authz.role;
    } else {
      const apiKeyAuth = await authenticateApiKeyFromRequest(request);
      if (!apiKeyAuth) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (!apiKeyAuth.ok) {
        return NextResponse.json(
          { error: apiKeyAuth.error || "Unauthorized" },
          { status: 401 }
        );
      }
      if (!apiKeyCanActAsRole(apiKeyAuth.role, "release_manager")) {
        return NextResponse.json(
          {
            error: "Forbidden: release_manager role required",
            currentRole: apiKeyAuth.role,
          },
          { status: 403 }
        );
      }
      if (
        !hasRequiredScope(apiKeyAuth.scopes, "evaluate:run") &&
        !hasRequiredScope(apiKeyAuth.scopes, "usage:read")
      ) {
        return NextResponse.json(
          {
            error: "Forbidden: missing scope evaluate:run or usage:read",
            requiredScope: "evaluate:run|usage:read",
            scopes: apiKeyAuth.scopes || [],
          },
          { status: 403 }
        );
      }
      organizationId = apiKeyAuth.organizationId || null;
      organizationClerkId = apiKeyAuth.orgClerkId || null;
      actorUserId = apiKeyAuth.keyId || null;
      role = apiKeyAuth.role || "viewer";
    }

    if (!organizationId) {
      return NextResponse.json(
        { error: "Organization context missing" },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const notifyOnNoDrift = Boolean(body?.notifyOnNoDrift);

    const report = await buildDriftReport({
      organizationId,
      lookbackDays: toOptionalNumber(body?.lookback_days),
      windowDays: toOptionalNumber(body?.window_days),
      minimumSamples: toOptionalNumber(body?.minimum_samples),
      safetyDropThreshold: toOptionalNumber(body?.safety_drop_threshold),
      criticalIncreaseThreshold: toOptionalNumber(body?.critical_increase_threshold),
      minimumSafetyScore: toOptionalNumber(body?.minimum_safety_score),
    });

    let alerted = false;
    if (report.drift.detected || notifyOnNoDrift) {
      const title = report.drift.detected
        ? report.drift.severity === "critical"
          ? "Model Drift Detected (Critical)"
          : "Model Drift Detected"
        : "Model Drift Check (No Drift)";
      const eventType = report.drift.detected
        ? "platform.monitoring.drift_detected"
        : "platform.monitoring.drift_ok";
      const severity = report.drift.detected
        ? report.drift.severity === "critical"
          ? "critical"
          : "warning"
        : "info";

      const lines: string[] = [
        `Status: ${report.drift.status}`,
        `Current Window: ${report.windows.current.evaluations} evaluations`,
        `Baseline Window: ${report.windows.baseline.evaluations} evaluations`,
        `Current Avg Safety: ${report.windows.current.avgSafetyScore}%`,
        `Baseline Avg Safety: ${report.windows.baseline.avgSafetyScore}%`,
        `Safety Delta: ${report.deltas.safetyScore} points`,
        `Critical Delta: ${report.deltas.failedCritical} per evaluation`,
      ];
      if (report.drift.signals.length > 0) {
        lines.push(
          `Signals: ${report.drift.signals
            .map((signal) => `${signal.code} (${signal.message})`)
            .join(" | ")}`
        );
      }

      await sendAuditEvent({
        eventType,
        severity,
        title,
        lines,
        metadata: {
          drift: report.drift,
          deltas: report.deltas,
          sampleSizes: report.sampleSizes,
          parameters: report.parameters,
        },
        actorUserId,
        organizationId: organizationClerkId,
      });
      alerted = true;
    }

    return NextResponse.json({
      success: true,
      alerted,
      report,
      access: {
        role,
      },
    });
  } catch (error: any) {
    console.error("Drift monitoring run API error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
