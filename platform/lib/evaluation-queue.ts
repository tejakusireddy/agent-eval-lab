import { prisma } from "./db";
import crypto from "crypto";
import { incrementEvaluationCompletedUsage } from "@/lib/evaluation-completion";
import { runPostEvaluationHooks } from "@/lib/evaluation-completion";
import { EvaluationConfig, runEvaluation } from "./run-eval";

interface QueuedEvaluation {
  evaluationId: string;
  config: EvaluationConfig;
  scenarioIds: string[];
  scenariosDir: string;
}

const WEBHOOK_URL =
  process.env.EVAL_WEBHOOK_URL ||
  "http://localhost:3000/api/internal/eval-webhook";

const INTERNAL_APP_BASE =
  process.env.INTERNAL_APP_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "http://localhost:3000";

const INTERNAL_ENQUEUE_SECRET = process.env.INTERNAL_ENQUEUE_SECRET ?? "";

const CELERY_REVOKE_URL =
  process.env.CELERY_REVOKE_URL || "http://localhost:8001/revoke";

const BRIDGE_SECRET = process.env.BRIDGE_SECRET ?? "";

const FETCH_TIMEOUT_MS = 10_000;

function parseStoredReportJson(result: {
  reports?: { json?: string };
  summary?: Record<string, unknown>;
  results?: unknown[];
}): Record<string, unknown> {
  const rawReportJson = result.reports?.json;
  if (typeof rawReportJson === "string") {
    try {
      const parsed = JSON.parse(rawReportJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Fall through to synthetic storage shape below.
    }
  }

  return {
    summary: result.summary || {},
    scenarios: [],
  };
}

// TODO(Phase 1): replace fire-and-forget enqueue with outbox + delivery guarantees.

async function postInternalEnqueue(evaluation: QueuedEvaluation): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${INTERNAL_APP_BASE.replace(/\/$/, "")}/api/internal/enqueue-eval`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Enqueue-Secret": INTERNAL_ENQUEUE_SECRET,
        },
        body: JSON.stringify({
          evaluationId: evaluation.evaluationId,
          config: evaluation.config,
          scenarioIds: evaluation.scenarioIds,
          scenariosDir: evaluation.scenariosDir,
          webhookUrl: WEBHOOK_URL,
        }),
        signal: controller.signal,
      }
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `enqueue-eval failed: ${res.status} ${errText || res.statusText}`
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function postCeleryRevoke(evaluationId: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(CELERY_REVOKE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(BRIDGE_SECRET ? { "X-Bridge-Secret": BRIDGE_SECRET } : {}),
      },
      body: JSON.stringify({ task_id: evaluationId }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(
        `Celery revoke failed: ${res.status} ${errText || res.statusText}`
      );
    }
  } catch (e) {
    console.error("Celery revoke request failed:", e);
  } finally {
    clearTimeout(timeout);
  }
}

class EvaluationQueue {
  private async getEvaluationStatus(
    evaluationId: string
  ): Promise<string | null> {
    const record = await prisma.evaluation.findUnique({
      where: { id: evaluationId },
      select: { status: true },
    });
    return record?.status ?? null;
  }

  async enqueue(evaluation: QueuedEvaluation): Promise<void> {
    await prisma.evaluation.update({
      where: { id: evaluation.evaluationId },
      data: { status: "queued" },
    });
    await postInternalEnqueue(evaluation);
  }

  async runImmediate(evaluation: QueuedEvaluation): Promise<void> {
    const latestStatus = await this.getEvaluationStatus(evaluation.evaluationId);
    if (latestStatus === "cancelled") {
      return;
    }
    await prisma.evaluation.update({
      where: { id: evaluation.evaluationId },
      data: { status: "running", errorMessage: null },
    });

    const result = await runEvaluation(
      evaluation.config,
      evaluation.scenarioIds,
      evaluation.scenariosDir
    );

    if (result.success && result.data) {
      const summary = result.data.summary || {};
      const reportJson = parseStoredReportJson(result.data);
      await prisma.evaluation.update({
        where: { id: evaluation.evaluationId },
        data: {
          status: "completed",
          safetyScore:
            typeof summary.safety_score === "number"
              ? summary.safety_score
              : null,
          reportHtml: result.data.reports?.html || "",
          reportJson: reportJson as any,
          reportMarkdown: result.data.reports?.md || "",
          completedAt: new Date(),
          errorMessage: null,
        },
      });
    } else {
      await prisma.evaluation.update({
        where: { id: evaluation.evaluationId },
        data: {
          status: "failed",
          errorMessage: result.error || "Inline evaluation failed",
          completedAt: new Date(),
        },
      });
    }

    await runPostEvaluationHooks(evaluation.evaluationId);
  }

  async cancelEvaluation(
    evaluationId: string
  ): Promise<{ cancelled: boolean; message: string; statusCode: number }> {
    const existing = await prisma.evaluation.findUnique({
      where: { id: evaluationId },
      select: {
        id: true,
        status: true,
        project: {
          select: {
            organizationId: true,
          },
        },
      },
    });

    if (!existing) {
      return {
        cancelled: false,
        message: "Evaluation not found",
        statusCode: 404,
      };
    }

    if (existing.status === "cancelled") {
      return {
        cancelled: true,
        message: "Evaluation already cancelled",
        statusCode: 200,
      };
    }

    if (!["queued", "pending", "running"].includes(existing.status)) {
      return {
        cancelled: false,
        message: `Cannot cancel evaluation in status: ${existing.status}`,
        statusCode: 409,
      };
    }

    const wasRunning = existing.status === "running";

    await prisma.evaluation.update({
      where: { id: evaluationId },
      data: {
        status: "cancelled",
        errorMessage: "Cancelled by user",
        completedAt: new Date(),
      },
    });
    await incrementEvaluationCompletedUsage(existing.project.organizationId);
    await postCeleryRevoke(evaluationId);

    return {
      cancelled: true,
      message: wasRunning
        ? "Running evaluation cancelled"
        : "Queued evaluation cancelled",
      statusCode: 200,
    };
  }

  getRunningCount(): number {
    return 0;
  }

  getQueueLength(): number {
    return 0;
  }
}

export const evaluationQueue = new EvaluationQueue();

export function hashConfig(config: any): string {
  const legacyHttpAgentConfig = config.http_agent
    ? {
        endpoint_path: config.http_agent.endpoint_path || null,
        health_path: config.http_agent.health_path || null,
        method: config.http_agent.method || null,
        prompt_field: config.http_agent.prompt_field || null,
        response_path: config.http_agent.response_path || null,
        auth_header: config.http_agent.auth_header || null,
        auth_token_env_var: config.http_agent.auth_token_env_var || null,
        auth_scheme: config.http_agent.auth_scheme || null,
      }
    : null;

  // Create a sanitized copy without secrets
  const sanitized = JSON.stringify({
    provider: config.provider,
    model: config.model,
    temperature: config.temperature,
    max_tokens: config.max_tokens,
    max_concurrency: config.max_concurrency,
    timeout_seconds: config.timeout_seconds,
    max_retries: config.max_retries,
    execution_timeout_seconds: config.execution_timeout_seconds,
    base_url: config.base_url,
    http_agent_base_url: config.http_agent?.base_url,
    http_agent_config: config.http_agent_config || legacyHttpAgentConfig,
    release_mode: config.release_mode || "exploratory",
    release_policy: config.release_policy || null,
  });
  return crypto.createHash("sha256").update(sanitized).digest("hex");
}
