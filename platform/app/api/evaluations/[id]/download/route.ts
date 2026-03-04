import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeReportJson } from "@/app/_utils/report-json";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { userId, orgId } = getAuth();
    if (!userId || !orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resolvedParams = await Promise.resolve(params);
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") || "json";

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

    if (evaluation.project.organization.clerkId !== orgId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let content: string;
    let contentType: string;
    let filename: string;

    if (format === "json") {
      content = JSON.stringify(normalizeReportJson(evaluation.reportJson), null, 2);
      contentType = "application/json";
      filename = `evaluation-${evaluation.id}.json`;
    } else if (format === "markdown") {
      content = evaluation.reportMarkdown || "";
      contentType = "text/markdown";
      filename = `evaluation-${evaluation.id}.md`;
    } else {
      return NextResponse.json(
        { error: "Invalid format" },
        { status: 400 }
      );
    }

    return new NextResponse(content, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    console.error("Download API error:", error);
    return NextResponse.json(
      { 
        error: error.message || "Internal server error",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}
