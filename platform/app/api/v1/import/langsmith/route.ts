import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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
import { checkDailyEvaluationQuota, incrementDailyUsage } from "@/lib/usage-meter";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const BRIDGE_TIMEOUT_MS = 10_000;

const BodySchema = z.object({
  langsmith_api_key: z.string().min(1),
  project_name: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  evaluation_id: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
});

function getRequestBaseUrl(request: NextRequest): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (envUrl) {
    return envUrl;
  }
  const proto = request.headers.get("x-forwarded-proto") || "http";
  const host = request.headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

type LangSmithImportAcceptedResponse = {
  spec_version: "1.0";
  evaluation_id: string;
  status: "running";
  poll_url: string;
  project_name: string;
  submitted_at: string;
};

/**
 * POST /api/v1/import/langsmith — enqueue LangSmith trace import (session or API key).
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse> {
  let organizationId: string | null = null;

  try {
    const { userId, orgId } = getAuth();

    if (userId) {
      const authRole = await resolveAppRole({ userId, orgId });
      if (!hasRoleAtLeast(authRole, "evaluator")) {
        return NextResponse.json(
          {
            error: "Forbidden: evaluator role required",
          },
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
          { error: apiKeyAuth?.error || "Unauthorized: API key or session required" },
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

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const body = parsed.data;

  try {
    const quotaResult = await checkDailyEvaluationQuota({ organizationId });
    if (!quotaResult.allowed) {
      return NextResponse.json(
        {
          error: "Daily evaluation quota exceeded for organization",
        },
        { status: 429 }
      );
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "quota error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  let project = await prisma.project.findFirst({
    where: { organizationId },
  });
  if (!project) {
    try {
      project = await prisma.project.create({
        data: {
          organizationId,
          name: "Default Project",
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return NextResponse.json(
        { error: "Could not create or find project", detail: message },
        { status: 500 }
      );
    }
  }

  if (!project) {
    return NextResponse.json(
      { error: "Could not create or find project" },
      { status: 500 }
    );
  }

  const baseConfig: Record<string, unknown> = {
    provider: "langsmith_import",
    spec_version: "1.0",
    project_name: body.project_name,
  };
  if (body.metadata && typeof body.metadata === "object") {
    Object.assign(baseConfig, { import_metadata: body.metadata });
  }

  let evaluationId: string;

  if (body.evaluation_id) {
    const existing = await prisma.evaluation.findFirst({
      where: {
        id: body.evaluation_id,
        project: { organizationId },
      },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Evaluation not found or not in this organization" },
        { status: 404 }
      );
    }
    try {
      await prisma.evaluation.update({
        where: { id: existing.id },
        data: {
          status: "running",
          config: baseConfig as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "update failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }
    evaluationId = existing.id;
  } else {
    let created;
    try {
      created = await prisma.evaluation.create({
        data: {
          projectId: project.id,
          name: `LangSmith Import — ${body.project_name}`,
          status: "running",
          scenarios: [],
          config: baseConfig as unknown as Prisma.InputJsonValue,
          configHash: null,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return NextResponse.json(
        { error: "Failed to create evaluation", detail: message },
        { status: 500 }
      );
    }
    evaluationId = created.id;
  }

  try {
    await incrementDailyUsage({
      organizationId,
      evaluationsRequestedDelta: 1,
      scenariosRequestedDelta: 0,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to update usage", detail: message },
      { status: 500 }
    );
  }

  const bridgeBase =
    process.env.WORKER_BRIDGE_URL?.replace(/\/$/, "") ?? "http://localhost:8001";
  const bridgeSecret = process.env.BRIDGE_SECRET ?? "";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  try {
    const res = await fetch(`${bridgeBase}/import/langsmith`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bridge-Secret": bridgeSecret,
      },
      body: JSON.stringify({
        evaluation_id: evaluationId,
        langsmith_api_key: body.langsmith_api_key,
        project_name: body.project_name,
        limit: body.limit,
      }),
      signal: controller.signal,
    });

    const bridgePayload = (await res.json().catch(() => null)) as {
      accepted?: boolean;
      task_id?: string;
      detail?: string;
    } | null;

    if (!res.ok || !bridgePayload?.accepted || !bridgePayload.task_id) {
      const detail =
        bridgePayload?.detail ?? "Worker bridge rejected LangSmith import";
      await prisma.evaluation.update({
        where: { id: evaluationId },
        data: {
          status: "failed",
          errorMessage: detail,
        },
      });
      return NextResponse.json({ error: detail }, { status: res.status >= 400 ? res.status : 502 });
    }
  } catch {
    await prisma.evaluation.update({
      where: { id: evaluationId },
      data: {
        status: "failed",
        errorMessage: "Failed to reach worker bridge for LangSmith import",
      },
    });
    return NextResponse.json(
      { error: "Failed to reach worker bridge for LangSmith import" },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }

  const base = getRequestBaseUrl(request);
  const responseBody: LangSmithImportAcceptedResponse = {
    spec_version: "1.0",
    evaluation_id: evaluationId,
    status: "running",
    poll_url: `${base}/api/v1/eval/${evaluationId}`,
    project_name: body.project_name,
    submitted_at: new Date().toISOString(),
  };

  return NextResponse.json(responseBody);
}
