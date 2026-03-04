import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { runEvaluation } from "@/lib/run-eval";
import { randomUUID } from "crypto";
import { join } from "path";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const { userId, orgId } = getAuth();
    if (!userId || !orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      projectId,
      name,
      config,
      scenarioIds,
    }: {
      projectId: string;
      name?: string;
      config: any;
      scenarioIds: string[];
    } = body;

    // Create evaluation record
    const evaluation = await prisma.evaluation.create({
      data: {
        projectId,
        name: name || `Evaluation ${new Date().toLocaleString()}`,
        status: "pending",
        scenarios: scenarioIds,
        config,
      },
    });

    // Start evaluation in background (async)
    const workDir = join("/tmp", "agent-eval", evaluation.id);
    runEvaluation(config, scenarioIds, workDir)
      .then(async (result) => {
        await prisma.evaluation.update({
          where: { id: evaluation.id },
          data: {
            status: result.success ? "completed" : "failed",
            safetyScore: result.data?.summary?.safety_score || null,
            reportHtml: result.data?.reports?.html || null,
            reportJson: result.data?.reports?.json ? JSON.parse(result.data.reports.json) : null,
            reportMarkdown: result.data?.reports?.md || null,
            errorMessage: result.error || null,
            completedAt: new Date(),
          },
        });
      })
      .catch(async (error) => {
        await prisma.evaluation.update({
          where: { id: evaluation.id },
          data: {
            status: "failed",
            errorMessage: error.message,
            completedAt: new Date(),
          },
        });
      });

    return NextResponse.json({
      evaluationId: evaluation.id,
      status: "pending",
    });
  } catch (error: any) {
    console.error("Evaluation run API error:", error);
    return NextResponse.json(
      { 
        error: error.message || "Internal server error",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}

