/**
 * Wire types and Zod schemas for thin trace events (Run Spec v1.0).
 */

import { z } from "zod";

export type EventType =
  | "run_started"
  | "model_call"
  | "tool_call"
  | "tool_result"
  | "policy_decision"
  | "human_approval"
  | "run_completed"
  | "run_failed";

export const SPEC_VERSION = "1.0" as const;

export interface TracerConfig {
  apiKey: string;
  baseUrl?: string;
  evaluationId?: string;
  timeoutSeconds?: number;
  enabled?: boolean;
}

/** Config with defaults applied for transport. */
export interface ResolvedTracerConfig {
  apiKey: string;
  baseUrl: string;
  evaluationId?: string;
  timeoutSeconds: number;
  enabled: boolean;
}

/** Explicit shape for a run_started payload (matches {@link RunStartedPayloadSchema}). */
export interface RunStartedPayloadShape {
  agent_id?: string | null;
  scenario_id?: string | null;
  metadata?: Record<string, unknown>;
}

/** Explicit shape for a tool_call payload (matches {@link ToolCallPayloadSchema}). */
export interface ToolCallPayloadShape {
  tool_name: string;
  tool_input?: Record<string, unknown>;
  span_id: string;
}

/** Explicit shape for a run_completed payload (matches {@link RunCompletedPayloadSchema}). */
export interface RunCompletedPayloadShape {
  duration_ms?: number | null;
  output_preview?: string | null;
  metadata?: Record<string, unknown>;
}

/** Explicit shape for a run_failed payload (matches {@link RunFailedPayloadSchema}). */
export interface RunFailedPayloadShape {
  error: string;
  error_type?: string | null;
  duration_ms?: number | null;
}

/** Explicit shape for a model_call payload (matches {@link ModelCallPayloadSchema}). */
export interface ModelCallPayloadShape {
  model: string;
  prompt_preview?: string | null;
  response_preview?: string | null;
  duration_ms?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  metadata?: Record<string, unknown>;
}

/** Explicit shape for a tool_result payload (matches {@link ToolResultPayloadSchema}). */
export interface ToolResultPayloadShape {
  tool_name: string;
  span_id: string;
  success: boolean;
  result_preview?: string | null;
  error?: string | null;
  duration_ms?: number | null;
}

/** Explicit shape for a policy_decision payload (matches {@link PolicyDecisionPayloadSchema}). */
export interface PolicyDecisionPayloadShape {
  decision: "allow" | "deny" | "audit";
  policy_id?: string | null;
  resource?: string | null;
  reason: string;
  span_id?: string | null;
}

/** Explicit shape for a human_approval payload (matches {@link HumanApprovalPayloadSchema}). */
export interface HumanApprovalPayloadShape {
  approved: boolean;
  approver_id?: string | null;
  reason?: string | null;
  span_id?: string | null;
  timeout_seconds?: number | null;
}

/** Explicit shape for the wire event (matches {@link BaseEventSchema}). */
export interface ThinTraceEventShape {
  spec_version: typeof SPEC_VERSION;
  event_type: EventType;
  run_id: string;
  evaluation_id?: string | null;
  timestamp: string;
  payload: Record<string, unknown>;
}

// --- Zod schemas (runtime validation) ---

export const RunStartedPayloadSchema = z.object({
  agent_id: z.string().nullable().optional(),
  scenario_id: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export const ToolCallPayloadSchema = z.object({
  tool_name: z.string().min(1),
  tool_input: z.record(z.string(), z.unknown()).optional().default({}),
  span_id: z.string().uuid(),
});

export const RunCompletedPayloadSchema = z.object({
  duration_ms: z.number().int().nonnegative().nullable().optional(),
  output_preview: z.string().max(500).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export const RunFailedPayloadSchema = z.object({
  error: z.string().min(1),
  error_type: z.string().nullable().optional(),
  duration_ms: z.number().int().nonnegative().nullable().optional(),
});

export const ModelCallPayloadSchema = z.object({
  model: z.string().min(1),
  prompt_preview: z.string().max(500).nullable().optional(),
  response_preview: z.string().max(500).nullable().optional(),
  duration_ms: z.number().int().nonnegative().nullable().optional(),
  input_tokens: z.number().int().nonnegative().nullable().optional(),
  output_tokens: z.number().int().nonnegative().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export const ToolResultPayloadSchema = z.object({
  tool_name: z.string().min(1),
  span_id: z.string().uuid(),
  success: z.boolean(),
  result_preview: z.string().max(500).nullable().optional(),
  error: z.string().nullable().optional(),
  duration_ms: z.number().int().nonnegative().nullable().optional(),
});

export const PolicyDecisionPayloadSchema = z.object({
  decision: z.enum(["allow", "deny", "audit"]),
  policy_id: z.string().nullable().optional(),
  resource: z.string().nullable().optional(),
  reason: z.string().min(1),
  span_id: z.string().nullable().optional(),
});

export const HumanApprovalPayloadSchema = z.object({
  approved: z.boolean(),
  approver_id: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  span_id: z.string().nullable().optional(),
  timeout_seconds: z.number().int().nonnegative().nullable().optional(),
});

export const BaseEventSchema = z.object({
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
  ]),
  run_id: z.string().uuid(),
  evaluation_id: z.string().nullable().optional(),
  timestamp: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
});

export type RunStartedPayload = z.infer<typeof RunStartedPayloadSchema>;
export type ToolCallPayload = z.infer<typeof ToolCallPayloadSchema>;
export type RunCompletedPayload = z.infer<typeof RunCompletedPayloadSchema>;
export type RunFailedPayload = z.infer<typeof RunFailedPayloadSchema>;
export type ModelCallPayload = z.infer<typeof ModelCallPayloadSchema>;
export type ToolResultPayload = z.infer<typeof ToolResultPayloadSchema>;
export type PolicyDecisionPayload = z.infer<typeof PolicyDecisionPayloadSchema>;
export type HumanApprovalPayload = z.infer<typeof HumanApprovalPayloadSchema>;
export type BaseEvent = z.infer<typeof BaseEventSchema>;

/** Alias for the validated wire event (same as {@link BaseEvent}). */
export type ThinTraceEvent = BaseEvent;
