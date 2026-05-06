import { z } from "zod";

/** OTLP JSON attribute value (subset). */
export const OtelAttributeValueSchema = z.object({
  stringValue: z.string().optional(),
  intValue: z.union([z.string(), z.number()]).optional(),
  doubleValue: z.number().optional(),
  boolValue: z.boolean().optional(),
});

export type OtelAttributeValue = z.infer<typeof OtelAttributeValueSchema>;

export const OtelAttributeSchema = z.object({
  key: z.string(),
  value: OtelAttributeValueSchema,
});

export type OtelAttribute = z.infer<typeof OtelAttributeSchema>;

export const OtelSpanSchema = z
  .object({
    traceId: z.string(),
    spanId: z.string(),
    parentSpanId: z.string().optional(),
    name: z.string(),
    kind: z.number().optional(),
    startTimeUnixNano: z.string(),
    endTimeUnixNano: z.string().optional(),
    attributes: z.array(OtelAttributeSchema).optional().default([]),
    status: z
      .object({
        code: z.number(),
        message: z.string().optional(),
      })
      .optional(),
    events: z.array(z.unknown()).optional().default([]),
  })
  .passthrough();

export type OtelSpan = z.infer<typeof OtelSpanSchema>;

export const OtelScopeSpansSchema = z
  .object({
    scope: z.object({
      name: z.string(),
      version: z.string().optional(),
    }),
    spans: z.array(OtelSpanSchema),
  })
  .passthrough();

export type OtelScopeSpans = z.infer<typeof OtelScopeSpansSchema>;

export const OtelResourceSpansSchema = z
  .object({
    resource: z.object({
      attributes: z.array(OtelAttributeSchema).optional().default([]),
    }),
    scopeSpans: z.array(OtelScopeSpansSchema),
  })
  .passthrough();

export type OtelResourceSpans = z.infer<typeof OtelResourceSpansSchema>;

export const OtlpPayloadSchema = z
  .object({
    resourceSpans: z.array(OtelResourceSpansSchema),
  })
  .passthrough();

export type OtlpPayload = z.infer<typeof OtlpPayloadSchema>;

const ATTR_TRUNC = 10_000;
const CANONICAL_SCORES = new Set([0, 25, 50, 100]);

/** Convert OTLP nanosecond string to a JavaScript Date (UTC). */
export function nanosToDate(nanos: string): Date {
  const n = BigInt(nanos);
  const ms = Number(n / BigInt(1_000_000));
  return new Date(ms);
}

/** Convert Date to OTLP nanoseconds string (from epoch ms). */
export function dateToNanos(date: Date): string {
  const ms = date.getTime();
  return (BigInt(ms) * BigInt(1_000_000)).toString();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) {
    return s;
  }
  return s.slice(0, max);
}

function flattenAttributeValue(
  v: OtelAttributeValue
): string | number | boolean | null {
  if (v.stringValue !== undefined) {
    return v.stringValue;
  }
  if (v.intValue !== undefined) {
    return typeof v.intValue === "number" ? v.intValue : Number(v.intValue);
  }
  if (v.doubleValue !== undefined) {
    return v.doubleValue;
  }
  if (v.boolValue !== undefined) {
    return v.boolValue;
  }
  return null;
}

/** Flatten OTLP attributes to a plain record. */
export function attributesToRecord(
  attributes: OtelAttribute[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const a of attributes) {
    const flat = flattenAttributeValue(a.value);
    if (flat !== null) {
      out[a.key] = flat;
    }
  }
  return out;
}

function getAttrString(
  attributes: OtelAttribute[],
  keys: string[]
): string | null {
  const map = new Map(attributes.map((a) => [a.key, a]));
  for (const k of keys) {
    const a = map.get(k);
    if (!a) {
      continue;
    }
    const v = flattenAttributeValue(a.value);
    if (typeof v === "string") {
      return v;
    }
    if (typeof v === "number" || typeof v === "boolean") {
      return String(v);
    }
  }
  return null;
}

function parseTagsJson(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) {
      return [];
    }
    return v.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

function parseFailReasons(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v)) {
      return v.filter((x): x is string => typeof x === "string");
    }
    return [String(raw)];
  } catch {
    return [raw];
  }
}

/**
 * Derive internal event type string from OTel span name and parent presence.
 */
export function deriveEventTypeFromOtelSpan(
  span: OtelSpan,
  hasParent: boolean
): string {
  const n = span.name.toLowerCase();
  if (!hasParent && n.includes("run")) {
    return "run_started";
  }
  if (n.includes("llm") || n.includes("model")) {
    return "model_call";
  }
  if (n.includes("tool")) {
    return "tool_call";
  }
  if (n.includes("chain")) {
    return "model_call";
  }
  if (n.includes("retriev")) {
    return "tool_call";
  }
  return span.name;
}

export interface EvalSpanInsertShape {
  spanId: string;
  parentSpanId: string | null;
  traceId: string;
  eventType: string;
  scenarioId: string | null;
  attempt: number;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  status: string | null;
  score: number | null;
  reasoning: string | null;
  rawPrompt: string | null;
  rawResponse: string | null;
  tags: string[];
  failReasons: string[];
  attributes: Record<string, unknown>;
  evalRunId: string | null;
}

/**
 * Map one OTLP span to EvalSpan row fields (no DB I/O).
 */
export function otelSpanToEvalSpanInsert(
  span: OtelSpan,
  _evaluationId: string | null,
  evalRunId: string | null
): EvalSpanInsertShape {
  const attrs = span.attributes ?? [];
  const hasParent = Boolean(span.parentSpanId);
  const eventType = deriveEventTypeFromOtelSpan(span, hasParent);

  const startedAt = nanosToDate(span.startTimeUnixNano);
  const completedAt = span.endTimeUnixNano
    ? nanosToDate(span.endTimeUnixNano)
    : null;
  let durationMs: number | null = null;
  if (completedAt) {
    durationMs = Math.max(
      0,
      Math.round(completedAt.getTime() - startedAt.getTime())
    );
  }

  const statusCode = span.status?.code;
  let status: string | null = null;
  if (statusCode === 1) {
    status = "PASS";
  } else if (statusCode === 2) {
    status = "FAIL_CRITICAL";
  }

  const scenarioId = getAttrString(attrs, ["scenario_id"]);

  const rawPrompt = truncate(
    getAttrString(attrs, ["input", "prompt"]) ?? "",
    ATTR_TRUNC
  );
  const rawResponse = truncate(
    getAttrString(attrs, ["output", "response"]) ?? "",
    ATTR_TRUNC
  );

  let tags: string[] = [];
  const tagsRaw = getAttrString(attrs, ["tags"]);
  if (tagsRaw) {
    tags = parseTagsJson(tagsRaw);
  }

  let failReasons: string[] = [];
  const errRaw = getAttrString(attrs, ["error", "fail_reasons"]);
  if (errRaw) {
    failReasons = parseFailReasons(errRaw);
  }

  const reasoning = getAttrString(attrs, ["reasoning"]);

  let score: number | null = null;
  const scoreRaw = getAttrString(attrs, ["score"]);
  if (scoreRaw !== null) {
    const f = Number.parseFloat(scoreRaw);
    if (Number.isFinite(f) && CANONICAL_SCORES.has(f)) {
      score = f;
    }
  }

  const attributes = attributesToRecord(attrs);

  return {
    spanId: span.spanId,
    parentSpanId: span.parentSpanId ?? null,
    traceId: span.traceId,
    eventType,
    scenarioId,
    attempt: 1,
    startedAt,
    completedAt,
    durationMs,
    status,
    score,
    reasoning,
    rawPrompt: rawPrompt || null,
    rawResponse: rawResponse || null,
    tags,
    failReasons,
    attributes,
    evalRunId,
  };
}

export type EvalSpanRowForExport = {
  spanId: string;
  parentSpanId: string | null;
  traceId: string;
  eventType: string;
  scenarioId: string | null;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  status: string | null;
  score: number | null;
  reasoning: string | null;
  rawPrompt: string | null;
  rawResponse: string | null;
  tags: unknown;
  failReasons: unknown;
  graderResults: unknown;
  attributes: unknown;
};

function stringAttr(key: string, value: string | null | undefined): OtelAttribute {
  if (value === null || value === undefined) {
    return { key, value: { stringValue: "" } };
  }
  return { key, value: { stringValue: value } };
}

/**
 * Map a persisted EvalSpan row to OTLP JSON span shape.
 */
export function evalSpanToOtelSpan(span: EvalSpanRowForExport): OtelSpan {
  let statusCode = 0;
  let statusMessage: string | undefined;
  if (span.status === "PASS") {
    statusCode = 1;
  } else if (span.status === "FAIL_CRITICAL") {
    statusCode = 2;
  } else if (span.status === "FAIL_MINOR") {
    statusCode = 1;
    statusMessage = "FAIL_MINOR";
  }

  const attributes: OtelAttribute[] = [];
  if (span.scenarioId) {
    attributes.push(stringAttr("scenario_id", span.scenarioId));
  }
  if (span.score !== null && span.score !== undefined) {
    attributes.push(stringAttr("score", String(span.score)));
  }
  if (span.reasoning) {
    attributes.push(stringAttr("reasoning", span.reasoning));
  }
  attributes.push(
    stringAttr("tags", JSON.stringify(span.tags ?? []))
  );
  attributes.push(
    stringAttr("fail_reasons", JSON.stringify(span.failReasons ?? []))
  );
  attributes.push(
    stringAttr("grader_results", JSON.stringify(span.graderResults ?? []))
  );
  if (span.status) {
    attributes.push(stringAttr("eval.status", span.status));
  }

  return {
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId ?? undefined,
    name: span.eventType,
    kind: 1,
    startTimeUnixNano: dateToNanos(span.startedAt),
    endTimeUnixNano: span.completedAt
      ? dateToNanos(span.completedAt)
      : undefined,
    attributes,
    status: {
      code: statusCode,
      ...(statusMessage ? { message: statusMessage } : {}),
    },
    events: [],
  };
}

/**
 * Wrap OTLP spans in a full OTLP JSON payload.
 */
export function buildOtlpPayload(
  spans: OtelSpan[],
  serviceName: string = "agent-eval-lab"
): OtlpPayload {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            {
              key: "service.name",
              value: { stringValue: serviceName },
            },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "agent_eval_lab" },
            spans,
          },
        ],
      },
    ],
  };
}
