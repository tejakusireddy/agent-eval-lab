import { existsSync } from "fs";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { getAuth } from "@/lib/auth";
import {
  apiKeyCanActAsRole,
  authenticateApiKeyFromRequest,
  hasRequiredScope,
} from "@/lib/api-keys";
import { evaluationQueue, hashConfig } from "@/lib/evaluation-queue";
import { prisma } from "@/lib/db";
import { ensureOrganizationByClerkId } from "@/lib/org";
import { hasRoleAtLeast, resolveAppRole } from "@/lib/rbac";
import { sanitizeConfigForStorage } from "@/lib/secret-redaction";
import { loadScenariosFromDirectory } from "@/lib/scenario-loader";
import {
  AblationRequestSchema,
  RunSpecOptionsSchema,
} from "@/lib/run-spec";
import type { EvaluationConfig } from "@/lib/run-eval";
import { checkDailyEvaluationQuota, incrementDailyUsage } from "@/lib/usage-meter";
import { validateHttpAgentUrl } from "@/lib/url-validator";

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
 * POST /api/v1/ablation — paired baseline + defended evaluations (API key or session).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let organizationId: string | null = null;
  let authRole: "viewer" | "evaluator" | "release_manager" | "admin" =
    "viewer";

  try {
    const { userId, orgId } = getAuth();

    if (userId) {
      authRole = await resolveAppRole({ userId, orgId });
      if (!hasRoleAtLeast(authRole, "evaluator")) {
        return NextResponse.json(
          {
            error: "Forbidden: evaluator role required",
            requiredRole: "evaluator",
            currentRole: authRole,
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
          { error: apiKeyAuth?.error || "Unauthorized: API key required" },
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
      organizationId = apiKeyAuth.organizationId ?? null;
      authRole = apiKeyAuth.role || "evaluator";
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = AblationRequestSchema.safeParse(body);
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
    !hasRoleAtLeast(authRole, "release_manager")
  ) {
    return NextResponse.json(
      {
        error:
          "Forbidden: release_manager role required for release_candidate mode",
        requiredRole: "release_manager",
        currentRole: authRole,
      },
      { status: 403 }
    );
  }

  try {
    const quotaResult = await checkDailyEvaluationQuota({ organizationId });
    if (!quotaResult.allowed || quotaResult.remaining < 2) {
      return NextResponse.json(
        {
          error:
            "Daily evaluation quota insufficient (ablation requires 2 evaluation slots)",
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "quota error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  let project;
  try {
    project = await prisma.project.findFirst({
      where: { organizationId },
    });
    if (!project) {
      project = await prisma.project.create({
        data: {
          organizationId,
          name: "Default Project",
        },
      });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Could not create or find project", detail: message },
      { status: 500 }
    );
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

  let scenarioCatalog;
  try {
    scenarioCatalog = await loadScenariosFromDirectory(scenariosDir);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "load error";
    return NextResponse.json(
      { error: "Failed to load scenarios", detail: message },
      { status: 500 }
    );
  }

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

  const optionsParsed = RunSpecOptionsSchema.parse(data.options ?? {});

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

  const metadataRecord = data.metadata;
  const label =
    metadataRecord &&
    typeof metadataRecord === "object" &&
    metadataRecord !== null &&
    "name" in metadataRecord &&
    typeof (metadataRecord as { name?: unknown }).name === "string"
      ? (metadataRecord as { name: string }).name
      : new Date().toISOString();

  function buildMappedConfig(defenseEnabled: boolean, defenseNames: string[]) {
    return {
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
      defense_config: {
        enabled: defenseEnabled,
        defenses: defenseNames,
      },
    };
  }

  const baselineDefense = { enabled: false, defenses: [] as string[] };
  const defendedDefense = { enabled: true, defenses: data.defenses };

  const baselineMapped = buildMappedConfig(
    baselineDefense.enabled,
    baselineDefense.defenses
  );
  const defendedMapped = buildMappedConfig(
    defendedDefense.enabled,
    defendedDefense.defenses
  );

  const sanitizedBaseline = sanitizeConfigForStorage(
    baselineMapped as Record<string, unknown>
  ) as Record<string, unknown>;
  sanitizedBaseline.provider = "http_agent";
  sanitizedBaseline.spec_version = "1.0";
  sanitizedBaseline.defense_config = baselineDefense;
  sanitizedBaseline.release_mode = releaseMode;
  sanitizedBaseline.release_policy = null;

  const sanitizedDefended = sanitizeConfigForStorage(
    defendedMapped as Record<string, unknown>
  ) as Record<string, unknown>;
  sanitizedDefended.provider = "http_agent";
  sanitizedDefended.spec_version = "1.0";
  sanitizedDefended.defense_config = defendedDefense;
  sanitizedDefended.release_mode = releaseMode;
  sanitizedDefended.release_policy = null;

  const configHashBaseline = hashConfig({
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
    defense_config: baselineDefense,
  });

  const configHashDefended = hashConfig({
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
    defense_config: defendedDefense,
  });

  let baselineEvalId: string;
  let defendedEvalId: string;
  let ablationId: string;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const baseline = await tx.evaluation.create({
        data: {
          projectId: project.id,
          name: `Ablation Baseline — ${label}`,
          status: "queued",
          scenarios: uniqueScenarios,
          config: sanitizedBaseline as unknown as Prisma.InputJsonValue,
          configHash: configHashBaseline,
        },
      });
      const defended = await tx.evaluation.create({
        data: {
          projectId: project.id,
          name: `Ablation Defended — ${label}`,
          status: "queued",
          scenarios: uniqueScenarios,
          config: sanitizedDefended as unknown as Prisma.InputJsonValue,
          configHash: configHashDefended,
        },
      });
      const ablation = await tx.ablationRun.create({
        data: {
          projectId: project.id,
          baselineEvaluationId: baseline.id,
          defendedEvaluationId: defended.id,
          status: "running",
          defenses: data.defenses as unknown as Prisma.InputJsonValue,
        },
      });
      return { baseline, defended, ablation };
    });
    baselineEvalId = result.baseline.id;
    defendedEvalId = result.defended.id;
    ablationId = result.ablation.id;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to create ablation run", detail: message },
      { status: 500 }
    );
  }

  try {
    await incrementDailyUsage({
      organizationId,
      evaluationsRequestedDelta: 2,
      scenariosRequestedDelta: uniqueScenarios.length * 2,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to update usage", detail: message },
      { status: 500 }
    );
  }

  const baselineRuntimeConfig: EvaluationConfig = {
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
    defense_config: { enabled: false, defenses: [] },
  };

  const defendedRuntimeConfig: EvaluationConfig = {
    ...baselineRuntimeConfig,
    defense_config: { enabled: true, defenses: data.defenses },
  };

  try {
    await evaluationQueue.enqueue({
      evaluationId: baselineEvalId,
      config: baselineRuntimeConfig,
      scenarioIds: uniqueScenarios,
      scenariosDir,
    });
    await evaluationQueue.enqueue({
      evaluationId: defendedEvalId,
      config: defendedRuntimeConfig,
      scenarioIds: uniqueScenarios,
      scenariosDir,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to enqueue evaluations", detail: message },
      { status: 500 }
    );
  }

  const base = getRequestBaseUrl(request);
  const submittedAt = new Date().toISOString();

  return NextResponse.json({
    spec_version: "1.0",
    ablation_run_id: ablationId,
    baseline_evaluation_id: baselineEvalId,
    defended_evaluation_id: defendedEvalId,
    status: "running",
    poll_url: `${base}/api/v1/ablation/${ablationId}`,
    defense_count: data.defenses.length,
    scenario_count: uniqueScenarios.length,
    submitted_at: submittedAt,
  });
}
