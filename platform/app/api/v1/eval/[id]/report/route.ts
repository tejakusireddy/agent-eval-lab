import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  apiKeyCanActAsRole,
  authenticateApiKeyFromRequest,
  hasRequiredScope,
} from "@/lib/api-keys";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ReportQuerySchema = z.object({
  format: z.enum(["json", "html", "markdown"]).optional().default("json"),
});

function isBlankHtmlOrMarkdown(value: string | null | undefined): boolean {
  return value == null || value.trim() === "";
}

/**
 * Download evaluation report (API key, evaluate:read).
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
  if (!apiKeyCanActAsRole(apiKeyAuth.role ?? "viewer", "viewer")) {
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

  const formatParam = request.nextUrl.searchParams.get("format");
  const trimmedFormat = formatParam?.trim();
  const queryParsed = ReportQuerySchema.safeParse({
    format:
      trimmedFormat === undefined || trimmedFormat === ""
        ? undefined
        : trimmedFormat,
  });
  if (!queryParsed.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: queryParsed.error.issues },
      { status: 400 }
    );
  }
  const format = queryParsed.data.format;

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
        reportHtml: true,
        reportJson: true,
        reportMarkdown: true,
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

  if (evaluation.status !== "completed") {
    return NextResponse.json(
      {
        error: "Report not available",
        status: evaluation.status,
      },
      { status: 404 }
    );
  }

  const commonHeaders = new Headers({
    "X-Spec-Version": "1.0",
    "X-Evaluation-Id": evaluation.id,
    "Cache-Control": "private, max-age=3600",
  });

  if (format === "json") {
    if (evaluation.reportJson == null) {
      return NextResponse.json(
        { error: "Report format not available" },
        { status: 404 }
      );
    }
    const body =
      typeof evaluation.reportJson === "string"
        ? evaluation.reportJson
        : JSON.stringify(evaluation.reportJson);
    commonHeaders.set("Content-Type", "application/json");
    return new NextResponse(body, { status: 200, headers: commonHeaders });
  }

  if (format === "html") {
    if (isBlankHtmlOrMarkdown(evaluation.reportHtml)) {
      return NextResponse.json(
        { error: "Report format not available" },
        { status: 404 }
      );
    }
    commonHeaders.set("Content-Type", "text/html");
    return new NextResponse(evaluation.reportHtml, {
      status: 200,
      headers: commonHeaders,
    });
  }

  if (isBlankHtmlOrMarkdown(evaluation.reportMarkdown)) {
    return NextResponse.json(
      { error: "Report format not available" },
      { status: 404 }
    );
  }
  commonHeaders.set("Content-Type", "text/markdown; charset=utf-8");
  return new NextResponse(evaluation.reportMarkdown, {
    status: 200,
    headers: commonHeaders,
  });
}
