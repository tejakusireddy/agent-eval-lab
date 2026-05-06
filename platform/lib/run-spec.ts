import { z } from "zod";

const AgentAuthSchema = z
  .object({
    header: z.string().default("Authorization"),
    scheme: z.enum(["Bearer", "Basic", "None"]).default("Bearer"),
    token_env_var: z.string().nullable().optional(),
  })
  .strict();

export const AgentInvokeSpecSchema = z
  .object({
    endpoint_url: z.string().url(),
    method: z.enum(["POST", "GET", "PUT", "PATCH"]).default("POST"),
    prompt_field: z.string().default("query"),
    response_path: z.string().default("answer"),
    health_path: z.string().nullable().optional(),
    auth: AgentAuthSchema.nullable().optional(),
  })
  .strict();

export const RunSpecOptionsSchema = z
  .object({
    model: z.string().nullable().optional(),
    temperature: z.number().min(0).max(2).default(0),
    max_tokens: z.number().int().min(1).max(4096).default(512),
    max_concurrency: z.number().int().min(1).max(4).default(3),
    timeout_seconds: z.number().min(5).max(120).default(30),
    max_retries: z.number().int().min(0).max(3).default(2),
    execution_timeout_seconds: z.number().min(60).max(1200).default(600),
    /** Tool environment server URL; when set, multi-step execution is enabled. */
    tool_env_url: z.string().url().nullable().optional(),
    /** Max steps per scenario in multi-step mode. */
    max_steps: z.number().int().min(1).max(50).optional().default(10),
  })
  .strict();

const DefenseConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    defenses: z.array(z.string()).default([]),
  })
  .strict();

export const RunSpecSchema = z
  .object({
    spec_version: z.literal("1.0"),
    agent: AgentInvokeSpecSchema,
    scenarios: z.array(z.string()).min(1).max(20),
    options: RunSpecOptionsSchema.optional(),
    release_mode: z.enum(["exploratory", "release_candidate"]).default("exploratory"),
    defense_config: DefenseConfigSchema.nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();

export const RunSpecResponseSchema = z
  .object({
    spec_version: z.literal("1.0"),
    evaluation_id: z.string(),
    status: z.enum(["queued", "running"]),
    poll_url: z.string().url(),
    webhook_registered: z.boolean(),
    release_mode: z.string(),
    submitted_at: z.string(),
    scenario_count: z.number().int().nonnegative(),
  })
  .strict();

export const AblationRequestSchema = z
  .object({
    spec_version: z.literal("1.0"),
    agent: AgentInvokeSpecSchema,
    scenarios: z.array(z.string()).min(1).max(20),
    defenses: z.array(z.string()).min(1),
    options: RunSpecOptionsSchema.optional(),
    release_mode: z
      .enum(["exploratory", "release_candidate"])
      .default("exploratory"),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();

export type AblationRequest = z.infer<typeof AblationRequestSchema>;

export type AgentInvokeSpec = z.infer<typeof AgentInvokeSpecSchema>;
export type RunSpec = z.infer<typeof RunSpecSchema>;
export type RunSpecResponse = z.infer<typeof RunSpecResponseSchema>;
