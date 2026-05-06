import { existsSync } from "fs";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import {
  apiKeyCanActAsRole,
  authenticateApiKeyFromRequest,
  hasRequiredScope,
} from "@/lib/api-keys";
import { evaluationQueue, hashConfig } from "@/lib/evaluation-queue";
import { prisma } from "@/lib/db";
import { checkDailyEvaluationQuota, incrementDailyUsage } from "@/lib/usage-meter";
import { sanitizeConfigForStorage } from "@/lib/secret-redaction";
import { loadScenariosFromDirectory } from "@/lib/scenario-loader";
import type { EvaluationConfig } from "@/lib/run-eval";
import {
  RunSpecOptionsSchema,
  RunSpecSchema,
  type RunSpecResponse,
} from "@/lib/run-spec";
import { validateHttpAgentUrl } from "@/lib/url-validator";
import { hasRoleAtLeast } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SUPPORTED_HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH"]);

function normalizePath(value: string, fallback: string): string {
  const raw = value.trim();
  const selected = raw || fallback;
  if (!selected.startsWith("/")) {
    return `/${selected}`;
  }
  return selected;
}

function resolveScenariosDirectory(): string | null {
  const possiblePaths = [
    join(process.cwd(), "..", "scenario_definitions"),
    join(process.cwd(), "scenario_definitions"),
    join(process.cwd(), "..", "..", "scenario_definitions"),
  ];
  for (const p of possiblePaths) {
    if (existsSync(p)) {
      return p;
    }
  }
  return null;
}

function getRequestBaseUrl(request: NextRequest): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (envUrl) {
    return envUrl;
  }
  const proto = request.headers.get("x-forwarded-proto") || "http";
  const host = request.headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

/**
 * Public black-box evaluation submission (API key, Run Spec v1.0).
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
  if (!apiKeyCanActAsRole(apiKeyAuth.role, "evaluator")) {
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

  const parsed = RunSpecSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const releaseMode = data.release_mode;

  if (
    releaseMode === "release_candidate" &&
    !hasRoleAtLeast(apiKeyAuth.role ?? "evaluator", "release_manager")
  ) {
    return NextResponse.json(
      {
        error:
          "Forbidden: release_manager role required for release_candidate mode",
        requiredRole: "release_manager",
        currentRole: apiKeyAuth.role,
      },
      { status: 403 }
    );
  }

  const optionsParsed = RunSpecOptionsSchema.parse(data.options ?? {});

  const quotaResult = await checkDailyEvaluationQuota({ organizationId });
  if (!quotaResult.allowed) {
    return NextResponse.json(
      {
        error: "Daily evaluation quota exceeded for organization",
        quota: {
          used: quotaResult.used,
          limit: quotaResult.limit,
          remaining: quotaResult.remaining,
          usageDate: quotaResult.usageDate.toISOString().slice(0, 10),
        },
      },
      { status: 429 }
    );
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

  const scenariosDir = resolveScenariosDirectory();
  if (!scenariosDir) {
    return NextResponse.json(
      { error: "scenario_definitions directory not found" },
      { status: 500 }
    );
  }

  const scenarioCatalog = await loadScenariosFromDirectory(scenariosDir);
  const knownIds = new Set(scenarioCatalog.map((s) => s.id));
  const uniqueScenarios = Array.from(new Set(data.scenarios));
  const unknown = uniqueScenarios.filter((id) => !knownIds.has(id));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: "Unknown scenario IDs", unknown },
      { status: 400 }
    );
  }

  const agent = data.agent;
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(agent.endpoint_url);
  } catch {
    return NextResponse.json(
      { error: "Invalid agent.endpoint_url" },
      { status: 400 }
    );
  }

  const baseUrlOrigin = endpointUrl.origin;
  const urlValidation = validateHttpAgentUrl(baseUrlOrigin);
  if (!urlValidation.valid) {
    return NextResponse.json({ error: urlValidation.error }, { status: 400 });
  }

  const pathnameRaw = endpointUrl.pathname;
  const endpointPath = normalizePath(
    pathnameRaw === "" ? "/agent" : pathnameRaw,
    "/agent"
  );
  const method = agent.method.toUpperCase();
  if (!SUPPORTED_HTTP_METHODS.has(method)) {
    return NextResponse.json(
      {
        error: `Unsupported HTTP method '${method}'. Supported: GET, POST, PUT, PATCH`,
      },
      { status: 400 }
    );
  }

  const auth = agent.auth ?? {
    header: "Authorization",
    scheme: "Bearer" as const,
    token_env_var: undefined,
  };
  const authHeader = auth.header ?? "Authorization";
  const authScheme = auth.scheme ?? "Bearer";
  const authTokenEnvVar =
    auth.token_env_var === undefined || auth.token_env_var === null
      ? null
      : auth.token_env_var;

  if (authTokenEnvVar) {
    if (!process.env[authTokenEnvVar]) {
      return NextResponse.json(
        {
          error: `Auth token env var '${authTokenEnvVar}' is not configured on server`,
        },
        { status: 400 }
      );
    }
  }

  const httpAgentConfig: Record<string, unknown> = {
    endpoint_path: endpointPath,
    method,
    prompt_field: agent.prompt_field,
    response_path: agent.response_path,
    health_path: agent.health_path ?? null,
    auth_header: authHeader,
    auth_token_env_var: authTokenEnvVar,
    auth_scheme: authScheme,
  };

  const defenseConfig = data.defense_config ?? null;

  const metadataRecord = data.metadata;
  const evaluationName =
    metadataRecord &&
    typeof metadataRecord === "object" &&
    metadataRecord !== null &&
    "name" in metadataRecord &&
    typeof (metadataRecord as { name?: unknown }).name === "string"
      ? (metadataRecord as { name: string }).name
      : "API Evaluation";

  const mappedConfig: EvaluationConfig & {
    spec_version: string;
    defense_config?: { enabled: boolean; defenses: string[] } | null;
  } = {
    provider: "http_agent",
    http_agent_base_url: baseUrlOrigin,
    http_agent_config: httpAgentConfig,
    model: optionsParsed.model ?? undefined,
    temperature: optionsParsed.temperature,
    max_tokens: optionsParsed.max_tokens,
    max_concurrency: optionsParsed.max_concurrency,
    timeout_seconds: optionsParsed.timeout_seconds,
    max_retries: optionsParsed.max_retries,
    execution_timeout_seconds: optionsParsed.execution_timeout_seconds,
    release_mode: releaseMode,
    release_policy: null,
    spec_version: "1.0",
    defense_config: defenseConfig ?? undefined,
    tool_env_url: optionsParsed.tool_env_url ?? undefined,
    max_steps: optionsParsed.max_steps,
  };

  const sanitizedConfig = sanitizeConfigForStorage(mappedConfig) as Record<
    string,
    unknown
  >;
  sanitizedConfig.provider = "http_agent";
  sanitizedConfig.spec_version = "1.0";
  if (defenseConfig) {
    sanitizedConfig.defense_config = defenseConfig;
  }
  sanitizedConfig.release_mode = releaseMode;
  sanitizedConfig.release_policy = null;

  const configHash = hashConfig({
    provider: "http_agent",
    model: optionsParsed.model ?? undefined,
    temperature: optionsParsed.temperature,
    max_tokens: optionsParsed.max_tokens,
    max_concurrency: optionsParsed.max_concurrency,
    timeout_seconds: optionsParsed.timeout_seconds,
    max_retries: optionsParsed.max_retries,
    execution_timeout_seconds: optionsParsed.execution_timeout_seconds,
    base_url: null,
    http_agent_base_url: baseUrlOrigin,
    http_agent_config: httpAgentConfig,
    release_mode: releaseMode,
    release_policy: null,
    spec_version: "1.0",
    defense_config: defenseConfig ?? undefined,
    tool_env_url: optionsParsed.tool_env_url ?? undefined,
    max_steps: optionsParsed.max_steps,
  });

  let evaluation;
  try {
    evaluation = await prisma.evaluation.create({
      data: {
        projectId: project.id,
        name: evaluationName,
        status: "queued",
        scenarios: uniqueScenarios,
        config: sanitizedConfig as unknown as Prisma.InputJsonValue,
        configHash,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to create evaluation", detail: message },
      { status: 500 }
    );
  }

  try {
    await incrementDailyUsage({
      organizationId,
      evaluationsRequestedDelta: 1,
      scenariosRequestedDelta: uniqueScenarios.length,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to update usage", detail: message },
      { status: 500 }
    );
  }

  const evaluationConfig: EvaluationConfig = {
    provider: "http_agent",
    model: optionsParsed.model ?? "gpt-4o-mini",
    temperature: optionsParsed.temperature,
    max_tokens: optionsParsed.max_tokens,
    max_concurrency: optionsParsed.max_concurrency,
    timeout_seconds: optionsParsed.timeout_seconds,
    max_retries: optionsParsed.max_retries,
    execution_timeout_seconds: optionsParsed.execution_timeout_seconds,
    release_mode: releaseMode,
    release_policy: null,
    http_agent_base_url: baseUrlOrigin,
    http_agent_config: httpAgentConfig,
    defense_config: defenseConfig ?? null,
    tool_env_url: optionsParsed.tool_env_url ?? null,
    max_steps: optionsParsed.max_steps,
  };

  try {
    await evaluationQueue.enqueue({
      evaluationId: evaluation.id,
      config: evaluationConfig,
      scenarioIds: uniqueScenarios,
      scenariosDir,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to enqueue evaluation", detail: message },
      { status: 500 }
    );
  }

  const base = getRequestBaseUrl(request);
  const pollUrl = `${base}/api/v1/eval/${evaluation.id}`;

  const responseBody: RunSpecResponse = {
    spec_version: "1.0",
    evaluation_id: evaluation.id,
    status: "queued",
    poll_url: pollUrl,
    webhook_registered: false,
    release_mode: releaseMode,
    submitted_at: new Date().toISOString(),
    scenario_count: uniqueScenarios.length,
  };

  return NextResponse.json(responseBody);
}
