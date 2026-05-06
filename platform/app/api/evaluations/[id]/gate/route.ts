import { NextRequest, NextResponse } from "next/server";

import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { evaluateGateForEvaluation } from "@/lib/evaluation-gate";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { userId, orgId } = getAuth();
    if (!userId || !orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    const evaluationResult = await evaluateGateForEvaluation({
      id: evaluation.id,
      projectId: evaluation.projectId,
      status: evaluation.status,
      createdAt: evaluation.createdAt,
      reportJson: evaluation.reportJson,
      config: evaluation.config,
      scenarios: evaluation.scenarios,
    });

    return NextResponse.json({
      evaluationId: evaluation.id,
      evaluationStatus: evaluation.status,
      releaseMode: evaluationResult.releaseMode,
      policyId: evaluationResult.policyId,
      policySource: evaluationResult.policySource,
      baselineEvaluationId: evaluationResult.baselineEvaluationId,
      gate: evaluationResult.gate,
      regression: evaluationResult.regression,
    });
  } catch (error: any) {
    console.error("Gate API error:", error);
    return NextResponse.json(
      {
        error: error.message || "Internal server error",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
