import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redactSecrets } from "@/lib/secret-redaction";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { userId } = getAuth();
    if (!userId) {
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
      return NextResponse.json(
        { error: "Evaluation not found" },
        { status: 404 }
      );
    }

    // Redact any secrets from report JSON
    const reportJson = evaluation.reportJson
      ? redactSecrets(evaluation.reportJson)
      : null;

    // Return status and summary
    const response: any = {
      id: evaluation.id,
      name: evaluation.name,
      status: evaluation.status,
      createdAt: evaluation.createdAt,
      completedAt: evaluation.completedAt,
    };

    // Add summary if available
    if (reportJson && typeof reportJson === "object") {
      const summary = (reportJson as any).summary;
      if (summary) {
        response.summary = summary;
        response.safetyScore = evaluation.safetyScore;
      }
    }

    // Add results if completed
    if (evaluation.status === "completed" && reportJson) {
      response.results = reportJson;
    }

    // Add error if failed
    if (evaluation.status === "failed" && evaluation.errorMessage) {
      response.error = evaluation.errorMessage;
    }

    return NextResponse.json(response);
  } catch (error: any) {
    console.error("Evaluation GET API error:", error);
    return NextResponse.json(
      { 
        error: error.message || "Internal server error",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}
