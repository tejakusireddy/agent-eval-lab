/**
 * Defense ablation: metric, span-level, and gate diffs between baseline vs defended runs.
 * Pure functions only in computeAblationDiff — no I/O.
 */

import { z } from "zod";

import { normalizeReportJson } from "@/app/_utils/report-json";
import type { GateDecision } from "@/lib/release-gate";

// --- Span / scenario outcomes ---

export const SpanOutcomeSchema = z.enum([
  "pass",
  "fail_minor",
  "fail_critical",
  "error",
]);
export type SpanOutcome = z.infer<typeof SpanOutcomeSchema>;

export const GraderVerdictEntrySchema = z.object({
  grader_type: z.string(),
  passed: z.boolean(),
});
export type GraderVerdictEntry = z.infer<typeof GraderVerdictEntrySchema>;

export const ScenarioResultShapeSchema = z.object({
  scenario_id: z.string(),
  score: z.number(),
  /** `success` | `failure` from json_reporter. */
  status: z.string(),
  /** `PASS` | `FAIL_MINOR` | `FAIL_CRITICAL` from json_reporter. */
  severity: z.string(),
  reasoning: z.string(),
  grader_results: z.array(GraderVerdictEntrySchema),
});
export type ScenarioResultShape = z.infer<typeof ScenarioResultShapeSchema>;

const ReportScenarioRowSchema = z
  .object({
    scenario_id: z.string(),
    score: z.number().optional(),
    status: z.string().optional(),
    severity: z.string().optional(),
    reasoning: z.string().optional(),
    grader_results: z.array(GraderVerdictEntrySchema).optional(),
  })
  .passthrough();

const ReportWithScenariosSchema = z.object({
  scenarios: z.array(ReportScenarioRowSchema).optional(),
  summary: z
    .object({
      total: z.number().optional(),
      passed: z.number().optional(),
      failed_minor: z.number().optional(),
      failed_critical: z.number().optional(),
      safety_score: z.number().optional(),
    })
    .optional(),
});

export const SummaryNumbersSchema = z.object({
  total: z.number(),
  passed: z.number(),
  failed_minor: z.number(),
  failed_critical: z.number(),
  safety_score: z.number(),
});
export type SummaryNumbers = z.infer<typeof SummaryNumbersSchema>;

export const MetricDiffSchema = z.object({
  safety_score_baseline: z.number(),
  safety_score_defended: z.number(),
  safety_score_delta: z.number(),
  safety_score_delta_pct: z.number(),
  passed_baseline: z.number(),
  passed_defended: z.number(),
  passed_delta: z.number(),
  failed_minor_baseline: z.number(),
  failed_minor_defended: z.number(),
  failed_minor_delta: z.number(),
  failed_critical_baseline: z.number(),
  failed_critical_defended: z.number(),
  failed_critical_delta: z.number(),
  total_scenarios: z.number(),
  defense_effective: z.boolean(),
});
export type MetricDiff = z.infer<typeof MetricDiffSchema>;

const FlipDirectionSchema = z.enum([
  "fail_to_pass",
  "pass_to_fail",
  "no_change",
  "severity_improved",
  "severity_worsened",
]);
export type FlipDirection = z.infer<typeof FlipDirectionSchema>;

export const SpanDiffSchema = z.object({
  scenario_id: z.string(),
  baseline_outcome: SpanOutcomeSchema,
  defended_outcome: SpanOutcomeSchema,
  baseline_score: z.number(),
  defended_score: z.number(),
  score_delta: z.number(),
  flipped: z.boolean(),
  flip_direction: FlipDirectionSchema,
  baseline_reasoning: z.string(),
  defended_reasoning: z.string(),
  baseline_grader_verdicts: z.record(z.string(), z.boolean()),
  defended_grader_verdicts: z.record(z.string(), z.boolean()),
  grader_changed: z.boolean(),
});
export type SpanDiff = z.infer<typeof SpanDiffSchema>;

export const GateDiffSchema = z.object({
  baseline_gate_status: z.string(),
  defended_gate_status: z.string(),
  gate_changed: z.boolean(),
  baseline_would_block: z.boolean(),
  defended_would_block: z.boolean(),
  defense_unblocked: z.boolean(),
  defense_caused_block: z.boolean(),
});
export type GateDiff = z.infer<typeof GateDiffSchema>;

export const AblationDiffSchema = z.object({
  ablation_run_id: z.string(),
  defenses_tested: z.array(z.string()),
  computed_at: z.string(),
  metric_diff: MetricDiffSchema,
  span_diffs: z.array(SpanDiffSchema),
  gate_diff: GateDiffSchema,
  flipped_scenarios: z.array(SpanDiffSchema),
  defense_effectiveness_score: z.number(),
});
export type AblationDiff = z.infer<typeof AblationDiffSchema>;

function normalizeGraderResults(
  raw: GraderVerdictEntry[] | undefined
): ScenarioResultShape["grader_results"] {
  if (!raw?.length) return [];
  return raw.map((g) => ({
    grader_type: g.grader_type,
    passed: g.passed,
  }));
}

/**
 * Parse scenario rows from stored reportJson (Run Spec / json_reporter shape).
 */
export function parseScenarioResultsFromReport(
  reportJson: unknown
): ScenarioResultShape[] {
  const norm = normalizeReportJson(reportJson);
  const parsed = ReportWithScenariosSchema.safeParse(norm);
  if (!parsed.success || !parsed.data.scenarios) {
    return [];
  }
  return parsed.data.scenarios.map((row) => {
    const score = typeof row.score === "number" ? row.score : 0;
    const reasoning =
      typeof row.reasoning === "string" ? row.reasoning : "";
    const status = typeof row.status === "string" ? row.status : "";
    const severity =
      typeof row.severity === "string" ? row.severity : "";
    return ScenarioResultShapeSchema.parse({
      scenario_id: row.scenario_id,
      score,
      status,
      severity,
      reasoning,
      grader_results: normalizeGraderResults(row.grader_results),
    });
  });
}

function summaryFromReport(reportJson: unknown): SummaryNumbers {
  const norm = normalizeReportJson(reportJson);
  const parsed = ReportWithScenariosSchema.safeParse(norm);
  const s = parsed.success ? parsed.data.summary : undefined;
  return SummaryNumbersSchema.parse({
    total: s?.total ?? 0,
    passed: s?.passed ?? 0,
    failed_minor: s?.failed_minor ?? 0,
    failed_critical: s?.failed_critical ?? 0,
    safety_score: s?.safety_score ?? 0,
  });
}

export function extractSummaryFromReport(
  reportJson: unknown
): Record<string, number> {
  const s = summaryFromReport(reportJson);
  return {
    total: s.total,
    passed: s.passed,
    failed_minor: s.failed_minor,
    failed_critical: s.failed_critical,
    safety_score: s.safety_score,
  };
}

/**
 * Metric-level diff from two report summaries.
 */
export function computeMetricDiff(
  baselineSummary: Record<string, number>,
  defendedSummary: Record<string, number>
): MetricDiff {
  const sb = baselineSummary.safety_score ?? 0;
  const sd = defendedSummary.safety_score ?? 0;
  const delta = sd - sb;
  const deltaPct = sb !== 0 ? (delta / sb) * 100 : sd > 0 ? 100 : 0;

  const passedB = baselineSummary.passed ?? 0;
  const passedD = defendedSummary.passed ?? 0;
  const fmB = baselineSummary.failed_minor ?? 0;
  const fmD = defendedSummary.failed_minor ?? 0;
  const fcB = baselineSummary.failed_critical ?? 0;
  const fcD = defendedSummary.failed_critical ?? 0;
  const total =
    baselineSummary.total ??
    defendedSummary.total ??
    Math.max(passedB + fmB + fcB, passedD + fmD + fcD);

  return MetricDiffSchema.parse({
    safety_score_baseline: sb,
    safety_score_defended: sd,
    safety_score_delta: delta,
    safety_score_delta_pct: deltaPct,
    passed_baseline: passedB,
    passed_defended: passedD,
    passed_delta: passedD - passedB,
    failed_minor_baseline: fmB,
    failed_minor_defended: fmD,
    failed_minor_delta: fmD - fmB,
    failed_critical_baseline: fcB,
    failed_critical_defended: fcD,
    failed_critical_delta: fcD - fcB,
    total_scenarios: total,
    defense_effective: delta > 0,
  });
}

function outcomeRank(o: SpanOutcome): number {
  switch (o) {
    case "pass":
      return 0;
    case "fail_minor":
      return 1;
    case "fail_critical":
      return 2;
    case "error":
      return 3;
    default:
      return 3;
  }
}

function verdictsRecord(
  results: GraderVerdictEntry[]
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const g of results) {
    out[g.grader_type] = g.passed;
  }
  return out;
}

function graderMapsDiffer(
  a: Record<string, boolean>,
  b: Record<string, boolean>
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (Boolean(a[k]) !== Boolean(b[k])) return true;
  }
  return false;
}

function computeFlipDirection(
  baselineOutcome: SpanOutcome,
  defendedOutcome: SpanOutcome
): FlipDirection {
  if (baselineOutcome === defendedOutcome) {
    return "no_change";
  }
  if (baselineOutcome !== "pass" && defendedOutcome === "pass") {
    return "fail_to_pass";
  }
  if (baselineOutcome === "pass" && defendedOutcome !== "pass") {
    return "pass_to_fail";
  }
  const rb = outcomeRank(baselineOutcome);
  const rd = outcomeRank(defendedOutcome);
  if (rd < rb) return "severity_improved";
  if (rd > rb) return "severity_worsened";
  return "no_change";
}

function emptyShape(scenarioId: string): ScenarioResultShape {
  return {
    scenario_id: scenarioId,
    score: 0,
    status: "",
    severity: "",
    reasoning: "",
    grader_results: [],
  };
}

/**
 * Derive outcome from normalized scenario row (json_reporter shape).
 */
function deriveOutcomeFromShape(
  row: ScenarioResultShape,
  missing: boolean
): SpanOutcome {
  if (missing) return "error";
  const sev = (row.severity || "").toUpperCase();
  if (sev === "PASS") return "pass";
  if (sev === "FAIL_MINOR") return "fail_minor";
  if (sev === "FAIL_CRITICAL") return "fail_critical";
  const st = (row.status || "").toLowerCase();
  if (st === "success") return "pass";
  if (st === "failure") return "fail_critical";
  return "error";
}

/**
 * Per-scenario diff aligned by scenario_id. Missing side uses synthetic "error" outcome.
 */
export function computeSpanDiff(
  baselineResults: ScenarioResultShape[],
  defendedResults: ScenarioResultShape[]
): SpanDiff[] {
  const byB = new Map(baselineResults.map((r) => [r.scenario_id, r]));
  const byD = new Map(defendedResults.map((r) => [r.scenario_id, r]));
  const ids = new Set<string>([...byB.keys(), ...byD.keys()]);
  const list: SpanDiff[] = [];

  for (const scenarioId of ids) {
    const b = byB.get(scenarioId) ?? emptyShape(scenarioId);
    const d = byD.get(scenarioId) ?? emptyShape(scenarioId);

    const baselineOutcomeFinal = deriveOutcomeFromShape(b, !byB.has(scenarioId));
    const defendedOutcomeFinal = deriveOutcomeFromShape(d, !byD.has(scenarioId));

    const bg = verdictsRecord(b.grader_results);
    const dg = verdictsRecord(d.grader_results);
    const graderChanged = graderMapsDiffer(bg, dg);
    const flipped = baselineOutcomeFinal !== defendedOutcomeFinal;
    const flipDirection = computeFlipDirection(
      baselineOutcomeFinal,
      defendedOutcomeFinal
    );

    list.push(
      SpanDiffSchema.parse({
        scenario_id: scenarioId,
        baseline_outcome: baselineOutcomeFinal,
        defended_outcome: defendedOutcomeFinal,
        baseline_score: b.score,
        defended_score: d.score,
        score_delta: d.score - b.score,
        flipped,
        flip_direction: flipDirection,
        baseline_reasoning: b.reasoning,
        defended_reasoning: d.reasoning,
        baseline_grader_verdicts: bg,
        defended_grader_verdicts: dg,
        grader_changed: graderChanged,
      })
    );
  }

  list.sort((a, b) => a.scenario_id.localeCompare(b.scenario_id));
  return list;
}

/**
 * Compare release-gate decisions for baseline vs defended evaluations.
 */
export function computeGateDiff(
  baselineGate: GateDecision,
  defendedGate: GateDecision
): GateDiff {
  const bs = baselineGate.status;
  const ds = defendedGate.status;
  const baselineBlock = bs === "block";
  const defendedBlock = ds === "block";
  return GateDiffSchema.parse({
    baseline_gate_status: bs,
    defended_gate_status: ds,
    gate_changed: bs !== ds,
    baseline_would_block: baselineBlock,
    defended_would_block: defendedBlock,
    defense_unblocked: baselineBlock && ds === "go",
    defense_caused_block: bs === "go" && defendedBlock,
  });
}

/**
 * Full ablation diff (pure). Caller supplies gate decisions from evaluateGateForEvaluation.
 */
export function computeAblationDiff(
  ablationRunId: string,
  defensesTested: string[],
  baselineSummary: Record<string, number>,
  defendedSummary: Record<string, number>,
  baselineResults: ScenarioResultShape[],
  defendedResults: ScenarioResultShape[],
  baselineGate: GateDecision,
  defendedGate: GateDecision
): AblationDiff {
  const metricDiff = computeMetricDiff(baselineSummary, defendedSummary);
  const spanDiffs = computeSpanDiff(baselineResults, defendedResults);
  const gateDiff = computeGateDiff(baselineGate, defendedGate);
  const flipped = spanDiffs.filter((s) => s.flipped);

  const baselineNonPass = spanDiffs.filter((s) => s.baseline_outcome !== "pass");
  const recovered = baselineNonPass.filter(
    (s) => s.defended_outcome === "pass"
  ).length;
  const denom = baselineNonPass.length;
  const defenseEffectivenessScore =
    denom > 0 ? Math.round((recovered / denom) * 100) : 100;

  return AblationDiffSchema.parse({
    ablation_run_id: ablationRunId,
    defenses_tested: defensesTested,
    computed_at: new Date().toISOString(),
    metric_diff: metricDiff,
    span_diffs: spanDiffs,
    gate_diff: gateDiff,
    flipped_scenarios: flipped,
    defense_effectiveness_score: defenseEffectivenessScore,
  });
}
