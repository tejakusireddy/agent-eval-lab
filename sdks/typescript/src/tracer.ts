import { randomUUID } from "node:crypto";

import {
  BaseEventSchema,
  HumanApprovalPayloadSchema,
  ModelCallPayloadSchema,
  PolicyDecisionPayloadSchema,
  RunCompletedPayloadSchema,
  RunFailedPayloadSchema,
  RunStartedPayloadSchema,
  SPEC_VERSION,
  ToolCallPayloadSchema,
  ToolResultPayloadSchema,
  type ResolvedTracerConfig,
  type ThinTraceEventShape,
  type TracerConfig,
} from "./models.js";
import { sendEvent } from "./transport.js";

const PREVIEW_MAX = 500;

function utcIso(): string {
  return new Date().toISOString();
}

function truncatePreview(text: string | null | undefined): string | null {
  if (text == null) {
    return null;
  }
  return text.length <= PREVIEW_MAX ? text : text.slice(0, PREVIEW_MAX);
}

function resolveTracerConfig(config: TracerConfig): ResolvedTracerConfig {
  const hasKey = Boolean(config.apiKey?.trim());
  const enabled = config.enabled !== false && hasKey;
  return {
    apiKey: config.apiKey ?? "",
    baseUrl: config.baseUrl?.trim() || "https://app.agenteval.dev",
    evaluationId: config.evaluationId?.trim() || undefined,
    timeoutSeconds: config.timeoutSeconds ?? 3,
    enabled,
  };
}

/**
 * Thin trace emitter for AgentEvalLab. All methods are async, never throw,
 * and failures are logged with console.error.
 */
export class EvalTracer {
  private readonly resolved: ResolvedTracerConfig;
  private runId: string | null = null;

  constructor(config: TracerConfig) {
    this.resolved = resolveTracerConfig(config);
  }

  /** Build a tracer from environment variables (disabled if API key missing). */
  static fromEnv(): EvalTracer {
    const apiKey = process.env.AGENT_EVAL_API_KEY?.trim() ?? "";
    const baseUrl = process.env.AGENT_EVAL_BASE_URL?.trim();
    const evaluationId = process.env.AGENT_EVAL_EVALUATION_ID?.trim();
    return new EvalTracer({
      apiKey,
      baseUrl: baseUrl || "https://app.agenteval.dev",
      evaluationId: evaluationId || undefined,
      enabled: Boolean(apiKey),
    });
  }

  private async emit(event: ThinTraceEventShape): Promise<void> {
    const validated = BaseEventSchema.safeParse(event);
    if (!validated.success) {
      console.error(
        "[agent-eval-sdk] Invalid event payload:",
        validated.error.issues
      );
      return;
    }
    try {
      await sendEvent(validated.data, this.resolved);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[agent-eval-sdk] emit error: ${msg}`);
    }
  }

  async runStarted(options?: {
    agentId?: string;
    scenarioId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<string> {
    const runId = randomUUID();
    this.runId = runId;
    const payloadRaw = {
      agent_id: options?.agentId ?? null,
      scenario_id: options?.scenarioId ?? null,
      metadata: options?.metadata ?? {},
    };
    const payloadResult = RunStartedPayloadSchema.safeParse(payloadRaw);
    if (!payloadResult.success) {
      console.error(
        "[agent-eval-sdk] Invalid event payload:",
        payloadResult.error.issues
      );
      return runId;
    }
    const event: ThinTraceEventShape = {
      spec_version: SPEC_VERSION,
      event_type: "run_started",
      run_id: runId,
      evaluation_id: this.resolved.evaluationId ?? null,
      timestamp: utcIso(),
      payload: payloadResult.data,
    };
    await this.emit(event);
    return runId;
  }

  async toolCall(options: {
    toolName: string;
    toolInput?: Record<string, unknown>;
  }): Promise<string> {
    if (!this.runId) {
      console.error(
        "[agent-eval-sdk] toolCall skipped: no active run (call runStarted first)"
      );
      return randomUUID();
    }
    const spanId = randomUUID();
    const payloadRaw = {
      tool_name: options.toolName,
      tool_input: options.toolInput ?? {},
      span_id: spanId,
    };
    const payloadResult = ToolCallPayloadSchema.safeParse(payloadRaw);
    if (!payloadResult.success) {
      console.error(
        "[agent-eval-sdk] Invalid event payload:",
        payloadResult.error.issues
      );
      return spanId;
    }
    const event: ThinTraceEventShape = {
      spec_version: SPEC_VERSION,
      event_type: "tool_call",
      run_id: this.runId,
      evaluation_id: this.resolved.evaluationId ?? null,
      timestamp: utcIso(),
      payload: payloadResult.data,
    };
    await this.emit(event);
    return spanId;
  }

  async modelCall(options: {
    model: string;
    promptPreview?: string | null;
    responsePreview?: string | null;
    durationMs?: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.runId) {
      console.error(
        "[agent-eval-sdk] modelCall skipped: no active run (call runStarted first)"
      );
      return;
    }
    const payloadRaw = {
      model: options.model,
      prompt_preview: truncatePreview(options.promptPreview ?? null),
      response_preview: truncatePreview(options.responsePreview ?? null),
      duration_ms: options.durationMs ?? null,
      input_tokens: options.inputTokens ?? null,
      output_tokens: options.outputTokens ?? null,
      metadata: options.metadata ?? {},
    };
    const payloadResult = ModelCallPayloadSchema.safeParse(payloadRaw);
    if (!payloadResult.success) {
      console.error(
        "[agent-eval-sdk] Invalid event payload:",
        payloadResult.error.issues
      );
      return;
    }
    const event: ThinTraceEventShape = {
      spec_version: SPEC_VERSION,
      event_type: "model_call",
      run_id: this.runId,
      evaluation_id: this.resolved.evaluationId ?? null,
      timestamp: utcIso(),
      payload: payloadResult.data,
    };
    await this.emit(event);
  }

  async toolResult(options: {
    toolName: string;
    spanId: string;
    success: boolean;
    resultPreview?: string | null;
    error?: string | null;
    durationMs?: number | null;
  }): Promise<void> {
    if (!this.runId) {
      console.error(
        "[agent-eval-sdk] toolResult skipped: no active run (call runStarted first)"
      );
      return;
    }
    const payloadRaw = {
      tool_name: options.toolName,
      span_id: options.spanId,
      success: options.success,
      result_preview: truncatePreview(options.resultPreview ?? null),
      error: options.error ?? null,
      duration_ms: options.durationMs ?? null,
    };
    const payloadResult = ToolResultPayloadSchema.safeParse(payloadRaw);
    if (!payloadResult.success) {
      console.error(
        "[agent-eval-sdk] Invalid event payload:",
        payloadResult.error.issues
      );
      return;
    }
    const event: ThinTraceEventShape = {
      spec_version: SPEC_VERSION,
      event_type: "tool_result",
      run_id: this.runId,
      evaluation_id: this.resolved.evaluationId ?? null,
      timestamp: utcIso(),
      payload: payloadResult.data,
    };
    await this.emit(event);
  }

  async policyDecision(options: {
    decision: "allow" | "deny" | "audit";
    reason: string;
    policyId?: string | null;
    resource?: string | null;
    spanId?: string | null;
  }): Promise<void> {
    if (!this.runId) {
      console.error(
        "[agent-eval-sdk] policyDecision skipped: no active run (call runStarted first)"
      );
      return;
    }
    const payloadRaw = {
      decision: options.decision,
      reason: options.reason,
      policy_id: options.policyId ?? null,
      resource: options.resource ?? null,
      span_id: options.spanId ?? null,
    };
    const payloadResult = PolicyDecisionPayloadSchema.safeParse(payloadRaw);
    if (!payloadResult.success) {
      console.error(
        "[agent-eval-sdk] Invalid event payload:",
        payloadResult.error.issues
      );
      return;
    }
    const event: ThinTraceEventShape = {
      spec_version: SPEC_VERSION,
      event_type: "policy_decision",
      run_id: this.runId,
      evaluation_id: this.resolved.evaluationId ?? null,
      timestamp: utcIso(),
      payload: payloadResult.data,
    };
    await this.emit(event);
  }

  async humanApproval(options: {
    approved: boolean;
    approverId?: string | null;
    reason?: string | null;
    spanId?: string | null;
    timeoutSeconds?: number | null;
  }): Promise<void> {
    if (!this.runId) {
      console.error(
        "[agent-eval-sdk] humanApproval skipped: no active run (call runStarted first)"
      );
      return;
    }
    const payloadRaw = {
      approved: options.approved,
      approver_id: options.approverId ?? null,
      reason: options.reason ?? null,
      span_id: options.spanId ?? null,
      timeout_seconds: options.timeoutSeconds ?? null,
    };
    const payloadResult = HumanApprovalPayloadSchema.safeParse(payloadRaw);
    if (!payloadResult.success) {
      console.error(
        "[agent-eval-sdk] Invalid event payload:",
        payloadResult.error.issues
      );
      return;
    }
    const event: ThinTraceEventShape = {
      spec_version: SPEC_VERSION,
      event_type: "human_approval",
      run_id: this.runId,
      evaluation_id: this.resolved.evaluationId ?? null,
      timestamp: utcIso(),
      payload: payloadResult.data,
    };
    await this.emit(event);
  }

  async runCompleted(options?: {
    durationMs?: number;
    outputPreview?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const rid = this.runId;
    this.runId = null;
    if (!rid) {
      return;
    }
    const payloadRaw = {
      duration_ms: options?.durationMs ?? null,
      output_preview: truncatePreview(options?.outputPreview ?? null),
      metadata: options?.metadata ?? {},
    };
    const payloadResult = RunCompletedPayloadSchema.safeParse(payloadRaw);
    if (!payloadResult.success) {
      console.error(
        "[agent-eval-sdk] Invalid event payload:",
        payloadResult.error.issues
      );
      return;
    }
    const event: ThinTraceEventShape = {
      spec_version: SPEC_VERSION,
      event_type: "run_completed",
      run_id: rid,
      evaluation_id: this.resolved.evaluationId ?? null,
      timestamp: utcIso(),
      payload: payloadResult.data,
    };
    await this.emit(event);
  }

  async runFailed(options: {
    error: string;
    errorType?: string;
    durationMs?: number;
  }): Promise<void> {
    const rid = this.runId;
    this.runId = null;
    if (!rid) {
      return;
    }
    const payloadRaw = {
      error: options.error,
      error_type: options.errorType ?? null,
      duration_ms: options.durationMs ?? null,
    };
    const payloadResult = RunFailedPayloadSchema.safeParse(payloadRaw);
    if (!payloadResult.success) {
      console.error(
        "[agent-eval-sdk] Invalid event payload:",
        payloadResult.error.issues
      );
      return;
    }
    const event: ThinTraceEventShape = {
      spec_version: SPEC_VERSION,
      event_type: "run_failed",
      run_id: rid,
      evaluation_id: this.resolved.evaluationId ?? null,
      timestamp: utcIso(),
      payload: payloadResult.data,
    };
    await this.emit(event);
  }
}
