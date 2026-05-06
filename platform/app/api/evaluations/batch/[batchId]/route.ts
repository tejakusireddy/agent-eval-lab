import { NextRequest, NextResponse } from "next/server";

import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeReportJson } from "@/app/_utils/report-json";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type BatchConfig = {
  batch_id?: string;
  index?: number;
  total?: number;
  agent_name?: string;
};

function readBatchConfig(config: unknown): BatchConfig | null {
  if (!config || typeof config !== "object") {
    return null;
  }
  const batch = (config as Record<string, unknown>).batch;
  if (!batch || typeof batch !== "object") {
    return null;
  }
  return batch as BatchConfig;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> | { batchId: string } }
) {
  try {
    const { userId, orgId } = getAuth();
    if (!userId || !orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resolvedParams = await Promise.resolve(params);
    const batchId = resolvedParams.batchId;
    if (!batchId) {
      return NextResponse.json({ error: "batchId is required" }, { status: 400 });
    }

    const evaluations = await prisma.evaluation.findMany({
      where: {
        project: {
          organization: {
            clerkId: orgId,
          },
        },
      },
      include: {
        project: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 500,
    });

    const batchEvaluations = evaluations
      .map((evaluation) => {
        const batchConfig = readBatchConfig(evaluation.config);
        if (!batchConfig || batchConfig.batch_id !== batchId) {
          return null;
        }

        const reportJson = normalizeReportJson(evaluation.reportJson);
        const summary =
          reportJson && typeof reportJson === "object"
            ? (reportJson as any).summary || {}
            : {};

        return {
          id: evaluation.id,
          name: evaluation.name,
          status: evaluation.status,
          safetyScore: evaluation.safetyScore,
          createdAt: evaluation.createdAt,
          completedAt: evaluation.completedAt,
          project: evaluation.project,
          batch: {
            index: typeof batchConfig.index === "number" ? batchConfig.index : null,
            total: typeof batchConfig.total === "number" ? batchConfig.total : null,
            agentName:
              typeof batchConfig.agent_name === "string"
                ? batchConfig.agent_name
                : "Unknown Agent",
          },
          summary: {
            total: Number(summary.total || 0),
            passed: Number(summary.passed || 0),
            failed_minor: Number(summary.failed_minor || 0),
            failed_critical: Number(summary.failed_critical || 0),
          },
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .sort((a, b) => {
        const ai = a.batch.index ?? Number.MAX_SAFE_INTEGER;
        const bi = b.batch.index ?? Number.MAX_SAFE_INTEGER;
        return ai - bi;
      });

    if (batchEvaluations.length === 0) {
      return NextResponse.json(
        {
          error: "Batch not found",
          batchId,
        },
        { status: 404 }
      );
    }

    const aggregate = batchEvaluations.reduce(
      (acc, evaluation) => {
        acc.total += 1;
        acc.byStatus[evaluation.status] = (acc.byStatus[evaluation.status] || 0) + 1;
        if (evaluation.safetyScore !== null) {
          acc.safetyScoreCount += 1;
          acc.safetyScoreSum += evaluation.safetyScore;
        }
        acc.failedCritical += evaluation.summary.failed_critical;
        acc.failedMinor += evaluation.summary.failed_minor;
        return acc;
      },
      {
        total: 0,
        byStatus: {} as Record<string, number>,
        safetyScoreCount: 0,
        safetyScoreSum: 0,
        failedCritical: 0,
        failedMinor: 0,
      }
    );

    const avgSafetyScore =
      aggregate.safetyScoreCount > 0
        ? aggregate.safetyScoreSum / aggregate.safetyScoreCount
        : null;

    const fastestCompleted = batchEvaluations
      .filter((e) => e.completedAt && e.createdAt)
      .map((e) => ({
        id: e.id,
        agentName: e.batch.agentName,
        durationMs: new Date(e.completedAt!).getTime() - new Date(e.createdAt).getTime(),
      }))
      .sort((a, b) => a.durationMs - b.durationMs)[0];

    const topSafety = batchEvaluations
      .filter((e) => typeof e.safetyScore === "number")
      .sort((a, b) => (b.safetyScore || 0) - (a.safetyScore || 0))[0];

    return NextResponse.json({
      success: true,
      batchId,
      aggregate: {
        totalEvaluations: aggregate.total,
        byStatus: aggregate.byStatus,
        averageSafetyScore:
          avgSafetyScore !== null ? Number(avgSafetyScore.toFixed(2)) : null,
        totalFailedCritical: aggregate.failedCritical,
        totalFailedMinor: aggregate.failedMinor,
      },
      leaderboard: {
        highestSafetyScore: topSafety
          ? {
              evaluationId: topSafety.id,
              agentName: topSafety.batch.agentName,
              safetyScore: topSafety.safetyScore,
            }
          : null,
        fastestCompletion: fastestCompleted || null,
      },
      evaluations: batchEvaluations,
    });
  } catch (error: any) {
    console.error("Batch detail API error:", error);
    return NextResponse.json(
      {
        error: error.message || "Internal server error",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
