import { NextRequest, NextResponse } from "next/server";

import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { evaluationQueue, hashConfig } from "@/lib/evaluation-queue";
import { isInlineEvaluationExecution } from "@/lib/evaluation-execution";
import { validateHttpAgentUrl } from "@/lib/url-validator";
import { existsSync } from "fs";
import { join } from "path";
import { hasRoleAtLeast, resolveAppRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const SUPPORTED_HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH"]);

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { userId, orgId } = getAuth();
    if (!userId || !orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = await resolveAppRole({ userId, orgId });
    if (!hasRoleAtLeast(userRole, "evaluator")) {
      return NextResponse.json(
        {
          error: "Forbidden: evaluator role required",
          requiredRole: "evaluator",
          currentRole: userRole,
        },
        { status: 403 }
      );
    }

    const resolvedParams = await Promise.resolve(params);
    const existing = await prisma.evaluation.findUnique({
      where: { id: resolvedParams.id },
      include: {
        project: {
          include: {
            organization: true,
          },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Evaluation not found" }, { status: 404 });
    }

    if (existing.project.organization.clerkId !== orgId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (["queued", "running", "pending"].includes(existing.status)) {
      return NextResponse.json(
        { error: "Cannot retry an evaluation that is still in progress" },
        { status: 409 }
      );
    }

    const config =
      existing.config && typeof existing.config === "object"
        ? (existing.config as Record<string, any>)
        : null;
    const scenarios = toStringArray(existing.scenarios);

    if (!config || scenarios.length === 0) {
      return NextResponse.json(
        { error: "Evaluation is missing configuration or scenarios" },
        { status: 400 }
      );
    }

    const agentType =
      config.provider === "http_agent" || config.http_agent
        ? "http_agent"
        : "openai";

    const runtimeConfig =
      config.runtime_guardrails && typeof config.runtime_guardrails === "object"
        ? config.runtime_guardrails
        : {};
    const httpAgentConfig =
      config.http_agent && typeof config.http_agent === "object"
        ? (config.http_agent as Record<string, any>)
        : null;

    const evaluationConfig = {
      provider: agentType,
      release_mode: config.release_mode || "exploratory",
      model: config.model || "gpt-4o-mini",
      temperature: typeof config.temperature === "number" ? config.temperature : 0.0,
      max_tokens: typeof config.max_tokens === "number" ? config.max_tokens : 512,
      max_concurrency:
        typeof runtimeConfig.max_concurrency === "number"
          ? runtimeConfig.max_concurrency
          : 3,
      timeout_seconds:
        typeof runtimeConfig.timeout_seconds === "number"
          ? runtimeConfig.timeout_seconds
          : 30,
      max_retries:
        typeof runtimeConfig.max_retries === "number" ? runtimeConfig.max_retries : 3,
      execution_timeout_seconds:
        typeof runtimeConfig.execution_timeout_seconds === "number"
          ? runtimeConfig.execution_timeout_seconds
          : 600,
      release_policy:
        config.release_policy && typeof config.release_policy === "object"
          ? config.release_policy
          : null,
      base_url: config.base_url || null,
      http_agent_base_url:
        httpAgentConfig?.base_url || config.http_agent_base_url || null,
      http_agent_config: httpAgentConfig
        ? {
            endpoint_path: httpAgentConfig.endpoint_path || "/agent",
            health_path: httpAgentConfig.health_path || "/health",
            method: httpAgentConfig.method || "POST",
            prompt_field: httpAgentConfig.prompt_field || "query",
            response_path: httpAgentConfig.response_path || "answer",
            auth_header: httpAgentConfig.auth_header || "Authorization",
            auth_token_env_var: httpAgentConfig.auth_token_env_var || null,
            auth_scheme: httpAgentConfig.auth_scheme || "Bearer",
          }
        : null,
    };

    if (
      evaluationConfig.provider === "http_agent" &&
      evaluationConfig.http_agent_base_url
    ) {
      const urlValidation = validateHttpAgentUrl(evaluationConfig.http_agent_base_url);
      if (!urlValidation.valid) {
        return NextResponse.json(
          { error: `Cannot retry with invalid HTTP agent URL: ${urlValidation.error}` },
          { status: 400 }
        );
      }
    }

    if (evaluationConfig.http_agent_config?.method) {
      const method = String(evaluationConfig.http_agent_config.method).toUpperCase();
      if (!SUPPORTED_HTTP_METHODS.has(method)) {
        return NextResponse.json(
          { error: `Cannot retry with unsupported HTTP method: ${method}` },
          { status: 400 }
        );
      }
    }

    if (evaluationConfig.http_agent_config?.auth_token_env_var) {
      const envVar = String(evaluationConfig.http_agent_config.auth_token_env_var);
      if (!process.env[envVar]) {
        return NextResponse.json(
          { error: `Cannot retry: auth token env var '${envVar}' is not configured on server` },
          { status: 400 }
        );
      }
    }

    const inlineExecution = isInlineEvaluationExecution();
    const runningCount = evaluationQueue.getRunningCount();
    const initialStatus = inlineExecution
      ? "running"
      : runningCount >= 2
      ? "queued"
      : "running";
    const possibleScenarioPaths = [
      join(process.cwd(), "..", "scenario_definitions"),
      join(process.cwd(), "scenario_definitions"),
      join(process.cwd(), "..", "..", "scenario_definitions"),
    ];
    const scenariosDir =
      possibleScenarioPaths.find((candidate) => existsSync(candidate)) || "";

    if (!scenariosDir) {
      return NextResponse.json(
        { error: "scenario_definitions directory not found" },
        { status: 500 }
      );
    }

    const retryEval = await prisma.evaluation.create({
      data: {
        projectId: existing.projectId,
        name: `${existing.name || "Evaluation"} (Retry ${new Date().toLocaleTimeString()})`,
        status: initialStatus,
        scenarios,
        config,
        configHash: hashConfig({
          ...config,
          provider: agentType,
          release_policy:
            config.release_policy && typeof config.release_policy === "object"
              ? config.release_policy
              : null,
          http_agent: config.http_agent || undefined,
          http_agent_config: evaluationConfig.http_agent_config || undefined,
        }),
      },
    });

    if (inlineExecution) {
      await evaluationQueue.runImmediate({
        evaluationId: retryEval.id,
        config: evaluationConfig,
        scenarioIds: scenarios,
        scenariosDir,
      });
    } else {
      await evaluationQueue.enqueue({
        evaluationId: retryEval.id,
        config: evaluationConfig,
        scenarioIds: scenarios,
        scenariosDir,
      });
    }

    const redirectUrl = new URL(`/dashboard/evaluations/${retryEval.id}`, request.url);
    return NextResponse.redirect(redirectUrl, { status: 303 });
  } catch (error: any) {
    console.error("Retry API error:", error);
    return NextResponse.json(
      {
        error: error.message || "Internal server error",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
