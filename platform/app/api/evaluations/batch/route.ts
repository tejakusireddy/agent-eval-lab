import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { existsSync } from "fs";
import crypto from "crypto";

import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { evaluationQueue, hashConfig } from "@/lib/evaluation-queue";
import { validateHttpAgentUrl } from "@/lib/url-validator";
import { sanitizeConfigForStorage } from "@/lib/secret-redaction";
import { loadScenariosFromDirectory } from "@/lib/scenario-loader";
import {
  buildReleasePolicyRef,
  resolvePolicyForConfig,
} from "@/lib/policy-registry";
import {
  getReleaseMode,
  validateReleaseCandidateSelection,
} from "@/lib/release-gate";
import { hasRoleAtLeast, resolveAppRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_SCENARIOS = 20;
const MAX_BATCH_AGENTS = 20;
const SUPPORTED_HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH"]);

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

type AgentType = "openai" | "http_agent";
type ReleaseMode = "exploratory" | "release_candidate";

interface BatchAgentInput {
  name?: string;
  agentType: AgentType;
  agentConfig: Record<string, unknown>;
}

interface BatchSummaryItem {
  batchId: string;
  createdAt: string;
  updatedAt: string;
  totalEvaluations: number;
  statusCounts: Record<string, number>;
  averageSafetyScore: number | null;
  releaseMode: ReleaseMode;
  project: { id: string; name: string };
  agentNames: string[];
}

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

function createBatchId(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = crypto.randomBytes(4).toString("hex");
  return `batch-${timestamp}-${suffix}`;
}

function readBatchConfig(config: unknown): {
  batchId: string;
  index: number | null;
  total: number | null;
  agentName: string;
} | null {
  if (!config || typeof config !== "object") {
    return null;
  }
  const batch = (config as Record<string, unknown>).batch;
  if (!batch || typeof batch !== "object") {
    return null;
  }
  const record = batch as Record<string, unknown>;
  const batchId = typeof record.batch_id === "string" ? record.batch_id : "";
  if (!batchId) {
    return null;
  }
  return {
    batchId,
    index: typeof record.index === "number" ? record.index : null,
    total: typeof record.total === "number" ? record.total : null,
    agentName:
      typeof record.agent_name === "string" && record.agent_name.trim()
        ? record.agent_name
        : "Unknown Agent",
  };
}

async function resolveProject(orgId: string | null, projectId?: string) {
  let project = null as any;

  if (projectId) {
    project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { organization: true },
    });
  }

  if (!project && orgId) {
    let organization = await prisma.organization.findUnique({
      where: { clerkId: orgId },
    });

    if (!organization) {
      organization = await prisma.organization.create({
        data: {
          clerkId: orgId,
          name: "Default Organization",
        },
      });
    }

    project = await prisma.project.findFirst({
      where: { organizationId: organization.id },
      include: { organization: true },
    });

    if (!project) {
      project = await prisma.project.create({
        data: {
          organizationId: organization.id,
          name: "Default Project",
        },
        include: { organization: true },
      });
    }
  }

  return project;
}

export async function GET() {
  try {
    const { userId, orgId } = getAuth();
    if (!userId || !orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = await resolveAppRole({ userId, orgId });
    if (!hasRoleAtLeast(userRole, "viewer")) {
      return NextResponse.json(
        {
          error: "Forbidden: viewer role required",
          requiredRole: "viewer",
          currentRole: userRole,
        },
        { status: 403 }
      );
    }

    const evaluations = await prisma.evaluation.findMany({
      where: {
        project: {
          organization: {
            clerkId: orgId,
          },
        },
      },
      include: {
        project: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });

    const grouped = new Map<
      string,
      {
        createdAt: Date;
        updatedAt: Date;
        total: number;
        safetyScoreCount: number;
        safetyScoreSum: number;
        statusCounts: Record<string, number>;
        releaseMode: ReleaseMode;
        project: { id: string; name: string };
        agentNames: Set<string>;
      }
    >();

    for (const evaluation of evaluations) {
      const batch = readBatchConfig(evaluation.config);
      if (!batch) {
        continue;
      }

      const existing = grouped.get(batch.batchId);
      if (!existing) {
        grouped.set(batch.batchId, {
          createdAt: evaluation.createdAt,
          updatedAt: evaluation.createdAt,
          total: 1,
          safetyScoreCount: typeof evaluation.safetyScore === "number" ? 1 : 0,
          safetyScoreSum: typeof evaluation.safetyScore === "number" ? evaluation.safetyScore : 0,
          statusCounts: { [evaluation.status]: 1 },
          releaseMode: getReleaseMode(evaluation.config),
          project: evaluation.project,
          agentNames: new Set([batch.agentName]),
        });
      } else {
        existing.createdAt =
          evaluation.createdAt < existing.createdAt ? evaluation.createdAt : existing.createdAt;
        existing.updatedAt =
          evaluation.createdAt > existing.updatedAt ? evaluation.createdAt : existing.updatedAt;
        existing.total += 1;
        if (typeof evaluation.safetyScore === "number") {
          existing.safetyScoreCount += 1;
          existing.safetyScoreSum += evaluation.safetyScore;
        }
        existing.statusCounts[evaluation.status] =
          (existing.statusCounts[evaluation.status] || 0) + 1;
        existing.agentNames.add(batch.agentName);
      }
    }

    const batches: BatchSummaryItem[] = Array.from(grouped.entries())
      .map(([batchId, value]) => ({
        batchId,
        createdAt: value.createdAt.toISOString(),
        updatedAt: value.updatedAt.toISOString(),
        totalEvaluations: value.total,
        statusCounts: value.statusCounts,
        averageSafetyScore:
          value.safetyScoreCount > 0
            ? Number((value.safetyScoreSum / value.safetyScoreCount).toFixed(2))
            : null,
        releaseMode: value.releaseMode,
        project: value.project,
        agentNames: Array.from(value.agentNames).sort(),
      }))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return NextResponse.json({
      success: true,
      totalBatches: batches.length,
      batches,
    });
  } catch (error: any) {
    console.error("Batch list API error:", error);
    return NextResponse.json(
      {
        error: error.message || "Internal server error",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const {
      projectId,
      evaluationNamePrefix,
      selectedScenarios,
      releaseMode: requestedReleaseMode,
      releasePolicyId,
      agents,
    }: {
      projectId?: string;
      evaluationNamePrefix?: string;
      selectedScenarios: string[];
      releaseMode?: ReleaseMode;
      releasePolicyId?: string;
      agents: BatchAgentInput[];
    } = body;

    if (!Array.isArray(selectedScenarios) || selectedScenarios.length === 0) {
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
    if (uniqueSelectedScenarios.length > MAX_SCENARIOS) {
      return NextResponse.json(
        { error: `Maximum ${MAX_SCENARIOS} scenarios allowed per evaluation` },
        { status: 400 }
      );
    }

    if (!Array.isArray(agents) || agents.length === 0) {
      return NextResponse.json(
        { error: "At least one agent configuration is required" },
        { status: 400 }
      );
    }
    if (agents.length > MAX_BATCH_AGENTS) {
      return NextResponse.json(
        { error: `Maximum ${MAX_BATCH_AGENTS} agents allowed per batch` },
        { status: 400 }
      );
    }

    const releaseMode = getReleaseMode({ release_mode: requestedReleaseMode });
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
    const guardrails =
      releaseMode === "release_candidate"
        ? RELEASE_CANDIDATE_GUARDRAILS
        : EXPLORATORY_GUARDRAILS;

    const possiblePaths = [
      join(process.cwd(), "..", "scenario_definitions"),
      join(process.cwd(), "scenario_definitions"),
      join(process.cwd(), "..", "..", "scenario_definitions"),
    ];
    const scenariosDir = possiblePaths.find((path) => existsSync(path)) || "";
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
            policyResolution.error || "Release policy unavailable; cannot create batch evaluation",
        },
        { status: selectedPolicyConfig ? 400 : 500 }
      );
    }
    const releasePolicyRef = buildReleasePolicyRef(selectedPolicyConfig);

    if (releaseMode === "release_candidate") {
      const scenarioCatalog = await loadScenariosFromDirectory(scenariosDir);
      const validation = validateReleaseCandidateSelection(
        uniqueSelectedScenarios,
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
          },
          { status: 400 }
        );
      }
    }

    const project = await resolveProject(orgId, projectId);
    if (!project) {
      return NextResponse.json(
        { error: "Could not create or find project" },
        { status: 500 }
      );
    }
    if (project.organization?.clerkId !== orgId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const batchId = createBatchId();
    const createdEvaluations: Array<{
      id: string;
      status: string;
      agentName: string;
      agentType: AgentType;
    }> = [];

    for (let index = 0; index < agents.length; index++) {
      const entry = agents[index];
      const agentType = entry.agentType;
      if (agentType !== "openai" && agentType !== "http_agent") {
        return NextResponse.json(
          { error: `Unsupported agentType at index ${index}: ${entry.agentType}` },
          { status: 400 }
        );
      }

      const agentConfig = entry.agentConfig || {};
      const runtimeConfig = {
        max_concurrency: Math.floor(
          toNumber(
            (agentConfig as any).max_concurrency,
            guardrails.max_concurrency,
            1,
            guardrails.max_concurrency
          )
        ),
        timeout_seconds: toNumber(
          (agentConfig as any).timeout_seconds,
          30,
          5,
          guardrails.max_request_timeout_seconds
        ),
        max_retries: Math.floor(
          toNumber((agentConfig as any).max_retries, 2, 1, guardrails.max_retries)
        ),
        execution_timeout_seconds: Math.floor(
          toNumber(
            (agentConfig as any).execution_timeout_seconds,
            guardrails.execution_timeout_seconds,
            60,
            guardrails.execution_timeout_seconds
          )
        ),
      };

      const httpAgentInput =
        agentType === "http_agent" &&
        (agentConfig as any)?.http_agent &&
        typeof (agentConfig as any).http_agent === "object"
          ? ((agentConfig as any).http_agent as Record<string, unknown>)
          : null;

      const httpAgentRuntimeConfig =
        agentType === "http_agent"
          ? {
              base_url:
                toOptionalString(httpAgentInput?.base_url) ||
                toOptionalString((agentConfig as any).http_agent_base_url),
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

      if (httpAgentRuntimeConfig) {
        if (!httpAgentRuntimeConfig.base_url) {
          return NextResponse.json(
            { error: `Agent ${index + 1}: HTTP agent base URL is required` },
            { status: 400 }
          );
        }
        if (!SUPPORTED_HTTP_METHODS.has(httpAgentRuntimeConfig.method)) {
          return NextResponse.json(
            {
              error:
                `Agent ${index + 1}: unsupported HTTP method '${httpAgentRuntimeConfig.method}'. Supported: GET, POST, PUT, PATCH`,
            },
            { status: 400 }
          );
        }
        const urlValidation = validateHttpAgentUrl(httpAgentRuntimeConfig.base_url);
        if (!urlValidation.valid) {
          return NextResponse.json(
            { error: `Agent ${index + 1}: ${urlValidation.error}` },
            { status: 400 }
          );
        }
        if (
          httpAgentRuntimeConfig.auth_token_env_var &&
          !process.env[httpAgentRuntimeConfig.auth_token_env_var]
        ) {
          return NextResponse.json(
            {
              error:
                `Agent ${index + 1}: auth token env var '${httpAgentRuntimeConfig.auth_token_env_var}' is not configured on server`,
            },
            { status: 400 }
          );
        }
      }

      const agentName = (entry.name || `Agent ${index + 1}`).trim();
      const sanitizedConfig = sanitizeConfigForStorage(agentConfig);
      (sanitizedConfig as any).provider = agentType;
      if (httpAgentRuntimeConfig) {
        (sanitizedConfig as any).http_agent = httpAgentRuntimeConfig;
      }
      (sanitizedConfig as any).release_mode = releaseMode;
      (sanitizedConfig as any).release_policy = releasePolicyRef;
      (sanitizedConfig as any).runtime_guardrails = runtimeConfig;
      (sanitizedConfig as any).batch = {
        batch_id: batchId,
        index,
        total: agents.length,
        agent_name: agentName,
      };

      const configHash = hashConfig({
        ...(agentConfig as any),
        provider: agentType,
        release_mode: releaseMode,
        release_policy: releasePolicyRef,
        ...runtimeConfig,
        http_agent: httpAgentRuntimeConfig || undefined,
      });

      const runningCount = evaluationQueue.getRunningCount();
      const initialStatus = runningCount >= 2 ? "queued" : "running";
      const evaluation = await prisma.evaluation.create({
        data: {
          projectId: project.id,
          name:
            `${evaluationNamePrefix || "Batch Eval"} • ${agentName} • ${new Date().toLocaleString()}`,
          status: initialStatus,
          scenarios: uniqueSelectedScenarios,
          config: sanitizedConfig,
          configHash,
        },
      });

      const evaluationConfig = {
        provider: agentType,
        model: ((agentConfig as any).model as string) || "gpt-4o-mini",
        temperature:
          typeof (agentConfig as any).temperature === "number"
            ? (agentConfig as any).temperature
            : 0.0,
        max_tokens:
          typeof (agentConfig as any).max_tokens === "number"
            ? (agentConfig as any).max_tokens
            : 512,
        max_concurrency: runtimeConfig.max_concurrency,
        timeout_seconds: runtimeConfig.timeout_seconds,
        max_retries: runtimeConfig.max_retries,
        execution_timeout_seconds: runtimeConfig.execution_timeout_seconds,
        release_mode: releaseMode,
        release_policy: releasePolicyRef,
        base_url: ((agentConfig as any).base_url as string) || null,
        http_agent_base_url: httpAgentRuntimeConfig?.base_url || null,
        http_agent_config:
          httpAgentRuntimeConfig && agentType === "http_agent"
            ? {
                endpoint_path: httpAgentRuntimeConfig.endpoint_path,
                health_path: httpAgentRuntimeConfig.health_path,
                method: httpAgentRuntimeConfig.method,
                prompt_field: httpAgentRuntimeConfig.prompt_field,
                response_path: httpAgentRuntimeConfig.response_path,
                auth_header: httpAgentRuntimeConfig.auth_header,
                auth_token_env_var: httpAgentRuntimeConfig.auth_token_env_var,
                auth_scheme: httpAgentRuntimeConfig.auth_scheme,
              }
            : null,
      };

      await evaluationQueue.enqueue({
        evaluationId: evaluation.id,
        config: evaluationConfig,
        scenarioIds: uniqueSelectedScenarios,
        scenariosDir,
      });

      createdEvaluations.push({
        id: evaluation.id,
        status: initialStatus,
        agentName,
        agentType,
      });
    }

    return NextResponse.json({
      success: true,
      batchId,
      releaseMode,
      releasePolicy: releasePolicyRef,
      projectId: project.id,
      totalAgents: createdEvaluations.length,
      evaluationIds: createdEvaluations.map((item) => item.id),
      evaluations: createdEvaluations,
    });
  } catch (error: any) {
    console.error("Batch evaluate API error:", error);
    return NextResponse.json(
      {
        error: error.message || "Internal server error",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
