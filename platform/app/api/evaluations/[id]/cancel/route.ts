import { NextRequest, NextResponse } from "next/server";

import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { evaluationQueue } from "@/lib/evaluation-queue";
import { sendAuditEvent } from "@/lib/alerts";
import { hasRoleAtLeast, resolveAppRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { userId, orgId } = getAuth();
    if (!userId || !orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = await resolveAppRole({ userId, orgId });
    if (!hasRoleAtLeast(userRole, "release_manager")) {
      return NextResponse.json(
        {
          error: "Forbidden: release_manager role required to cancel evaluations",
          requiredRole: "release_manager",
          currentRole: userRole,
        },
        { status: 403 }
      );
    }

    const resolvedParams = await Promise.resolve(params);
    const evaluation = await prisma.evaluation.findUnique({
      where: { id: resolvedParams.id },
      include: {
        project: {
          include: {
            organization: true,
          },
        },
      },
    });

    if (!evaluation) {
      return NextResponse.json({ error: "Evaluation not found" }, { status: 404 });
    }

    if (evaluation.project.organization.clerkId !== orgId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const previousStatus = evaluation.status;
    const result = await evaluationQueue.cancelEvaluation(evaluation.id);

    const config = (evaluation.config ?? {}) as Record<string, unknown>;
    const releaseMode = String(config.release_mode ?? "exploratory");
    const releasePolicy =
      config.release_policy && typeof config.release_policy === "object"
        ? (config.release_policy as Record<string, unknown>)
        : null;
    if (
      result.cancelled &&
      previousStatus !== "cancelled" &&
      releaseMode === "release_candidate"
    ) {
      await sendAuditEvent({
        eventType: "release.candidate.cancelled",
        severity: "warning",
        actorUserId: userId,
        organizationId: orgId,
        evaluationId: evaluation.id,
        title: "Release Candidate Cancelled",
        lines: [
          `Evaluation ID: ${evaluation.id}`,
          `Name: ${evaluation.name || "Untitled Evaluation"}`,
          `Policy: ${String(releasePolicy?.name || "unknown")} (${String(
            releasePolicy?.version_id || "legacy"
          )})`,
          `Previous Status: ${previousStatus}`,
          `Result: ${result.message}`,
        ],
        metadata: {
          previous_status: previousStatus,
          release_mode: releaseMode,
          policy_id:
            typeof releasePolicy?.version_id === "string"
              ? releasePolicy.version_id
              : null,
        },
      });
    }

    return NextResponse.json(
      {
        success: result.cancelled,
        message: result.message,
        evaluationId: evaluation.id,
      },
      { status: result.statusCode }
    );
  } catch (error: any) {
    console.error("Cancel API error:", error);
    return NextResponse.json(
      {
        error: error.message || "Internal server error",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
