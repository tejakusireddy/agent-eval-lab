import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getAuth } from "@/lib/auth";
import {
  apiKeyCanActAsRole,
  authenticateApiKeyFromRequest,
  hasRequiredScope,
} from "@/lib/api-keys";
import { prisma } from "@/lib/db";
import { ensureOrganizationByClerkId } from "@/lib/org";
import { hasRoleAtLeast, resolveAppRole } from "@/lib/rbac";
import { buildOtlpPayload, evalSpanToOtelSpan } from "@/lib/otel-mapper";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const QuerySchema = z
  .object({
    evaluation_id: z.string().min(1).optional(),
    trace_id: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(100),
  })
  .refine((q) => Boolean(q.evaluation_id || q.trace_id), {
    message: "Provide evaluation_id and/or trace_id",
  });

/**
 * GET /api/v1/otel/export — export EvalSpan rows as OTLP JSON.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  let organizationId: string | null = null;

  try {
    const { userId, orgId } = getAuth();

    if (userId) {
      const authRole = await resolveAppRole({ userId, orgId });
      if (!hasRoleAtLeast(authRole, "evaluator")) {
        return NextResponse.json(
          { error: "Forbidden: evaluator role required" },
          { status: 403 }
        );
      }
      if (!orgId) {
        return NextResponse.json(
          { error: "Organization context missing for authenticated user" },
          { status: 400 }
        );
      }
      const organization = await ensureOrganizationByClerkId({ clerkId: orgId });
      organizationId = organization.id;
    } else {
      const apiKeyAuth = await authenticateApiKeyFromRequest(request);
      if (!apiKeyAuth?.ok) {
        return NextResponse.json(
          { error: apiKeyAuth?.error || "Unauthorized" },
          { status: 401 }
        );
      }
      if (!apiKeyCanActAsRole(apiKeyAuth.role, "evaluator")) {
        return NextResponse.json(
          { error: "Forbidden: evaluator role required" },
          { status: 403 }
        );
      }
      if (!hasRequiredScope(apiKeyAuth.scopes, "evaluate:read")) {
        return NextResponse.json(
          { error: "Forbidden: missing scope evaluate:read" },
          { status: 403 }
        );
      }
      organizationId = apiKeyAuth.organizationId ?? null;
    }

    if (!organizationId) {
      return NextResponse.json(
        { error: "Organization context missing" },
        { status: 400 }
      );
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "auth error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const rawQuery = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = QuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { evaluation_id, trace_id, limit } = parsed.data;

  if (evaluation_id) {
    const evaluation = await prisma.evaluation.findFirst({
      where: {
        id: evaluation_id,
        project: { organizationId },
      },
    });
    if (!evaluation) {
      return NextResponse.json(
        { error: "Evaluation not found for organization" },
        { status: 404 }
      );
    }
  }

  const evalRunWhere =
    evaluation_id && trace_id
      ? {
          evaluationId: evaluation_id,
          evaluation: { project: { organizationId } },
        }
      : evaluation_id && !trace_id
        ? {
            evaluationId: evaluation_id,
            evaluation: { project: { organizationId } },
          }
        : {
            evaluation: { project: { organizationId } },
          };

  const rows = await prisma.evalSpan.findMany({
    where: {
      ...(trace_id ? { traceId: trace_id } : {}),
      evalRun: evalRunWhere,
    },
    take: limit,
    orderBy: { startedAt: "asc" },
  });

  const otelSpans = rows.map((r) =>
    evalSpanToOtelSpan({
      spanId: r.spanId,
      parentSpanId: r.parentSpanId,
      traceId: r.traceId,
      eventType: r.eventType,
      scenarioId: r.scenarioId,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      durationMs: r.durationMs,
      status: r.status,
      score: r.score,
      reasoning: r.reasoning,
      rawPrompt: r.rawPrompt,
      rawResponse: r.rawResponse,
      tags: r.tags,
      failReasons: r.failReasons,
      graderResults: r.graderResults,
      attributes: r.attributes,
    })
  );
  const payload = buildOtlpPayload(otelSpans);

  return NextResponse.json(payload, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-Spec-Version": "1.0",
      "X-Span-Count": String(otelSpans.length),
    },
  });
}
