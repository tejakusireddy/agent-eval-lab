import { createHash, createHmac } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

import YAML from "yaml";

import { normalizeReportJson } from "@/app/_utils/report-json";
import { computeThreatCoverage } from "@/lib/threat-model";

export type GateStatus = "go" | "block" | "pending" | "unavailable";
export type ReleaseMode = "exploratory" | "release_candidate";

export interface ReleaseGatePolicy {
  version: number;
  name: string;
  fail_on: {
    min_safety_score: number;
    max_failed_critical: number;
    max_failed_minor: number;
  };
  required: {
    min_total_scenarios: number;
    required_tags: string[];
    required_scenario_ids: string[];
    required_threats: string[];
  };
  block: {
    forbidden_failure_reasons: string[];
    forbidden_scenario_prefixes: string[];
    max_failures_by_tag: Record<string, number>;
  };
  operational: {
    max_total_attempts: number;
    max_attempts_per_scenario: number;
    max_total_execution_time_ms: number;
    max_average_execution_time_ms: number;
    max_timeout_failures: number;
    max_provider_error_failures: number;
    required_metadata_keys: string[];
  };
  regression: {
    enabled: boolean;
    allow_if_no_baseline: boolean;
    require_same_scenario_set: boolean;
    max_safety_score_drop: number;
    max_failed_critical_increase: number;
    max_failed_minor_increase: number;
  };
  /** When true, forbidden-failure checks ignore violations that appear only on uncalibrated grader rows. */
  require_calibrated_graders: boolean;
}

interface GateDecisionMetrics {
  total: number;
  passed: number;
  failed_minor: number;
  failed_critical: number;
  safety_score: number;
  observed_tag_count: number;
  observed_scenario_count: number;
  total_attempts: number;
  max_attempts_per_scenario: number;
  total_execution_time_ms: number;
  average_execution_time_ms: number;
  timeout_failures: number;
  provider_error_failures: number;
  missing_required_metadata_scenarios: number;
}

export interface GateDecision {
  status: GateStatus;
  policyName: string | null;
  evaluatedAt: string;
  violations: string[];
  metrics: GateDecisionMetrics;
  reason?: string;
  /** Non-blocking notes (e.g. grader calibration warnings); do not affect status. */
  notes?: string[];
}

export interface RegressionDecision {
  status: "go" | "block" | "unavailable";
  evaluatedAt: string;
  enabled: boolean;
  baselineEvaluationId: string | null;
  violations: string[];
  metrics: {
    candidate_safety_score: number;
    baseline_safety_score: number;
    safety_score_drop: number;
    candidate_failed_critical: number;
    baseline_failed_critical: number;
    failed_critical_increase: number;
    candidate_failed_minor: number;
    baseline_failed_minor: number;
    failed_minor_increase: number;
    candidate_total: number;
    baseline_total: number;
    scenario_set_matches: boolean;
  };
  reason?: string;
}

export interface LoadedPolicy {
  policy: ReleaseGatePolicy | null;
  policyPath: string | null;
  error?: string;
}

export interface ScenarioCoverageItem {
  id: string;
  tags?: string[];
}

export interface ReleaseSelectionValidation {
  valid: boolean;
  violations: string[];
  observed: {
    total: number;
    tags: string[];
    scenario_ids: string[];
  };
}

interface EvidenceInput {
  evaluation: {
    id: string;
    name: string | null;
    status: string;
    createdAt: Date;
    completedAt: Date | null;
    config: unknown;
    configHash: string | null;
    scenarios: unknown;
    project: {
      id: string;
      name: string;
      organization: {
        id: string;
        name: string;
        clerkId: string;
      };
    };
  };
  policyPath: string | null;
  gateDecision: GateDecision;
  reportJson: unknown;
  evidenceSigning?: {
    key: string;
    keyId?: string | null;
  };
}

const DEFAULT_POLICY: ReleaseGatePolicy = {
  version: 1,
  name: "default",
  fail_on: {
    min_safety_score: 0,
    max_failed_critical: 0,
    max_failed_minor: Number.MAX_SAFE_INTEGER,
  },
  required: {
    min_total_scenarios: 1,
    required_tags: [],
    required_scenario_ids: [],
    required_threats: [],
  },
  block: {
    forbidden_failure_reasons: [],
    forbidden_scenario_prefixes: [],
    max_failures_by_tag: {},
  },
  operational: {
    max_total_attempts: Number.MAX_SAFE_INTEGER,
    max_attempts_per_scenario: Number.MAX_SAFE_INTEGER,
    max_total_execution_time_ms: Number.MAX_SAFE_INTEGER,
    max_average_execution_time_ms: Number.MAX_SAFE_INTEGER,
    max_timeout_failures: Number.MAX_SAFE_INTEGER,
    max_provider_error_failures: Number.MAX_SAFE_INTEGER,
    required_metadata_keys: [],
  },
  regression: {
    enabled: false,
    allow_if_no_baseline: true,
    require_same_scenario_set: true,
    max_safety_score_drop: Number.MAX_SAFE_INTEGER,
    max_failed_critical_increase: Number.MAX_SAFE_INTEGER,
    max_failed_minor_increase: Number.MAX_SAFE_INTEGER,
  },
  require_calibrated_graders: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "n"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

function toNumberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {};
  }

  const result: Record<string, number> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const parsed = toNumber(rawValue, Number.NaN);
    if (Number.isFinite(parsed) && parsed >= 0) {
      result[key] = parsed;
    }
  }
  return result;
}

function parsePolicy(raw: unknown): ReleaseGatePolicy {
  if (!isRecord(raw)) {
    throw new Error("Policy must be a YAML object at top level");
  }

  const failOn = isRecord(raw.fail_on) ? raw.fail_on : {};
  const required = isRecord(raw.required) ? raw.required : {};
  const block = isRecord(raw.block) ? raw.block : {};
  const operational = isRecord(raw.operational) ? raw.operational : {};
  const regression = isRecord(raw.regression) ? raw.regression : {};

  return {
    version: Math.max(1, Math.floor(toNumber(raw.version, DEFAULT_POLICY.version))),
    name: typeof raw.name === "string" ? raw.name : DEFAULT_POLICY.name,
    fail_on: {
      min_safety_score: Math.min(
        100,
        Math.max(0, toNumber(failOn.min_safety_score, DEFAULT_POLICY.fail_on.min_safety_score))
      ),
      max_failed_critical: Math.max(
        0,
        Math.floor(toNumber(failOn.max_failed_critical, DEFAULT_POLICY.fail_on.max_failed_critical))
      ),
      max_failed_minor: Math.max(
        0,
        Math.floor(toNumber(failOn.max_failed_minor, DEFAULT_POLICY.fail_on.max_failed_minor))
      ),
    },
    required: {
      min_total_scenarios: Math.max(
        1,
        Math.floor(toNumber(required.min_total_scenarios, DEFAULT_POLICY.required.min_total_scenarios))
      ),
      required_tags: toStringArray(required.required_tags),
      required_scenario_ids: toStringArray(required.required_scenario_ids),
      required_threats: toStringArray(required.required_threats),
    },
    block: {
      forbidden_failure_reasons: toStringArray(block.forbidden_failure_reasons),
      forbidden_scenario_prefixes: toStringArray(block.forbidden_scenario_prefixes),
      max_failures_by_tag: toNumberRecord(block.max_failures_by_tag),
    },
    operational: {
      max_total_attempts: Math.max(
        0,
        Math.floor(
          toNumber(operational.max_total_attempts, DEFAULT_POLICY.operational.max_total_attempts)
        )
      ),
      max_attempts_per_scenario: Math.max(
        0,
        Math.floor(
          toNumber(
            operational.max_attempts_per_scenario,
            DEFAULT_POLICY.operational.max_attempts_per_scenario
          )
        )
      ),
      max_total_execution_time_ms: Math.max(
        0,
        Math.floor(
          toNumber(
            operational.max_total_execution_time_ms,
            DEFAULT_POLICY.operational.max_total_execution_time_ms
          )
        )
      ),
      max_average_execution_time_ms: Math.max(
        0,
        Math.floor(
          toNumber(
            operational.max_average_execution_time_ms,
            DEFAULT_POLICY.operational.max_average_execution_time_ms
          )
        )
      ),
      max_timeout_failures: Math.max(
        0,
        Math.floor(
          toNumber(operational.max_timeout_failures, DEFAULT_POLICY.operational.max_timeout_failures)
        )
      ),
      max_provider_error_failures: Math.max(
        0,
        Math.floor(
          toNumber(
            operational.max_provider_error_failures,
            DEFAULT_POLICY.operational.max_provider_error_failures
          )
        )
      ),
      required_metadata_keys: toStringArray(operational.required_metadata_keys),
    },
    regression: {
      enabled: toBoolean(regression.enabled, DEFAULT_POLICY.regression.enabled),
      allow_if_no_baseline: toBoolean(
        regression.allow_if_no_baseline,
        DEFAULT_POLICY.regression.allow_if_no_baseline
      ),
      require_same_scenario_set: toBoolean(
        regression.require_same_scenario_set,
        DEFAULT_POLICY.regression.require_same_scenario_set
      ),
      max_safety_score_drop: Math.max(
        0,
        toNumber(regression.max_safety_score_drop, DEFAULT_POLICY.regression.max_safety_score_drop)
      ),
      max_failed_critical_increase: Math.max(
        0,
        Math.floor(
          toNumber(
            regression.max_failed_critical_increase,
            DEFAULT_POLICY.regression.max_failed_critical_increase
          )
        )
      ),
      max_failed_minor_increase: Math.max(
        0,
        Math.floor(
          toNumber(
            regression.max_failed_minor_increase,
            DEFAULT_POLICY.regression.max_failed_minor_increase
          )
        )
      ),
    },
    require_calibrated_graders: toBoolean(
      raw.require_calibrated_graders,
      DEFAULT_POLICY.require_calibrated_graders
    ),
  };
}

export function normalizeReleaseGatePolicy(raw: unknown): ReleaseGatePolicy {
  return parsePolicy(raw);
}

function collectFailureReasons(scenario: Record<string, unknown>): Set<string> {
  const reasons = new Set<string>();

  for (const reason of toStringArray(scenario.failure_reasons)) {
    reasons.add(reason);
  }

  const metadata = isRecord(scenario.metadata) ? scenario.metadata : null;
  if (metadata) {
    for (const reason of toStringArray(metadata.violations)) {
      reasons.add(reason);
    }
  }

  return reasons;
}

interface CalibrationFilterResult {
  rows: unknown[];
  total: number;
  calibrated: number;
  all_calibrated: boolean;
  none_calibrated: boolean;
}

function filterToCalibratedGraderResults(
  graderResults: unknown[],
  requireCalibrated: boolean
): CalibrationFilterResult {
  const total = graderResults.length;
  if (!requireCalibrated) {
    return {
      rows: graderResults,
      total,
      calibrated: total,
      all_calibrated: true,
      none_calibrated: false,
    };
  }

  const calibratedRows = graderResults.filter((r) => {
    if (!isRecord(r)) {
      return false;
    }
    const row = r as Record<string, unknown>;

    const cs = row.calibration_state;
    if (isRecord(cs)) {
      return cs.is_calibrated === true;
    }

    const meta = row.metadata;
    if (isRecord(meta)) {
      return meta.calibrated === true;
    }
    return false;
  });

  return {
    rows: calibratedRows,
    total,
    calibrated: calibratedRows.length,
    all_calibrated: calibratedRows.length === total,
    none_calibrated: calibratedRows.length === 0 && total > 0,
  };
}

/**
 * Evaluator failure reasons plus grader row violations. When
 * require_calibrated_graders is true, only violations from calibrated grader
 * No fallback to uncalibrated rows. If require_calibrated_graders=true and no calibrated rows exist, the gate returns unavailable upstream in evaluateReportAgainstPolicy(). This function only runs when calibrated rows are available or calibration is not required.
 */
function collectFailureReasonsForGate(
  scenario: Record<string, unknown>,
  policy: ReleaseGatePolicy
): Set<string> {
  const reasons = new Set<string>();
  for (const r of collectFailureReasons(scenario)) {
    reasons.add(r);
  }
  const gr = scenario.grader_results;
  if (!Array.isArray(gr) || gr.length === 0) {
    return reasons;
  }

  const filterResult = filterToCalibratedGraderResults(
    gr,
    policy.require_calibrated_graders
  );
  const graderRows = filterResult.rows;

  for (const item of graderRows) {
    if (!isRecord(item)) {
      continue;
    }
    for (const v of toStringArray((item as Record<string, unknown>).violations)) {
      reasons.add(v);
    }
  }
  return reasons;
}

function isScenarioFailure(scenario: Record<string, unknown>): boolean {
  const severity = scenario.severity;
  if (typeof severity === "string") {
    const normalized = severity.toUpperCase();
    if (normalized === "PASS") {
      return false;
    }
    if (normalized.startsWith("FAIL")) {
      return true;
    }
  }

  const status = scenario.status;
  if (typeof status === "string") {
    const normalized = status.toLowerCase();
    if (["success", "pass", "passed"].includes(normalized)) {
      return false;
    }
    if (["failure", "failed", "error"].includes(normalized)) {
      return true;
    }
  }

  return toNumber(scenario.score, 0) < 100;
}

function getScenarioMetadata(scenario: Record<string, unknown>): Record<string, unknown> | null {
  return isRecord(scenario.metadata) ? scenario.metadata : null;
}

function getScenarioId(scenario: Record<string, unknown>): string {
  if (typeof scenario.scenario_id === "string" && scenario.scenario_id) {
    return scenario.scenario_id;
  }
  return "unknown";
}

function getScenarioAttempt(scenario: Record<string, unknown>): number {
  const metadata = getScenarioMetadata(scenario);
  const attempt = toNumber(metadata?.attempt, 1);
  if (!Number.isFinite(attempt)) {
    return 1;
  }
  return Math.max(1, Math.floor(attempt));
}

function getScenarioExecutionTimeMs(scenario: Record<string, unknown>): number {
  const metadata = getScenarioMetadata(scenario);
  const candidates = [
    metadata?.execution_time_ms,
    scenario.execution_time_ms,
    metadata?.attempt_duration_ms,
  ];

  for (const candidate of candidates) {
    const parsed = toNumber(candidate, Number.NaN);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed);
    }
  }

  return 0;
}

function hasTimeoutSignal(scenario: Record<string, unknown>): boolean {
  const metadata = getScenarioMetadata(scenario);
  const texts: string[] = [];

  if (typeof metadata?.error_type === "string") {
    texts.push(metadata.error_type);
  }

  if (typeof scenario.reasoning === "string") {
    texts.push(scenario.reasoning);
  }

  for (const reason of toStringArray(scenario.failure_reasons)) {
    texts.push(reason);
  }

  const normalized = texts.join(" ").toLowerCase();
  return (
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("deadline exceeded")
  );
}

function hasProviderErrorSignal(scenario: Record<string, unknown>): boolean {
  const metadata = getScenarioMetadata(scenario);
  const texts: string[] = [];

  if (typeof metadata?.error_type === "string") {
    texts.push(metadata.error_type);
  }

  if (typeof scenario.reasoning === "string") {
    texts.push(scenario.reasoning);
  }

  for (const reason of toStringArray(scenario.failure_reasons)) {
    texts.push(reason);
  }

  const normalized = texts.join(" ").toLowerCase();
  return normalized.includes("providererror") || normalized.includes("provider error");
}

function createMetrics(summary: Record<string, unknown>, scenarios: Record<string, unknown>[]) {
  const total = Math.max(0, Math.floor(toNumber(summary.total, scenarios.length)));
  const passed = Math.max(0, Math.floor(toNumber(summary.passed, 0)));
  const failedMinor = Math.max(0, Math.floor(toNumber(summary.failed_minor, 0)));
  const failedCritical = Math.max(0, Math.floor(toNumber(summary.failed_critical, 0)));
  const safetyScore = Math.min(100, Math.max(0, toNumber(summary.safety_score, 0)));

  const observedTags = new Set<string>();
  const observedScenarioIds = new Set<string>();

  for (const scenario of scenarios) {
    for (const tag of toStringArray(scenario.tags)) {
      observedTags.add(tag);
    }
    if (typeof scenario.scenario_id === "string" && scenario.scenario_id) {
      observedScenarioIds.add(scenario.scenario_id);
    }
  }

  return {
    total,
    passed,
    failed_minor: failedMinor,
    failed_critical: failedCritical,
    safety_score: Number(safetyScore.toFixed(2)),
    observed_tag_count: observedTags.size,
    observed_scenario_count: observedScenarioIds.size,
  };
}

function computeOperationalMetrics(
  scenarios: Record<string, unknown>[],
  requiredMetadataKeys: string[]
): {
  metrics: Pick<
    GateDecisionMetrics,
    | "total_attempts"
    | "max_attempts_per_scenario"
    | "total_execution_time_ms"
    | "average_execution_time_ms"
    | "timeout_failures"
    | "provider_error_failures"
    | "missing_required_metadata_scenarios"
  >;
  missingMetadataByKey: Record<string, string[]>;
} {
  const normalizedRequiredKeys = Array.from(
    new Set(
      requiredMetadataKeys
        .map((key) => key.trim())
        .filter((key) => key.length > 0)
    )
  );

  const missingMetadataByKey: Record<string, string[]> = {};
  for (const key of normalizedRequiredKeys) {
    missingMetadataByKey[key] = [];
  }

  let totalAttempts = 0;
  let maxAttemptsPerScenario = 0;
  let totalExecutionTimeMs = 0;
  let timeoutFailures = 0;
  let providerErrorFailures = 0;
  const scenariosMissingAnyRequiredMetadata = new Set<string>();

  for (const scenario of scenarios) {
    const attempt = getScenarioAttempt(scenario);
    totalAttempts += attempt;
    maxAttemptsPerScenario = Math.max(maxAttemptsPerScenario, attempt);
    totalExecutionTimeMs += getScenarioExecutionTimeMs(scenario);

    if (isScenarioFailure(scenario)) {
      if (hasTimeoutSignal(scenario)) {
        timeoutFailures += 1;
      } else if (hasProviderErrorSignal(scenario) || typeof getScenarioMetadata(scenario)?.error_type === "string") {
        providerErrorFailures += 1;
      }
    }

    const metadata = getScenarioMetadata(scenario);
    const scenarioId = getScenarioId(scenario);
    for (const key of normalizedRequiredKeys) {
      const value = metadata?.[key];
      const missing =
        value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim().length === 0);
      if (missing) {
        missingMetadataByKey[key].push(scenarioId);
        scenariosMissingAnyRequiredMetadata.add(scenarioId);
      }
    }
  }

  const averageExecutionTimeMs =
    scenarios.length > 0 ? totalExecutionTimeMs / scenarios.length : 0;

  return {
    metrics: {
      total_attempts: totalAttempts,
      max_attempts_per_scenario: maxAttemptsPerScenario,
      total_execution_time_ms: totalExecutionTimeMs,
      average_execution_time_ms: Number(averageExecutionTimeMs.toFixed(2)),
      timeout_failures: timeoutFailures,
      provider_error_failures: providerErrorFailures,
      missing_required_metadata_scenarios: scenariosMissingAnyRequiredMetadata.size,
    },
    missingMetadataByKey,
  };
}

function createEmptyMetrics(): GateDecisionMetrics {
  return {
    total: 0,
    passed: 0,
    failed_minor: 0,
    failed_critical: 0,
    safety_score: 0,
    observed_tag_count: 0,
    observed_scenario_count: 0,
    total_attempts: 0,
    max_attempts_per_scenario: 0,
    total_execution_time_ms: 0,
    average_execution_time_ms: 0,
    timeout_failures: 0,
    provider_error_failures: 0,
    missing_required_metadata_scenarios: 0,
  };
}

export function createPendingGateDecision(policyName: string | null = null): GateDecision {
  return {
    status: "pending",
    policyName,
    evaluatedAt: new Date().toISOString(),
    violations: [],
    metrics: createEmptyMetrics(),
    reason: "Evaluation has not completed yet",
  };
}

export function createUnavailableGateDecision(
  reason: string,
  policyName: string | null = null
): GateDecision {
  return {
    status: "unavailable",
    policyName,
    evaluatedAt: new Date().toISOString(),
    violations: [],
    metrics: createEmptyMetrics(),
    reason,
  };
}

export function getReleaseMode(config: unknown): ReleaseMode {
  if (!isRecord(config)) {
    return "exploratory";
  }

  const raw = config.release_mode;
  if (raw === "release_candidate") {
    return "release_candidate";
  }

  return "exploratory";
}

export function isReleaseCandidate(config: unknown): boolean {
  return getReleaseMode(config) === "release_candidate";
}

export function findDefaultPolicyPath(): string | null {
  const candidates = [
    join(process.cwd(), "..", "policy", "release_gate.enterprise.yaml"),
    join(process.cwd(), "policy", "release_gate.enterprise.yaml"),
    join(process.cwd(), "..", "..", "policy", "release_gate.enterprise.yaml"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function loadReleaseGatePolicy(policyPath?: string): LoadedPolicy {
  const resolvedPath = policyPath || findDefaultPolicyPath();
  if (!resolvedPath) {
    return {
      policy: null,
      policyPath: null,
      error: "release gate policy file not found",
    };
  }

  try {
    const raw = readFileSync(resolvedPath, "utf-8");
    const parsed = YAML.parse(raw);
    return {
      policy: parsePolicy(parsed),
      policyPath: resolvedPath,
    };
  } catch (error: any) {
    return {
      policy: null,
      policyPath: resolvedPath,
      error: error?.message || "failed to parse release gate policy",
    };
  }
}

export function evaluateReportAgainstPolicy(
  reportJson: unknown,
  policy: ReleaseGatePolicy
): GateDecision {
  const normalized = normalizeReportJson(reportJson);
  if (!isRecord(normalized)) {
    return createUnavailableGateDecision("evaluation report JSON is missing or invalid", policy.name);
  }

  const summary = isRecord(normalized.summary) ? normalized.summary : {};
  const scenarios = Array.isArray(normalized.scenarios)
    ? normalized.scenarios.filter((entry): entry is Record<string, unknown> => isRecord(entry))
    : [];

  let calibrationFilteredTotal = 0;
  let calibrationFilteredCalibrated = 0;
  for (const scenario of scenarios) {
    const gr = scenario.grader_results;
    if (!Array.isArray(gr)) {
      continue;
    }
    const filterResult = filterToCalibratedGraderResults(
      gr,
      policy.require_calibrated_graders
    );
    if (policy.require_calibrated_graders && filterResult.none_calibrated) {
      return createUnavailableGateDecision(
        "require_calibrated_graders is enabled but no calibrated grader results exist for this evaluation. Run calibration (150+ labeled traces at 85%+ agreement) before using release gate with calibration enforcement.",
        policy.name
      );
    }
    calibrationFilteredTotal += filterResult.total;
    calibrationFilteredCalibrated += filterResult.calibrated;

  }

  const baseMetrics = createMetrics(summary, scenarios);
  const operational = computeOperationalMetrics(
    scenarios,
    policy.operational.required_metadata_keys
  );
  const metrics: GateDecisionMetrics = {
    ...baseMetrics,
    ...operational.metrics,
  };
  const violations: string[] = [];

  if (metrics.safety_score < policy.fail_on.min_safety_score) {
    violations.push(
      `safety_score below threshold (${metrics.safety_score.toFixed(2)} < ${policy.fail_on.min_safety_score.toFixed(2)})`
    );
  }

  if (metrics.failed_critical > policy.fail_on.max_failed_critical) {
    violations.push(
      `failed_critical above threshold (${metrics.failed_critical} > ${policy.fail_on.max_failed_critical})`
    );
  }

  if (metrics.failed_minor > policy.fail_on.max_failed_minor) {
    violations.push(
      `failed_minor above threshold (${metrics.failed_minor} > ${policy.fail_on.max_failed_minor})`
    );
  }

  if (metrics.total < policy.required.min_total_scenarios) {
    violations.push(
      `insufficient scenario coverage (${metrics.total} < ${policy.required.min_total_scenarios})`
    );
  }

  if (metrics.total_attempts > policy.operational.max_total_attempts) {
    violations.push(
      `total_attempts above threshold (${metrics.total_attempts} > ${policy.operational.max_total_attempts})`
    );
  }

  if (metrics.max_attempts_per_scenario > policy.operational.max_attempts_per_scenario) {
    violations.push(
      `max_attempts_per_scenario above threshold (${metrics.max_attempts_per_scenario} > ${policy.operational.max_attempts_per_scenario})`
    );
  }

  if (metrics.total_execution_time_ms > policy.operational.max_total_execution_time_ms) {
    violations.push(
      `total_execution_time_ms above threshold (${metrics.total_execution_time_ms} > ${policy.operational.max_total_execution_time_ms})`
    );
  }

  if (metrics.average_execution_time_ms > policy.operational.max_average_execution_time_ms) {
    violations.push(
      `average_execution_time_ms above threshold (${metrics.average_execution_time_ms.toFixed(2)} > ${policy.operational.max_average_execution_time_ms})`
    );
  }

  if (metrics.timeout_failures > policy.operational.max_timeout_failures) {
    violations.push(
      `timeout_failures above threshold (${metrics.timeout_failures} > ${policy.operational.max_timeout_failures})`
    );
  }

  if (metrics.provider_error_failures > policy.operational.max_provider_error_failures) {
    violations.push(
      `provider_error_failures above threshold (${metrics.provider_error_failures} > ${policy.operational.max_provider_error_failures})`
    );
  }

  for (const [key, missingScenarioIds] of Object.entries(operational.missingMetadataByKey)) {
    if (missingScenarioIds.length > 0) {
      const preview = Array.from(new Set(missingScenarioIds)).slice(0, 5).join(", ");
      violations.push(
        `missing required metadata key '${key}' in ${missingScenarioIds.length} scenario(s): ${preview}`
      );
    }
  }

  const observedTags = new Set<string>();
  const observedScenarioIds = new Set<string>();

  for (const scenario of scenarios) {
    const scenarioId =
      typeof scenario.scenario_id === "string" ? scenario.scenario_id : "";
    const prefix = scenarioId.split(".")[0];
    if (prefix) {
      observedTags.add(normalizeTag(prefix));
    }

    for (const tag of toStringArray(scenario.tags)) {
      observedTags.add(normalizeTag(tag));
    }
    if (scenarioId) {
      observedScenarioIds.add(scenarioId);
    }
  }

  for (const requiredTag of policy.required.required_tags) {
    if (!observedTags.has(normalizeTag(requiredTag))) {
      violations.push(`missing required tag coverage: ${requiredTag}`);
    }
  }

  for (const requiredScenarioId of policy.required.required_scenario_ids) {
    if (!observedScenarioIds.has(requiredScenarioId)) {
      violations.push(`missing required scenario id: ${requiredScenarioId}`);
    }
  }

  if (policy.required.required_threats.length > 0) {
    const threatCoverage = computeThreatCoverage({
      scenarioCatalog: scenarios.map((scenario) => ({
        id:
          typeof scenario.scenario_id === "string" && scenario.scenario_id.trim().length > 0
            ? scenario.scenario_id
            : "unknown",
        tags: toStringArray(scenario.tags),
        attack_type:
          typeof scenario.attack_type === "string" ? scenario.attack_type : null,
      })),
      selectedScenarioIds: Array.from(observedScenarioIds),
      requiredThreatIds: policy.required.required_threats,
    });

    for (const missingThreatId of threatCoverage.missingRequiredThreatIds) {
      const threat = threatCoverage.threats.find((entry) => entry.threatId === missingThreatId);
      const label = threat ? `${threat.title} (${missingThreatId})` : missingThreatId;
      violations.push(`missing required threat coverage: ${label}`);
    }
  }

  const forbiddenReasons = new Set(policy.block.forbidden_failure_reasons);
  for (const scenario of scenarios) {
    const scenarioId = typeof scenario.scenario_id === "string" ? scenario.scenario_id : "unknown";
    for (const reason of collectFailureReasonsForGate(scenario, policy)) {
      if (forbiddenReasons.has(reason)) {
        violations.push(`forbidden failure reason '${reason}' observed in scenario ${scenarioId}`);
      }
    }
  }

  for (const prefix of policy.block.forbidden_scenario_prefixes) {
    for (const scenario of scenarios) {
      const scenarioId = typeof scenario.scenario_id === "string" ? scenario.scenario_id : "";
      if (scenarioId.startsWith(prefix) && isScenarioFailure(scenario)) {
        violations.push(`forbidden scenario prefix failed: ${prefix} (scenario ${scenarioId})`);
      }
    }
  }

  for (const [tag, maxFailures] of Object.entries(policy.block.max_failures_by_tag)) {
    const failures = scenarios.filter((scenario) => {
      const scenarioId =
        typeof scenario.scenario_id === "string" ? scenario.scenario_id : "";
      const prefix = scenarioId.split(".")[0];
      const tags = new Set(
        toStringArray(scenario.tags).map((entry) => normalizeTag(entry))
      );
      if (prefix) {
        tags.add(normalizeTag(prefix));
      }
      return tags.has(normalizeTag(tag)) && isScenarioFailure(scenario);
    }).length;

    if (failures > maxFailures) {
      violations.push(`tag '${tag}' failures above threshold (${failures} > ${maxFailures})`);
    }
  }

  const calibrationFilterNote =
    policy.require_calibrated_graders &&
    calibrationFilteredTotal > 0 &&
    calibrationFilteredCalibrated < calibrationFilteredTotal
      ? `Calibration filter: using ${calibrationFilteredCalibrated} of ${calibrationFilteredTotal} grader results. ${calibrationFilteredTotal - calibrationFilteredCalibrated} uncalibrated graders excluded.`
      : null;

  return {
    status: violations.length === 0 ? "go" : "block",
    policyName: policy.name,
    evaluatedAt: new Date().toISOString(),
    violations,
    metrics,
    ...(calibrationFilterNote ? { notes: [calibrationFilterNote] } : {}),
  };
}

function extractScenarioIdsFromReport(report: Record<string, unknown>): Set<string> {
  const scenarios = Array.isArray(report.scenarios)
    ? report.scenarios.filter((entry): entry is Record<string, unknown> => isRecord(entry))
    : [];
  const ids = new Set<string>();
  for (const scenario of scenarios) {
    if (typeof scenario.scenario_id === "string" && scenario.scenario_id.trim().length > 0) {
      ids.add(scenario.scenario_id.trim());
    }
  }
  return ids;
}

function createEmptyRegressionMetrics(): RegressionDecision["metrics"] {
  return {
    candidate_safety_score: 0,
    baseline_safety_score: 0,
    safety_score_drop: 0,
    candidate_failed_critical: 0,
    baseline_failed_critical: 0,
    failed_critical_increase: 0,
    candidate_failed_minor: 0,
    baseline_failed_minor: 0,
    failed_minor_increase: 0,
    candidate_total: 0,
    baseline_total: 0,
    scenario_set_matches: true,
  };
}

interface RegressionEvaluationInput {
  candidateReportJson: unknown;
  baselineReportJson: unknown | null;
  policy: ReleaseGatePolicy;
  baselineEvaluationId?: string | null;
}

export function evaluateRegressionAgainstBaseline({
  candidateReportJson,
  baselineReportJson,
  policy,
  baselineEvaluationId = null,
}: RegressionEvaluationInput): RegressionDecision {
  if (!policy.regression.enabled) {
    return {
      status: "unavailable",
      evaluatedAt: new Date().toISOString(),
      enabled: false,
      baselineEvaluationId,
      violations: [],
      metrics: createEmptyRegressionMetrics(),
      reason: "Regression checks are disabled in policy",
    };
  }

  const normalizedCandidate = normalizeReportJson(candidateReportJson);
  if (!isRecord(normalizedCandidate)) {
    return {
      status: "unavailable",
      evaluatedAt: new Date().toISOString(),
      enabled: true,
      baselineEvaluationId,
      violations: [],
      metrics: createEmptyRegressionMetrics(),
      reason: "Candidate report JSON is missing or invalid",
    };
  }

  if (!baselineReportJson) {
    if (policy.regression.allow_if_no_baseline) {
      return {
        status: "go",
        evaluatedAt: new Date().toISOString(),
        enabled: true,
        baselineEvaluationId: null,
        violations: [],
        metrics: createEmptyRegressionMetrics(),
        reason: "No baseline evaluation found; allowed by policy",
      };
    }

    return {
      status: "block",
      evaluatedAt: new Date().toISOString(),
      enabled: true,
      baselineEvaluationId: null,
      violations: ["baseline evaluation required but not found"],
      metrics: createEmptyRegressionMetrics(),
      reason: "No baseline evaluation found",
    };
  }

  const normalizedBaseline = normalizeReportJson(baselineReportJson);
  if (!isRecord(normalizedBaseline)) {
    return {
      status: "block",
      evaluatedAt: new Date().toISOString(),
      enabled: true,
      baselineEvaluationId,
      violations: ["baseline report JSON is missing or invalid"],
      metrics: createEmptyRegressionMetrics(),
      reason: "Baseline report JSON is missing or invalid",
    };
  }

  const candidateSummary = isRecord(normalizedCandidate.summary) ? normalizedCandidate.summary : {};
  const baselineSummary = isRecord(normalizedBaseline.summary) ? normalizedBaseline.summary : {};

  const candidateSafety = Math.min(100, Math.max(0, toNumber(candidateSummary.safety_score, 0)));
  const baselineSafety = Math.min(100, Math.max(0, toNumber(baselineSummary.safety_score, 0)));
  const candidateFailedCritical = Math.max(
    0,
    Math.floor(toNumber(candidateSummary.failed_critical, 0))
  );
  const baselineFailedCritical = Math.max(
    0,
    Math.floor(toNumber(baselineSummary.failed_critical, 0))
  );
  const candidateFailedMinor = Math.max(
    0,
    Math.floor(toNumber(candidateSummary.failed_minor, 0))
  );
  const baselineFailedMinor = Math.max(
    0,
    Math.floor(toNumber(baselineSummary.failed_minor, 0))
  );
  const candidateTotal = Math.max(0, Math.floor(toNumber(candidateSummary.total, 0)));
  const baselineTotal = Math.max(0, Math.floor(toNumber(baselineSummary.total, 0)));

  const safetyScoreDrop = Number((baselineSafety - candidateSafety).toFixed(2));
  const failedCriticalIncrease = candidateFailedCritical - baselineFailedCritical;
  const failedMinorIncrease = candidateFailedMinor - baselineFailedMinor;

  const candidateScenarioIds = extractScenarioIdsFromReport(normalizedCandidate);
  const baselineScenarioIds = extractScenarioIdsFromReport(normalizedBaseline);

  const scenarioSetMatches =
    candidateScenarioIds.size === baselineScenarioIds.size &&
    Array.from(candidateScenarioIds).every((id) => baselineScenarioIds.has(id));

  const metrics: RegressionDecision["metrics"] = {
    candidate_safety_score: Number(candidateSafety.toFixed(2)),
    baseline_safety_score: Number(baselineSafety.toFixed(2)),
    safety_score_drop: Number(safetyScoreDrop.toFixed(2)),
    candidate_failed_critical: candidateFailedCritical,
    baseline_failed_critical: baselineFailedCritical,
    failed_critical_increase: failedCriticalIncrease,
    candidate_failed_minor: candidateFailedMinor,
    baseline_failed_minor: baselineFailedMinor,
    failed_minor_increase: failedMinorIncrease,
    candidate_total: candidateTotal,
    baseline_total: baselineTotal,
    scenario_set_matches: scenarioSetMatches,
  };

  const violations: string[] = [];

  if (policy.regression.require_same_scenario_set && !scenarioSetMatches) {
    violations.push("candidate and baseline scenario sets do not match");
  }

  if (safetyScoreDrop > policy.regression.max_safety_score_drop) {
    violations.push(
      `safety_score drop above threshold (${safetyScoreDrop.toFixed(2)} > ${policy.regression.max_safety_score_drop.toFixed(2)})`
    );
  }

  if (failedCriticalIncrease > policy.regression.max_failed_critical_increase) {
    violations.push(
      `failed_critical increase above threshold (${failedCriticalIncrease} > ${policy.regression.max_failed_critical_increase})`
    );
  }

  if (failedMinorIncrease > policy.regression.max_failed_minor_increase) {
    violations.push(
      `failed_minor increase above threshold (${failedMinorIncrease} > ${policy.regression.max_failed_minor_increase})`
    );
  }

  return {
    status: violations.length === 0 ? "go" : "block",
    evaluatedAt: new Date().toISOString(),
    enabled: true,
    baselineEvaluationId,
    violations,
    metrics,
  };
}

export function mergeGateWithRegression(
  gateDecision: GateDecision,
  regressionDecision: RegressionDecision | null
): GateDecision {
  if (!regressionDecision || regressionDecision.status !== "block") {
    return gateDecision;
  }

  const regressionViolations = regressionDecision.violations.map(
    (violation) => `regression: ${violation}`
  );

  return {
    ...gateDecision,
    status: "block",
    violations: [...gateDecision.violations, ...regressionViolations],
  };
}

export function validateReleaseCandidateSelection(
  selectedScenarioIds: string[],
  scenarioCatalog: ScenarioCoverageItem[],
  policy: ReleaseGatePolicy
): ReleaseSelectionValidation {
  const violations: string[] = [];
  const catalogById = new Map<string, ScenarioCoverageItem>();
  for (const scenario of scenarioCatalog) {
    catalogById.set(scenario.id, scenario);
  }

  const uniqueSelected = Array.from(new Set(selectedScenarioIds));
  const selectedScenarios: ScenarioCoverageItem[] = [];
  const missingScenarioDefs: string[] = [];

  for (const scenarioId of uniqueSelected) {
    const scenario = catalogById.get(scenarioId);
    if (scenario) {
      selectedScenarios.push(scenario);
    } else {
      missingScenarioDefs.push(scenarioId);
    }
  }

  if (missingScenarioDefs.length > 0) {
    violations.push(
      `selected scenarios not found in registry: ${missingScenarioDefs.join(", ")}`
    );
  }

  if (selectedScenarios.length < policy.required.min_total_scenarios) {
    violations.push(
      `release candidate requires at least ${policy.required.min_total_scenarios} scenarios`
    );
  }

  const observedTags = new Set<string>();
  const observedScenarioIds = new Set<string>();

  for (const scenario of selectedScenarios) {
    observedScenarioIds.add(scenario.id);

    const prefix = scenario.id.split(".")[0];
    if (prefix) {
      observedTags.add(normalizeTag(prefix));
    }

    const tags = scenario.tags || [];
    for (const tag of tags) {
      observedTags.add(normalizeTag(tag));
    }
  }

  for (const requiredTag of policy.required.required_tags) {
    if (!observedTags.has(normalizeTag(requiredTag))) {
      violations.push(`missing required tag coverage: ${requiredTag}`);
    }
  }

  for (const requiredScenarioId of policy.required.required_scenario_ids) {
    if (!observedScenarioIds.has(requiredScenarioId)) {
      violations.push(`missing required scenario id: ${requiredScenarioId}`);
    }
  }

  if (policy.required.required_threats.length > 0) {
    const threatCoverage = computeThreatCoverage({
      scenarioCatalog: selectedScenarios.map((scenario) => ({
        id: scenario.id,
        tags: scenario.tags || [],
      })),
      selectedScenarioIds: selectedScenarios.map((scenario) => scenario.id),
      requiredThreatIds: policy.required.required_threats,
    });

    for (const missingThreatId of threatCoverage.missingRequiredThreatIds) {
      const threat = threatCoverage.threats.find((entry) => entry.threatId === missingThreatId);
      const label = threat ? `${threat.title} (${missingThreatId})` : missingThreatId;
      const recommendation =
        threat && threat.recommendedToAdd.length > 0
          ? `; recommended scenarios: ${threat.recommendedToAdd.join(", ")}`
          : "";
      violations.push(`missing required threat coverage: ${label}${recommendation}`);
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    observed: {
      total: selectedScenarios.length,
      tags: Array.from(observedTags).sort(),
      scenario_ids: Array.from(observedScenarioIds).sort(),
    },
  };
}

export function buildAuditEvidencePack({
  evaluation,
  policyPath,
  gateDecision,
  reportJson,
  evidenceSigning,
}: EvidenceInput): Record<string, unknown> {
  const releasePolicy =
    isRecord(evaluation.config) && isRecord((evaluation.config as any).release_policy)
      ? ((evaluation.config as any).release_policy as Record<string, unknown>)
      : null;

  const normalizedReport = normalizeReportJson(reportJson);
  const canonicalReport =
    normalizedReport && typeof normalizedReport === "object"
      ? JSON.stringify(normalizedReport)
      : "";

  const reportSha256 = canonicalReport
    ? createHash("sha256").update(canonicalReport).digest("hex")
    : null;

  const summary =
    normalizedReport && typeof normalizedReport === "object"
      ? (normalizedReport as any).summary || null
      : null;

  const hashScope = {
    schema_version: "1.0",
    generated_at: new Date().toISOString(),
    evaluation: {
      id: evaluation.id,
      name: evaluation.name,
      status: evaluation.status,
      created_at: evaluation.createdAt,
      completed_at: evaluation.completedAt,
      project: {
        id: evaluation.project.id,
        name: evaluation.project.name,
      },
      organization: {
        id: evaluation.project.organization.id,
        name: evaluation.project.organization.name,
        clerk_id: evaluation.project.organization.clerkId,
      },
      scenarios: Array.isArray(evaluation.scenarios) ? evaluation.scenarios : [],
      config: evaluation.config,
      config_hash: evaluation.configHash,
    },
    release_gate: {
      policy_path: policyPath,
      policy_name: gateDecision.policyName,
      policy_id:
        releasePolicy && typeof releasePolicy.version_id === "string"
          ? releasePolicy.version_id
          : null,
      policy_version:
        releasePolicy && typeof releasePolicy.version === "number"
          ? releasePolicy.version
          : null,
      decision: gateDecision.status,
      evaluated_at: gateDecision.evaluatedAt,
      reason: gateDecision.reason || null,
      violations: gateDecision.violations,
      metrics: gateDecision.metrics,
    },
    report_integrity: {
      report_sha256: reportSha256,
      summary,
    },
    report_snapshot: normalizedReport,
  };

  const canonicalEvidence = JSON.stringify(hashScope);
  const evidenceSha256 = createHash("sha256").update(canonicalEvidence).digest("hex");
  const signature =
    evidenceSigning?.key
      ? {
          algorithm: "hmac-sha256",
          key_id: evidenceSigning.keyId || null,
          value: createHmac("sha256", evidenceSigning.key)
            .update(evidenceSha256)
            .digest("hex"),
        }
      : null;

  return {
    ...hashScope,
    report_integrity: {
      report_sha256: reportSha256,
      evidence_sha256: evidenceSha256,
      signature,
      summary,
    },
  };
}

export function computeEvidenceSha256(
  evidencePack: Record<string, unknown>
): string {
  const reportIntegrity = isRecord(evidencePack.report_integrity)
    ? evidencePack.report_integrity
    : {};
  const baseForHash = {
    schema_version: evidencePack.schema_version ?? null,
    generated_at: evidencePack.generated_at ?? null,
    evaluation: evidencePack.evaluation ?? null,
    release_gate: evidencePack.release_gate ?? null,
    report_integrity: {
      report_sha256: reportIntegrity.report_sha256 ?? null,
      summary: reportIntegrity.summary ?? null,
    },
    report_snapshot: evidencePack.report_snapshot ?? null,
  };
  return createHash("sha256").update(JSON.stringify(baseForHash)).digest("hex");
}

export function verifyEvidencePackSignature(
  evidencePack: Record<string, unknown>,
  signingKey: string | null
): {
  hashValid: boolean;
  signatureChecked: boolean;
  signatureValid: boolean;
  expectedEvidenceSha256: string;
  providedEvidenceSha256: string | null;
  keyId: string | null;
} {
  const reportIntegrity = isRecord(evidencePack.report_integrity)
    ? evidencePack.report_integrity
    : {};
  const providedEvidenceSha256 =
    typeof reportIntegrity.evidence_sha256 === "string"
      ? reportIntegrity.evidence_sha256
      : null;
  const expectedEvidenceSha256 = computeEvidenceSha256(evidencePack);
  const hashValid =
    typeof providedEvidenceSha256 === "string" &&
    providedEvidenceSha256 === expectedEvidenceSha256;

  const signature = isRecord(reportIntegrity.signature)
    ? reportIntegrity.signature
    : null;
  const signatureValue =
    signature && typeof signature.value === "string" ? signature.value : null;
  const keyId =
    signature && typeof signature.key_id === "string" ? signature.key_id : null;

  if (!signingKey || !signatureValue) {
    return {
      hashValid,
      signatureChecked: false,
      signatureValid: false,
      expectedEvidenceSha256,
      providedEvidenceSha256,
      keyId,
    };
  }

  const expectedSignature = createHmac("sha256", signingKey)
    .update(expectedEvidenceSha256)
    .digest("hex");
  const signatureValid = signatureValue === expectedSignature;

  return {
    hashValid,
    signatureChecked: true,
    signatureValid,
    expectedEvidenceSha256,
    providedEvidenceSha256,
    keyId,
  };
}
