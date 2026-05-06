import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import {
  apiKeyCanActAsRole,
  authenticateApiKeyFromRequest,
  hasRequiredScope,
} from "@/lib/api-keys";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SdkEventSchema = z.object({
  spec_version: z.literal("1.0"),
  event_type: z.enum([
    "run_started",
    "model_call",
    "tool_call",
    "tool_result",
    "policy_decision",
    "human_approval",
    "run_completed",
    "run_failed",
    "tool_call_started",
    "tool_call_completed",
    "tool_call_failed",
    "state_mutation",
  ]),
  run_id: z.string().uuid(),
  evaluation_id: z.string().nullable().optional(),
  timestamp: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "Invalid ISO8601 timestamp",
  }),
  payload: z.record(z.string(), z.unknown()),
});

function readScenarioId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const v = (payload as Record<string, unknown>).scenario_id;
  return typeof v === "string" ? v : null;
}

/**
 * Ingest thin SDK trace events (API key, evaluate:run).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
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
  if (!apiKeyCanActAsRole(apiKeyAuth.role ?? "evaluator", "evaluator")) {
    return NextResponse.json(
      {
        error: "Forbidden: evaluator role required",
        requiredRole: "evaluator",
        currentRole: apiKeyAuth.role,
      },
      { status: 403 }
    );
  }
  if (!hasRequiredScope(apiKeyAuth.scopes, "evaluate:run")) {
    return NextResponse.json(
      {
        error: "Forbidden: missing scope evaluate:run",
        requiredScope: "evaluate:run",
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = SdkEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid event", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const startedAt = new Date(data.timestamp);
  if (Number.isNaN(startedAt.getTime())) {
    return NextResponse.json(
      { error: "Invalid event", issues: [{ message: "Invalid timestamp" }] },
      { status: 400 }
    );
  }

  const scenarioId = readScenarioId(data.payload);
  const spanId = randomUUID();

  let evalRunId: string | null = null;
  try {
    const evalRun = await prisma.evalRun.findFirst({
      where: {
        traceId: data.run_id,
        evaluation: {
          project: { organizationId },
        },
      },
      select: { id: true },
    });
    evalRunId = evalRun?.id ?? null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to resolve trace", detail: message },
      { status: 500 }
    );
  }

  try {
    await prisma.evalSpan.create({
      data: {
        spanId,
        traceId: data.run_id,
        eventType: data.event_type,
        scenarioId,
        attempt: 1,
        startedAt,
        attributes: data.payload as unknown as Prisma.InputJsonValue,
        evalRunId,
        traceOrigin: "sdk",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to store event", detail: message },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { accepted: true, span_id: spanId },
    { status: 202 }
  );
}
