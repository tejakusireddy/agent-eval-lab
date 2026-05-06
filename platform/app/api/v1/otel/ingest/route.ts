import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import {
  apiKeyCanActAsRole,
  authenticateApiKeyFromRequest,
  hasRequiredScope,
} from "@/lib/api-keys";
import { prisma } from "@/lib/db";
import {
  OtlpPayloadSchema,
  otelSpanToEvalSpanInsert,
  type OtelSpan,
} from "@/lib/otel-mapper";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type IngestResponse = {
  spec_version: "1.0";
  accepted: boolean;
  spans_accepted: number;
  spans_skipped: number;
  evaluation_id: string | null;
};

/**
 * POST /api/v1/otel/ingest — OTLP JSON ingest (API key, evaluate:run).
 *
 * Stores spans without running Python graders here.
 * TODO(Phase 2): call grader service on ingest or enqueue worker job;
 * graders are Python-only today — grading still runs on evaluation completion
 * via _write_trace_to_db.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const apiKeyAuth = await authenticateApiKeyFromRequest(request);
  if (!apiKeyAuth?.ok) {
    return NextResponse.json(
      { error: apiKeyAuth?.error || "Unauthorized: API key required" },
      { status: 401 }
    );
  }
  if (!apiKeyCanActAsRole(apiKeyAuth.role, "evaluator")) {
    return NextResponse.json(
      { error: "Forbidden: evaluator role required" },
      { status: 403 }
    );
  }
  if (!hasRequiredScope(apiKeyAuth.scopes, "evaluate:run")) {
    return NextResponse.json(
      { error: "Forbidden: missing scope evaluate:run" },
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = OtlpPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid OTLP payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const otelSpans: OtelSpan[] = [];
  for (const rs of parsed.data.resourceSpans) {
    for (const ss of rs.scopeSpans) {
      otelSpans.push(...ss.spans);
    }
  }

  const evaluationIdParam =
    request.nextUrl.searchParams.get("evaluation_id")?.trim() ?? null;

  let evalRunId: string | null = null;
  let resolvedEvaluationId: string | null = null;

  if (evaluationIdParam) {
    const evaluation = await prisma.evaluation.findFirst({
      where: {
        id: evaluationIdParam,
        project: { organizationId },
      },
    });
    if (!evaluation) {
      return NextResponse.json(
        { error: "Evaluation not found for organization" },
        { status: 404 }
      );
    }
    resolvedEvaluationId = evaluation.id;

    const firstTraceId =
      otelSpans.length > 0 ? otelSpans[0].traceId : crypto.randomUUID();

    let run = await prisma.evalRun.findFirst({
      where: { evaluationId: evaluation.id },
      orderBy: { startedAt: "desc" },
    });

    if (!run) {
      run = await prisma.evalRun.create({
        data: {
          evaluationId: evaluation.id,
          traceId: firstTraceId,
          provider: "otel_ingest",
          scenarioIds: [],
          status: "started",
        },
      });
    }
    evalRunId = run.id;
  }

  const inserts = otelSpans.map((span) =>
    otelSpanToEvalSpanInsert(span, resolvedEvaluationId, evalRunId)
  );

  const prismaRows = inserts.map((row) => ({
    spanId: row.spanId,
    parentSpanId: row.parentSpanId,
    traceId: row.traceId,
    eventType: row.eventType,
    scenarioId: row.scenarioId,
    attempt: row.attempt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    durationMs: row.durationMs,
    status: row.status,
    score: row.score,
    reasoning: row.reasoning,
    rawPrompt: row.rawPrompt,
    rawResponse: row.rawResponse,
    tags: row.tags as Prisma.InputJsonValue,
    failReasons: row.failReasons as Prisma.InputJsonValue,
    graderResults: Prisma.JsonNull,
    attributes: row.attributes as Prisma.InputJsonValue,
    evalRunId: row.evalRunId,
    traceOrigin: "otel",
  }));

  const total = prismaRows.length;
  let accepted = 0;
  if (total > 0) {
    const result = await prisma.evalSpan.createMany({
      data: prismaRows,
      skipDuplicates: true,
    });
    accepted = result.count;
  }

  const skipped = total - accepted;

  const responseBody: IngestResponse = {
    spec_version: "1.0",
    accepted: true,
    spans_accepted: accepted,
    spans_skipped: skipped,
    evaluation_id: resolvedEvaluationId,
  };

  return NextResponse.json(responseBody, { status: 202 });
}
