import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { evaluationQueue, hashConfig } from "@/lib/evaluation-queue";
import { validateHttpAgentUrl } from "@/lib/url-validator";
import { sanitizeConfigForStorage } from "@/lib/secret-redaction";
import { prisma } from "@/lib/db";
import { join } from "path";
import { existsSync } from "fs";
import { loadScenariosFromDirectory } from "@/lib/scenario-loader";
import {
  getReleaseMode,
  validateReleaseCandidateSelection,
} from "@/lib/release-gate";
import {
  buildReleasePolicyRef,
  resolvePolicyForConfig,
} from "@/lib/policy-registry";
import { resolveAppRole, hasRoleAtLeast } from "@/lib/rbac";
import {
  apiKeyCanActAsRole,
  authenticateApiKeyFromRequest,
  hasRequiredScope,
} from "@/lib/api-keys";
import { checkDailyEvaluationQuota, incrementDailyUsage } from "@/lib/usage-meter";
import { ensureOrganizationByClerkId } from "@/lib/org";
import {
  ensurePublicSelfServeOrganization,
  getPublicSelfServeDailyLimit,
  getPublicSelfServeMaxScenarios,
  isPublicSelfServeEnabled,
} from "@/lib/public-access";
import { isInlineEvaluationExecution } from "@/lib/evaluation-execution";
import {
  getCorpusForEvaluation,
  mergeScenariosWithCorpus,
} from "@/lib/regression-corpus";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MAX_SCENARIOS = 20;
const RELEASE_CANDIDATE_GUARDRAILS = {
  execution_timeout_seconds: 600,
  max_request_timeout_seconds: 30,
  max_retries: 2,
  max_concurrency: 3,
};

const EXPLORATORY_GUARDRAILS = {
  execution_timeout_seconds: 1200,
  max_request_timeout_seconds: 45,
  max_retries: 3,
  max_concurrency: 4,
};

const PUBLIC_SELF_SERVE_GUARDRAILS = {
  execution_timeout_seconds: 240,
  max_request_timeout_seconds: 20,
  max_retries: 1,
  max_concurrency: 1,
};

const SUPPORTED_HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH"]);

function toNumber(
  value: unknown,
  fallback: number,
  minValue: number,
  maxValue: number
): number {
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return Math.min(maxValue, Math.max(minValue, raw));
}

function normalizePath(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const selected = raw || fallback;
  if (!selected.startsWith("/")) {
    return `/${selected}`;
  }
  return selected;
}

function toOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(request: NextRequest) {
  try {
    const { userId, orgId } = getAuth();

    let userRole: "viewer" | "evaluator" | "release_manager" | "admin" = "viewer";
    let organizationId: string | null = null;
    let organizationClerkId: string | null = null;
    let authMode: "session" | "api_key" | "public_self_serve" = "session";
    let publicSelfServe = false;
    let publicDailyLimit: number | null = null;

    if (userId) {
      userRole = await resolveAppRole({ userId, orgId });
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

      if (!orgId) {
        return NextResponse.json(
          { error: "Organization context missing for authenticated user" },
          { status: 400 }
        );
      }

      const organization = await ensureOrganizationByClerkId({ clerkId: orgId });
      organizationId = organization.id;
      organizationClerkId = organization.clerkId;
    } else {
      const apiKeyAuth = await authenticateApiKeyFromRequest(request);
      if (apiKeyAuth) {
        authMode = "api_key";
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
              scopes: apiKeyAuth.scopes || [],
            },
            { status: 403 }
          );
        }

        userRole = apiKeyAuth.role || "viewer";
        organizationId = apiKeyAuth.organizationId || null;
        organizationClerkId = apiKeyAuth.orgClerkId || null;
      } else if (isPublicSelfServeEnabled()) {
        authMode = "public_self_serve";
        publicSelfServe = true;
        publicDailyLimit = getPublicSelfServeDailyLimit();
        const publicOrg = await ensurePublicSelfServeOrganization(request);
        userRole = "evaluator";
        organizationId = publicOrg.organization.id;
        organizationClerkId = publicOrg.organization.clerkId;
      } else {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    if (!organizationId) {
      return NextResponse.json(
        { error: "Organization context missing; cannot create evaluation" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const {
      agentType,
      agentConfig,
      selectedScenarios,
      projectId,
      evaluationName,
      releaseMode: requestedReleaseMode,
      releasePolicyId,
    } = body;
    const releaseMode = getReleaseMode({ release_mode: requestedReleaseMode });

    if (publicSelfServe && releaseMode !== "exploratory") {
      return NextResponse.json(
        {
          error:
            "Public self-serve only supports exploratory mode. Use API key or signed-in org for release_candidate.",
        },
        { status: 400 }
      );
    }

    if (releaseMode === "release_candidate" && !hasRoleAtLeast(userRole, "release_manager")) {
      return NextResponse.json(
        {
          error: "Forbidden: release_manager role required for release_candidate mode",
          requiredRole: "release_manager",
          currentRole: userRole,
        },
        { status: 403 }
      );
    }

    // Validate input
    if (!agentType || !agentConfig || !selectedScenarios || !Array.isArray(selectedScenarios)) {
      return NextResponse.json(
        { error: "Missing required fields: agentType, agentConfig, selectedScenarios" },
        { status: 400 }
      );
    }

    if (selectedScenarios.length === 0) {
      return NextResponse.json(
        { error: "At least one scenario must be selected" },
        { status: 400 }
      );
    }

    const uniqueSelectedScenarios = Array.from(new Set(selectedScenarios));
    if (uniqueSelectedScenarios.length !== selectedScenarios.length) {
      return NextResponse.json(
        { error: "Duplicate scenario IDs are not allowed" },
        { status: 400 }
      );
    }

    // Enforce scenario limit
    if (uniqueSelectedScenarios.length > MAX_SCENARIOS) {
      return NextResponse.json(
        { error: `Maximum ${MAX_SCENARIOS} scenarios allowed per evaluation` },
        { status: 400 }
      );
    }

    if (publicSelfServe) {
      if (agentType !== "http_agent") {
        return NextResponse.json(
          {
            error:
              "Public self-serve currently supports only http_agent evaluations.",
          },
          { status: 400 }
        );
      }
      const publicMaxScenarios = getPublicSelfServeMaxScenarios();
      if (uniqueSelectedScenarios.length > publicMaxScenarios) {
        return NextResponse.json(
          {
            error: `Public self-serve supports at most ${publicMaxScenarios} scenarios per evaluation`,
          },
          { status: 400 }
        );
      }
    }

    const httpAgentInput =
      agentConfig?.http_agent && typeof agentConfig.http_agent === "object"
        ? (agentConfig.http_agent as Record<string, unknown>)
        : null;
    const httpAgentRuntimeConfig =
      agentType === "http_agent"
        ? {
            base_url:
              toOptionalString(httpAgentInput?.base_url) ||
              toOptionalString(agentConfig?.http_agent_base_url),
            endpoint_path: normalizePath(httpAgentInput?.endpoint_path, "/agent"),
            health_path: normalizePath(httpAgentInput?.health_path, "/health"),
            method: String(httpAgentInput?.method || "POST").toUpperCase(),
            prompt_field: toOptionalString(httpAgentInput?.prompt_field) || "query",
            response_path: toOptionalString(httpAgentInput?.response_path) || "answer",
            auth_header: toOptionalString(httpAgentInput?.auth_header) || "Authorization",
            auth_token_env_var: toOptionalString(httpAgentInput?.auth_token_env_var),
            auth_scheme: toOptionalString(httpAgentInput?.auth_scheme) || "Bearer",
          }
        : null;

    if (
      httpAgentRuntimeConfig &&
      !SUPPORTED_HTTP_METHODS.has(httpAgentRuntimeConfig.method)
    ) {
      return NextResponse.json(
        {
          error: `Unsupported HTTP method '${httpAgentRuntimeConfig.method}'. Supported methods: GET, POST, PUT, PATCH`,
        },
        { status: 400 }
      );
    }

    // Validate HTTP agent URL if applicable
    if (agentType === "http_agent" && httpAgentRuntimeConfig?.base_url) {
      const urlValidation = validateHttpAgentUrl(httpAgentRuntimeConfig.base_url);
      if (!urlValidation.valid) {
        return NextResponse.json(
          { error: urlValidation.error },
          { status: 400 }
        );
      }
    }

    if (agentType === "http_agent" && !httpAgentRuntimeConfig?.base_url) {
      return NextResponse.json(
        { error: "HTTP agent base URL is required" },
        { status: 400 }
      );
    }

    if (publicSelfServe && httpAgentRuntimeConfig?.auth_token_env_var) {
      return NextResponse.json(
        {
          error:
            "Public self-serve does not allow server-side auth env vars. Use a public test endpoint or API-key mode.",
        },
        { status: 400 }
      );
    }

    if (httpAgentRuntimeConfig?.auth_token_env_var) {
      const envVar = httpAgentRuntimeConfig.auth_token_env_var;
      if (!process.env[envVar]) {
        return NextResponse.json(
          {
            error: `Auth token env var '${envVar}' is not configured on server`,
          },
          { status: 400 }
        );
      }
    }

    // Find scenarios directory
    const possiblePaths = [
      join(process.cwd(), "..", "scenario_definitions"),
      join(process.cwd(), "scenario_definitions"),
      join(process.cwd(), "..", "..", "scenario_definitions"),
    ];

    let scenariosDir = "";
    for (const path of possiblePaths) {
      if (existsSync(path)) {
        scenariosDir = path;
        break;
      }
    }

    if (!scenariosDir) {
      return NextResponse.json(
        { error: "scenario_definitions directory not found" },
        { status: 500 }
      );
    }

    const selectedPolicyConfig =
      typeof releasePolicyId === "string" && releasePolicyId.trim()
        ? { release_policy: { version_id: releasePolicyId.trim() } }
        : null;
    const policyResolution = resolvePolicyForConfig(selectedPolicyConfig);
    if (!policyResolution.policy) {
      return NextResponse.json(
        {
          error:
            policyResolution.error ||
            "Release policy unavailable; cannot create evaluation",
        },
        { status: selectedPolicyConfig ? 400 : 500 }
      );
    }
    const releasePolicyRef = buildReleasePolicyRef(selectedPolicyConfig);

    // Get or create project
    let project;
    if (projectId) {
      project = await prisma.project.findFirst({
        where: {
          id: projectId,
          organizationId,
        },
      });
      if (!project) {
        return NextResponse.json(
          { error: "Project not found for organization" },
          { status: 404 }
        );
      }
    }

    if (!project) {
      // Create default project if none exists
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
    }

    if (!project) {
      return NextResponse.json(
        { error: "Could not create or find project" },
        { status: 500 }
      );
    }

    let corpusScenarioIds: string[] = [];
    try {
      corpusScenarioIds = await getCorpusForEvaluation(project.id);
    } catch (error) {
      console.error("regression corpus lookup failed:", error);
    }

    const maxScenarioCap = publicSelfServe
      ? Math.min(MAX_SCENARIOS, getPublicSelfServeMaxScenarios())
      : MAX_SCENARIOS;

    const { allScenarioIds, corpusInjectedCount } = mergeScenariosWithCorpus(
      uniqueSelectedScenarios,
      corpusScenarioIds,
      maxScenarioCap
    );

    const corpusDroppedCount = corpusScenarioIds.filter(
      (id) => !allScenarioIds.includes(id)
    ).length;
    if (corpusDroppedCount > 0) {
      console.warn(
        `regression corpus: dropped ${corpusDroppedCount} scenario(s) due to max limit (${maxScenarioCap})`
      );
    }

    if (releaseMode === "release_candidate") {
      const scenarioCatalog = await loadScenariosFromDirectory(scenariosDir);
      const validation = validateReleaseCandidateSelection(
        allScenarioIds,
        scenarioCatalog.map((scenario) => ({
          id: scenario.id,
          tags: scenario.tags,
        })),
        policyResolution.policy
      );

      if (!validation.valid) {
        return NextResponse.json(
          {
            error:
              "Release candidate requirements not met. Expand selected scenarios to satisfy enterprise policy.",
            releaseMode,
            violations: validation.violations,
            observed: validation.observed,
            policy: {
              id: releasePolicyRef.version_id,
              name: policyResolution.policy.name,
              min_total_scenarios: policyResolution.policy.required.min_total_scenarios,
              required_tags: policyResolution.policy.required.required_tags,
              required_scenario_ids: policyResolution.policy.required.required_scenario_ids,
            },
          },
          { status: 400 }
        );
      }
    }

    // Sanitize config for storage (remove secrets)
    const guardrails = publicSelfServe
      ? PUBLIC_SELF_SERVE_GUARDRAILS
      : releaseMode === "release_candidate"
      ? RELEASE_CANDIDATE_GUARDRAILS
      : EXPLORATORY_GUARDRAILS;

    const runtimeConfig = publicSelfServe
      ? {
          max_concurrency: PUBLIC_SELF_SERVE_GUARDRAILS.max_concurrency,
          timeout_seconds: PUBLIC_SELF_SERVE_GUARDRAILS.max_request_timeout_seconds,
          max_retries: PUBLIC_SELF_SERVE_GUARDRAILS.max_retries,
          execution_timeout_seconds: PUBLIC_SELF_SERVE_GUARDRAILS.execution_timeout_seconds,
        }
      : {
          max_concurrency: Math.floor(
            toNumber(
              agentConfig.max_concurrency,
              guardrails.max_concurrency,
              1,
              guardrails.max_concurrency
            )
          ),
          timeout_seconds: toNumber(
            agentConfig.timeout_seconds,
            30.0,
            5.0,
            guardrails.max_request_timeout_seconds
          ),
          max_retries: Math.floor(
            toNumber(agentConfig.max_retries, 2, 1, guardrails.max_retries)
          ),
          execution_timeout_seconds: Math.floor(
            toNumber(
              agentConfig.execution_timeout_seconds,
              guardrails.execution_timeout_seconds,
              60,
              guardrails.execution_timeout_seconds
            )
          ),
        };

    const quotaResult = await checkDailyEvaluationQuota({
      organizationId,
      limitOverride: publicDailyLimit || undefined,
    });
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

    const sanitizedConfig = sanitizeConfigForStorage(agentConfig);
    (sanitizedConfig as any).provider = agentType;
    if (httpAgentRuntimeConfig) {
      (sanitizedConfig as any).http_agent = httpAgentRuntimeConfig;
    }
    (sanitizedConfig as any).release_mode = releaseMode;
    (sanitizedConfig as any).release_policy = releasePolicyRef;
    (sanitizedConfig as any).runtime_guardrails = runtimeConfig;
    (sanitizedConfig as any).auth_mode = authMode;
    (sanitizedConfig as any).org_clerk_id = organizationClerkId;
    if (publicSelfServe) {
      (sanitizedConfig as any).public_self_serve = true;
      (sanitizedConfig as any).public_daily_limit = publicDailyLimit;
    }
    const configHash = hashConfig({
      ...agentConfig,
      release_mode: releaseMode,
      release_policy: releasePolicyRef,
      ...runtimeConfig,
    });

    const inlineExecution = isInlineEvaluationExecution();

    // Determine initial status based on queue/execution mode
    const runningCount = evaluationQueue.getRunningCount();
    const initialStatus = inlineExecution
      ? "running"
      : runningCount >= 2
      ? "queued"
      : "running";

    // Create evaluation record
    const evaluation = await prisma.evaluation.create({
      data: {
        projectId: project.id,
        name: evaluationName || "Untitled Evaluation",
        status: initialStatus,
        scenarios: allScenarioIds,
        config: sanitizedConfig,
        configHash: configHash,
      },
    });

    await incrementDailyUsage({
      organizationId,
      evaluationsRequestedDelta: 1,
      scenariosRequestedDelta: allScenarioIds.length,
    });

    // Prepare evaluation config (with secrets for runtime, but not stored)
    const evaluationConfig = {
      provider: agentType,
      model: agentConfig.model || "gpt-4o-mini",
      temperature: agentConfig.temperature ?? 0.0,
      max_tokens: agentConfig.max_tokens || 512,
      max_concurrency: runtimeConfig.max_concurrency,
      timeout_seconds: runtimeConfig.timeout_seconds,
      max_retries: runtimeConfig.max_retries,
      execution_timeout_seconds: runtimeConfig.execution_timeout_seconds,
      release_mode: releaseMode,
      release_policy: releasePolicyRef,
      base_url: agentConfig.base_url || null,
      http_agent_base_url: httpAgentRuntimeConfig?.base_url || null,
      http_agent_config:
        agentType === "http_agent"
          ? {
              endpoint_path: httpAgentRuntimeConfig?.endpoint_path,
              health_path: httpAgentRuntimeConfig?.health_path,
              method: httpAgentRuntimeConfig?.method,
              prompt_field: httpAgentRuntimeConfig?.prompt_field,
              response_path: httpAgentRuntimeConfig?.response_path,
              auth_header: httpAgentRuntimeConfig?.auth_header,
              auth_token_env_var: httpAgentRuntimeConfig?.auth_token_env_var,
              auth_scheme: httpAgentRuntimeConfig?.auth_scheme,
            }
          : null,
    };

    if (inlineExecution) {
      await evaluationQueue.runImmediate({
        evaluationId: evaluation.id,
        config: evaluationConfig,
        scenarioIds: allScenarioIds,
        scenariosDir,
      });
      const latest = await prisma.evaluation.findUnique({
        where: { id: evaluation.id },
        select: { status: true, errorMessage: true, safetyScore: true },
      });

      return NextResponse.json({
        success: true,
        evaluationId: evaluation.id,
        status: latest?.status || initialStatus,
        releaseMode,
        releasePolicy: releasePolicyRef,
        quota: {
          usedAfterCreate: quotaResult.used + 1,
          limit: quotaResult.limit,
          remainingAfterCreate: Math.max(0, quotaResult.limit - (quotaResult.used + 1)),
        },
        authMode,
        publicSelfServe,
        inlineExecution: true,
        safetyScore: latest?.safetyScore ?? null,
        error: latest?.errorMessage ?? null,
        regression_scenarios_injected: corpusInjectedCount,
      });
    }

    // Enqueue evaluation (will start immediately if slot available)
    await evaluationQueue.enqueue({
      evaluationId: evaluation.id,
      config: evaluationConfig,
      scenarioIds: allScenarioIds,
      scenariosDir,
    });

    // Return immediately
    return NextResponse.json({
      success: true,
      evaluationId: evaluation.id,
      status: initialStatus,
      releaseMode,
      releasePolicy: releasePolicyRef,
      quota: {
        usedAfterCreate: quotaResult.used + 1,
        limit: quotaResult.limit,
        remainingAfterCreate: Math.max(0, quotaResult.limit - (quotaResult.used + 1)),
      },
      authMode,
      publicSelfServe,
      inlineExecution: false,
      regression_scenarios_injected: corpusInjectedCount,
    });
  } catch (error: any) {
    console.error("Evaluation API error:", error);
    return NextResponse.json(
      { 
        error: error.message || "Internal server error",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}
