import { normalizeReportJson } from "@/app/_utils/report-json";
import { findBaselineEvaluationForReleaseCandidate } from "@/lib/baseline-selector";
import { resolvePolicyForConfig } from "@/lib/policy-registry";
import {
  GateDecision,
  RegressionDecision,
  createPendingGateDecision,
  createUnavailableGateDecision,
  evaluateRegressionAgainstBaseline,
  evaluateReportAgainstPolicy,
  isReleaseCandidate,
  mergeGateWithRegression,
} from "@/lib/release-gate";
import { redactSecrets } from "@/lib/secret-redaction";

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Scan stored report JSON for grader results with metadata.calibrated === false.
 * Checks scenario-level grader_results, metadata.grader_results, and metadata.eval_spans[].grader_results.
 */
export function extractCalibrationWarnings(reportJson: unknown): string[] {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const norm = normalizeReportJson(reportJson);
  if (!isRecord(norm)) {
    return [];
  }
  const scenarios = Array.isArray(norm.scenarios) ? norm.scenarios : [];
  for (const raw of scenarios) {
    if (!isRecord(raw)) {
      continue;
    }
    collectGraderCalibrationWarnings(raw.grader_results, warnings, seen);
    const meta = raw.metadata;
    if (isRecord(meta)) {
      collectGraderCalibrationWarnings(meta.grader_results, warnings, seen);
      const spans = meta.eval_spans;
      if (Array.isArray(spans)) {
        for (const sp of spans) {
          if (isRecord(sp)) {
            collectGraderCalibrationWarnings(sp.grader_results, warnings, seen);
          }
        }
      }
    }
  }
  return warnings;
}

function collectGraderCalibrationWarnings(
  gr: unknown,
  warnings: string[],
  seen: Set<string>
): void {
  if (!Array.isArray(gr)) {
    return;
  }
  for (const item of gr) {
    if (!isRecord(item)) {
      continue;
    }
    const meta = item.metadata;
    if (!isRecord(meta) || meta.calibrated !== false) {
      continue;
    }
    const gt =
      typeof item.grader_type === "string" ? item.grader_type : "grader";
    const reason =
      typeof meta.calibration_reason === "string"
        ? meta.calibration_reason
        : "uncalibrated";
    const dedupeKey = `${gt}|${reason}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    warnings.push(`${gt} grader: ${reason}`);
  }
}

export interface GateEvaluationInput {
  id: string;
  projectId: string;
  status: string;
  createdAt: Date;
  reportJson: unknown;
  config: unknown;
  scenarios: unknown;
}

export interface GateEvaluationResult {
  releaseMode: "release_candidate" | "exploratory";
  policyId: string | null;
  policySource: "registry" | "legacy";
  policyPath: string | null;
  gate: GateDecision;
  regression: RegressionDecision | null;
  baselineEvaluationId: string | null;
  calibration_warnings: string[];
}

export async function evaluateGateForEvaluation(
  evaluation: GateEvaluationInput
): Promise<GateEvaluationResult> {
  const releaseCandidate = isReleaseCandidate(evaluation.config);
  const policyResolution = resolvePolicyForConfig(evaluation.config);
  const policyName = policyResolution.policy?.name || null;
  const releaseMode = releaseCandidate ? "release_candidate" : "exploratory";

  let gateDecision: GateDecision;
  let regressionDecision: RegressionDecision | null = null;
  let baselineEvaluationId: string | null = null;

  if (!releaseCandidate) {
    gateDecision = createUnavailableGateDecision(
      "exploratory evaluation; release gate is only enforced for release_candidate runs",
      policyName
    );
  } else if (evaluation.status === "failed") {
    gateDecision = createUnavailableGateDecision(
      "evaluation failed before gate decision",
      policyName
    );
  } else if (evaluation.status !== "completed") {
    gateDecision = createPendingGateDecision(policyName);
  } else {
    const safeReportJson = redactSecrets(normalizeReportJson(evaluation.reportJson));
    if (!safeReportJson) {
      gateDecision = createUnavailableGateDecision("report JSON is missing", policyName);
    } else if (!policyResolution.policy) {
      gateDecision = createUnavailableGateDecision(
        policyResolution.error || "release gate policy unavailable",
        policyName
      );
    } else {
      gateDecision = evaluateReportAgainstPolicy(safeReportJson, policyResolution.policy);

      const baseline = await findBaselineEvaluationForReleaseCandidate({
        evaluationId: evaluation.id,
        projectId: evaluation.projectId,
        createdAt: evaluation.createdAt,
        config: evaluation.config,
        scenarios: evaluation.scenarios,
        requireSameScenarioSet: policyResolution.policy.regression.require_same_scenario_set,
      });
      baselineEvaluationId = baseline?.id || null;

      regressionDecision = evaluateRegressionAgainstBaseline({
        candidateReportJson: safeReportJson,
        baselineReportJson: baseline?.reportJson || null,
        policy: policyResolution.policy,
        baselineEvaluationId: baseline?.id || null,
      });
      gateDecision = mergeGateWithRegression(gateDecision, regressionDecision);
    }
  }

  const calibration_warnings = extractCalibrationWarnings(evaluation.reportJson);
  if (evaluation.status === "completed" && calibration_warnings.length > 0) {
    gateDecision = {
      ...gateDecision,
      notes: [
        ...(gateDecision.notes ?? []),
        `Warning: ${calibration_warnings.length} grader(s) are not yet calibrated. Gate decision may be unreliable.`,
      ],
    };
  }

  return {
    releaseMode,
    policyId: policyResolution.policyId,
    policySource: policyResolution.source,
    policyPath: policyResolution.policyPath,
    gate: gateDecision,
    regression: regressionDecision,
    baselineEvaluationId,
    calibration_warnings,
  };
}
