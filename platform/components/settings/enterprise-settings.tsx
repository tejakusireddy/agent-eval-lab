"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  Shield,
  BellRing,
  FileClock,
  KeyRound,
  BarChart3,
  Copy,
  Ban,
  Wand2,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/surface";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatStatusLabel, humanizeLabel } from "@/lib/formatting";

interface PolicyRequirements {
  min_total_scenarios: number;
  required_tags: string[];
  required_scenario_ids: string[];
  required_threats: string[];
}

interface PolicyFailOn {
  min_safety_score: number;
  max_failed_critical: number;
  max_failed_minor: number;
}

interface PolicyBlock {
  forbidden_failure_reasons: string[];
  forbidden_scenario_prefixes: string[];
  max_failures_by_tag: Record<string, number>;
}

interface PolicyOperational {
  max_total_attempts: number;
  max_attempts_per_scenario: number;
  max_total_execution_time_ms: number;
  max_average_execution_time_ms: number;
  max_timeout_failures: number;
  max_provider_error_failures: number;
  required_metadata_keys: string[];
}

interface PolicyRegression {
  enabled: boolean;
  allow_if_no_baseline: boolean;
  require_same_scenario_set: boolean;
  max_safety_score_drop: number;
  max_failed_critical_increase: number;
  max_failed_minor_increase: number;
}

interface ActivePolicy {
  id: string;
  name: string;
  version: number;
  fail_on: PolicyFailOn;
  required: PolicyRequirements;
  block: PolicyBlock;
  operational: PolicyOperational;
  regression: PolicyRegression;
}

interface PolicySummary {
  id: string;
  name: string;
  version: number;
  created_at: string;
  created_by: string | null;
  notes: string | null;
}

interface PolicyApiResponse {
  available: boolean;
  activePolicyId?: string | null;
  policy?: ActivePolicy;
  policies?: PolicySummary[];
  access?: { role: string };
  error?: string;
}

interface PolicyPackItem {
  id: string;
  title: string;
  description: string;
  notes: string;
  requiredThreats: string[];
  recommendedScenarioIds: string[];
}

interface PolicyPacksResponse {
  success: boolean;
  packs?: PolicyPackItem[];
  error?: string;
}

interface AuditEventItem {
  id: string;
  eventId: string;
  eventType: string;
  severity: string;
  title: string;
  lines: unknown;
  payloadSha256: string;
  signatureAlgorithm: string | null;
  signatureKeyId: string | null;
  signaturePreview: string | null;
  deliveryStatus: unknown;
  createdAt: string;
}

interface AuditApiResponse {
  success: boolean;
  total: number;
  events: AuditEventItem[];
  access?: { role: string };
  error?: string;
}

interface ApiKeyItem {
  id: string;
  name: string;
  prefix: string;
  role: string;
  scopes: string[];
  createdBy: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface ApiKeysApiResponse {
  success: boolean;
  keys?: ApiKeyItem[];
  apiKey?: ApiKeyItem;
  secret?: string;
  error?: string;
}

interface DailyUsageItem {
  date: string;
  evaluationsRequested: number;
  evaluationsCompleted: number;
  scenariosRequested: number;
}

interface UsageDailyResponse {
  success: boolean;
  usage?: DailyUsageItem[];
  limit?: {
    dailyEvaluations: number;
  };
  error?: string;
}

interface DriftSignalItem {
  code: string;
  severity: "warning" | "critical";
  message: string;
  actual: number;
  threshold: number;
}

interface DriftWindowMetrics {
  evaluations: number;
  avgSafetyScore: number;
  avgFailedCritical: number;
  avgFailedMinor: number;
  passRate: number;
}

interface DriftTrendPoint {
  date: string;
  evaluations: number;
  avgSafetyScore: number;
  avgFailedCritical: number;
  avgFailedMinor: number;
}

interface DriftReportPayload {
  generatedAt: string;
  sampleSizes: {
    total: number;
    baseline: number;
    current: number;
  };
  windows: {
    baseline: DriftWindowMetrics;
    current: DriftWindowMetrics;
  };
  deltas: {
    safetyScore: number;
    failedCritical: number;
    failedMinor: number;
    passRate: number;
  };
  drift: {
    detected: boolean;
    severity: "info" | "warning" | "critical";
    status: "insufficient_data" | "ok" | "drift_detected";
    signals: DriftSignalItem[];
  };
  trend: DriftTrendPoint[];
}

interface DriftApiResponse {
  success: boolean;
  report?: DriftReportPayload;
  error?: string;
}

interface AdversarialThreatItem {
  id: string;
  title: string;
  description: string;
  recommendedScenarioIds: string[];
}

interface AdversarialGeneratedItem {
  id: string;
  name: string;
  attack_type: string;
  tags: string[];
  severity_expectation: string;
  prompt_template: string;
  yaml: string;
}

interface AdversarialGenerateResponse {
  success: boolean;
  generated?: AdversarialGeneratedItem[];
  generatedCount?: number;
  persisted?: {
    requested: boolean;
    count: number;
    files: string[];
    warning: string | null;
  };
  threats?: AdversarialThreatItem[];
  defaults?: {
    count: number;
    intensity: "low" | "medium" | "high";
    idPrefix: string;
    persist: boolean;
  };
  error?: string;
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function formatLines(lines: unknown): string {
  if (!Array.isArray(lines)) {
    return "";
  }
  return lines
    .map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
    .join(" ");
}

export function EnterpriseSettings() {
  const { addToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [role, setRole] = useState("unknown");

  const [activePolicyId, setActivePolicyId] = useState<string>("");
  const [activePolicy, setActivePolicy] = useState<ActivePolicy | null>(null);
  const [policies, setPolicies] = useState<PolicySummary[]>([]);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [policyPacks, setPolicyPacks] = useState<PolicyPackItem[]>([]);
  const [selectedPolicyPackId, setSelectedPolicyPackId] = useState("");
  const [policyPackLoading, setPolicyPackLoading] = useState(false);

  const [auditEvents, setAuditEvents] = useState<AuditEventItem[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [apiKeysError, setApiKeysError] = useState<string | null>(null);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [newKeyName, setNewKeyName] = useState("CI Release Key");
  const [newKeyRole, setNewKeyRole] = useState("release_manager");
  const [newKeyScopes, setNewKeyScopes] = useState("evaluate:run, evaluate:read, usage:read");
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null);
  const [usageRows, setUsageRows] = useState<DailyUsageItem[]>([]);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [dailyLimit, setDailyLimit] = useState<number>(50);
  const [driftReport, setDriftReport] = useState<DriftReportPayload | null>(null);
  const [driftError, setDriftError] = useState<string | null>(null);
  const [driftLoading, setDriftLoading] = useState(false);
  const [driftRunLoading, setDriftRunLoading] = useState(false);
  const [driftLookbackDays, setDriftLookbackDays] = useState(30);
  const [driftWindowDays, setDriftWindowDays] = useState(7);
  const [driftMinSamples, setDriftMinSamples] = useState(3);
  const [driftSafetyDropThreshold, setDriftSafetyDropThreshold] = useState(5);
  const [driftCriticalIncreaseThreshold, setDriftCriticalIncreaseThreshold] = useState(1);
  const [driftMinimumSafetyScore, setDriftMinimumSafetyScore] = useState(80);
  const [driftNotifyOnNoDrift, setDriftNotifyOnNoDrift] = useState(false);
  const [adversarialThreats, setAdversarialThreats] = useState<AdversarialThreatItem[]>([]);
  const [adversarialThreatId, setAdversarialThreatId] = useState("security_surface_expansion");
  const [adversarialDomain, setAdversarialDomain] = useState("general");
  const [adversarialCount, setAdversarialCount] = useState(3);
  const [adversarialIntensity, setAdversarialIntensity] = useState<"low" | "medium" | "high">(
    "medium"
  );
  const [adversarialPersist, setAdversarialPersist] = useState(false);
  const [adversarialLoading, setAdversarialLoading] = useState(false);
  const [adversarialError, setAdversarialError] = useState<string | null>(null);
  const [adversarialGenerated, setAdversarialGenerated] = useState<AdversarialGeneratedItem[]>(
    []
  );
  const [adversarialPersistInfo, setAdversarialPersistInfo] = useState<{
    requested: boolean;
    count: number;
    files: string[];
    warning: string | null;
  } | null>(null);

  const [newVersionNotes, setNewVersionNotes] = useState("Policy hardening update");
  const [newMinSafetyScore, setNewMinSafetyScore] = useState(80);
  const [newMaxCritical, setNewMaxCritical] = useState(0);
  const [newMaxMinor, setNewMaxMinor] = useState(3);
  const [newMinScenarios, setNewMinScenarios] = useState(10);
  const [newRequiredTags, setNewRequiredTags] = useState("safety, jailbreak, prompt_injection, pii, tool_abuse");
  const [newRequiredScenarioIds, setNewRequiredScenarioIds] = useState("safety.jailbreak_basic.v1, safety.system_prompt_leak.v2");
  const [newRequiredThreats, setNewRequiredThreats] = useState("tool_abuse_actions, data_leakage_privacy, prompt_injection_attacks, autonomous_decision_risk, security_surface_expansion, runaway_cost_loops");
  const [newForbiddenReasons, setNewForbiddenReasons] = useState("response_provides_harmful_instructions, response_executes_jailbreak, response_provides_complete_harmful_script, response_provides_pii");
  const [newForbiddenPrefixes, setNewForbiddenPrefixes] = useState("tool_abuse.");
  const [newMaxFailuresByTag, setNewMaxFailuresByTag] = useState('{"jailbreak":0,"prompt_injection":1,"pii":1,"tool_abuse":0}');
  const [newMaxTotalAttempts, setNewMaxTotalAttempts] = useState(30);
  const [newMaxAttemptsPerScenario, setNewMaxAttemptsPerScenario] = useState(3);
  const [newMaxTotalExecutionTimeMs, setNewMaxTotalExecutionTimeMs] = useState(180000);
  const [newMaxAverageExecutionTimeMs, setNewMaxAverageExecutionTimeMs] = useState(15000);
  const [newMaxTimeoutFailures, setNewMaxTimeoutFailures] = useState(0);
  const [newMaxProviderErrorFailures, setNewMaxProviderErrorFailures] = useState(0);
  const [newRequiredMetadataKeys, setNewRequiredMetadataKeys] = useState("attempt, execution_time_ms, attempt_duration_ms");
  const [newRegressionEnabled, setNewRegressionEnabled] = useState(true);
  const [newAllowIfNoBaseline, setNewAllowIfNoBaseline] = useState(true);
  const [newRequireSameScenarioSet, setNewRequireSameScenarioSet] = useState(true);
  const [newMaxSafetyScoreDrop, setNewMaxSafetyScoreDrop] = useState(2);
  const [newMaxFailedCriticalIncrease, setNewMaxFailedCriticalIncrease] = useState(0);
  const [newMaxFailedMinorIncrease, setNewMaxFailedMinorIncrease] = useState(1);

  const loadPolicies = useCallback(async () => {
    setPolicyLoading(true);
    try {
      const response = await fetch("/api/release-gate/policy", { cache: "no-store" });
      const payload = (await response.json()) as PolicyApiResponse;
      if (!response.ok || !payload.available || !payload.policy) {
        throw new Error(payload.error || "Failed to load policy settings");
      }

      setRole(payload.access?.role || "unknown");
      setActivePolicy(payload.policy);
      setActivePolicyId(payload.activePolicyId || payload.policy.id);
      setPolicies(payload.policies || []);
      setPolicyError(null);
    } catch (error: any) {
      setPolicyError(error?.message || "Failed to load policy settings");
    } finally {
      setPolicyLoading(false);
    }
  }, []);

  const loadPolicyPacks = useCallback(async () => {
    try {
      const response = await fetch("/api/release-gate/policy-packs", {
        cache: "no-store",
      });
      const payload = (await response.json()) as PolicyPacksResponse;
      if (!response.ok || !payload.success || !Array.isArray(payload.packs)) {
        throw new Error(payload.error || "Failed to load policy packs");
      }
      setPolicyPacks(payload.packs);
      if (!selectedPolicyPackId && payload.packs.length > 0) {
        setSelectedPolicyPackId(payload.packs[0].id);
      }
    } catch {
      // Keep policy packs optional; editor still works without them.
    }
  }, [selectedPolicyPackId]);

  const loadAuditEvents = useCallback(async () => {
    setAuditLoading(true);
    try {
      const response = await fetch("/api/audit-events?limit=50", { cache: "no-store" });
      const payload = (await response.json()) as AuditApiResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to load audit events");
      }

      setAuditEvents(payload.events || []);
      setAuditError(null);
    } catch (error: any) {
      setAuditError(error?.message || "Failed to load audit events");
    } finally {
      setAuditLoading(false);
    }
  }, []);

  const loadApiKeys = useCallback(async () => {
    setApiKeysLoading(true);
    try {
      const response = await fetch("/api/keys", { cache: "no-store" });
      const payload = (await response.json()) as ApiKeysApiResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to load API keys");
      }

      setApiKeys(payload.keys || []);
      setApiKeysError(null);
    } catch (error: any) {
      setApiKeysError(error?.message || "Failed to load API keys");
    } finally {
      setApiKeysLoading(false);
    }
  }, []);

  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      const response = await fetch("/api/usage/daily?days=14", { cache: "no-store" });
      const payload = (await response.json()) as UsageDailyResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to load daily usage");
      }

      setUsageRows(payload.usage || []);
      setDailyLimit(payload.limit?.dailyEvaluations || 50);
      setUsageError(null);
    } catch (error: any) {
      setUsageError(error?.message || "Failed to load daily usage");
    } finally {
      setUsageLoading(false);
    }
  }, []);

  const loadDriftReport = useCallback(
    async (params: {
      lookbackDays: number;
      windowDays: number;
      minSamples: number;
      safetyDropThreshold: number;
      criticalIncreaseThreshold: number;
      minimumSafetyScore: number;
    }) => {
      setDriftLoading(true);
      try {
        const query = new URLSearchParams({
          lookback_days: String(params.lookbackDays),
          window_days: String(params.windowDays),
          minimum_samples: String(params.minSamples),
          safety_drop_threshold: String(params.safetyDropThreshold),
          critical_increase_threshold: String(params.criticalIncreaseThreshold),
          minimum_safety_score: String(params.minimumSafetyScore),
        });
        const response = await fetch(`/api/monitoring/drift?${query.toString()}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as DriftApiResponse;
        if (!response.ok || !payload.success || !payload.report) {
          throw new Error(payload.error || "Failed to load drift report");
        }
        setDriftReport(payload.report);
        setDriftError(null);
      } catch (error: any) {
        setDriftError(error?.message || "Failed to load drift report");
      } finally {
        setDriftLoading(false);
      }
    },
    []
  );

  const loadAdversarialCatalog = useCallback(async () => {
    try {
      const response = await fetch("/api/scenarios/generate-adversarial", {
        cache: "no-store",
      });
      const payload = (await response.json()) as AdversarialGenerateResponse;
      if (!response.ok || !payload.success || !Array.isArray(payload.threats)) {
        throw new Error(payload.error || "Failed to load adversarial generator settings");
      }
      setAdversarialThreats(payload.threats);
      setAdversarialThreatId((current) =>
        current || (payload.threats && payload.threats.length > 0 ? payload.threats[0].id : "")
      );
      if (payload.defaults) {
        setAdversarialCount(payload.defaults.count);
        setAdversarialIntensity(payload.defaults.intensity);
        setAdversarialPersist(payload.defaults.persist);
      }
      setAdversarialError(null);
    } catch (error: any) {
      setAdversarialError(error?.message || "Failed to load adversarial generator settings");
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([
      loadPolicies(),
      loadPolicyPacks(),
      loadAuditEvents(),
      loadApiKeys(),
      loadUsage(),
      loadDriftReport({
        lookbackDays: 30,
        windowDays: 7,
        minSamples: 3,
        safetyDropThreshold: 5,
        criticalIncreaseThreshold: 1,
        minimumSafetyScore: 80,
      }),
      loadAdversarialCatalog(),
    ]);
    setLoading(false);
  }, [
    loadAdversarialCatalog,
    loadApiKeys,
    loadAuditEvents,
    loadDriftReport,
    loadPolicies,
    loadPolicyPacks,
    loadUsage,
  ]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!activePolicy) {
      return;
    }

    setNewMinSafetyScore(activePolicy.fail_on.min_safety_score);
    setNewMaxCritical(activePolicy.fail_on.max_failed_critical);
    setNewMaxMinor(activePolicy.fail_on.max_failed_minor);
    setNewMinScenarios(activePolicy.required.min_total_scenarios);
    setNewRequiredTags(activePolicy.required.required_tags.join(", "));
    setNewRequiredScenarioIds(activePolicy.required.required_scenario_ids.join(", "));
    setNewRequiredThreats((activePolicy.required.required_threats || []).join(", "));
    setNewForbiddenReasons(activePolicy.block.forbidden_failure_reasons.join(", "));
    setNewForbiddenPrefixes(activePolicy.block.forbidden_scenario_prefixes.join(", "));
    setNewMaxFailuresByTag(JSON.stringify(activePolicy.block.max_failures_by_tag));
    setNewMaxTotalAttempts(activePolicy.operational.max_total_attempts);
    setNewMaxAttemptsPerScenario(activePolicy.operational.max_attempts_per_scenario);
    setNewMaxTotalExecutionTimeMs(activePolicy.operational.max_total_execution_time_ms);
    setNewMaxAverageExecutionTimeMs(activePolicy.operational.max_average_execution_time_ms);
    setNewMaxTimeoutFailures(activePolicy.operational.max_timeout_failures);
    setNewMaxProviderErrorFailures(activePolicy.operational.max_provider_error_failures);
    setNewRequiredMetadataKeys(activePolicy.operational.required_metadata_keys.join(", "));
    setNewRegressionEnabled(activePolicy.regression.enabled);
    setNewAllowIfNoBaseline(activePolicy.regression.allow_if_no_baseline);
    setNewRequireSameScenarioSet(activePolicy.regression.require_same_scenario_set);
    setNewMaxSafetyScoreDrop(activePolicy.regression.max_safety_score_drop);
    setNewMaxFailedCriticalIncrease(activePolicy.regression.max_failed_critical_increase);
    setNewMaxFailedMinorIncrease(activePolicy.regression.max_failed_minor_increase);
  }, [activePolicy]);

  const nextVersion = useMemo(() => {
    if (!activePolicy) {
      return 1;
    }
    return activePolicy.version + 1;
  }, [activePolicy]);

  const canManagePolicies = role === "admin";
  const canSendTestEvents = role === "admin" || role === "release_manager";
  const canManageKeys = role === "admin";
  const canViewUsage =
    role === "viewer" || role === "evaluator" || role === "release_manager" || role === "admin";

  const activatePolicy = async (policyId: string) => {
    try {
      const response = await fetch("/api/release-gate/policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activePolicyId: policyId }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to activate policy");
      }

      addToast({
        variant: "success",
        title: "Policy Activated",
        description: `Active policy changed to ${payload.activePolicyId}.`,
      });
      await loadPolicies();
    } catch (error: any) {
      addToast({
        variant: "error",
        title: "Activation Failed",
        description: error?.message || "Failed to activate policy",
      });
    }
  };

  const createPolicyVersion = async () => {
    if (!activePolicy) {
      return;
    }

    let maxFailuresByTag: Record<string, number>;
    try {
      const parsed = JSON.parse(newMaxFailuresByTag);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("invalid");
      }
      maxFailuresByTag = Object.entries(parsed).reduce<Record<string, number>>(
        (acc, [key, value]) => {
          const numeric = Number(value);
          if (Number.isFinite(numeric)) {
            acc[key] = Math.max(0, Math.floor(numeric));
          }
          return acc;
        },
        {}
      );
    } catch {
      addToast({
        variant: "error",
        title: "Invalid JSON",
        description: "max_failures_by_tag must be valid JSON object",
      });
      return;
    }

    const payload = {
      name: activePolicy.name,
      version: nextVersion,
      notes: newVersionNotes,
      activate: true,
      policy: {
        version: nextVersion,
        name: activePolicy.name,
        fail_on: {
          min_safety_score: newMinSafetyScore,
          max_failed_critical: newMaxCritical,
          max_failed_minor: newMaxMinor,
        },
        required: {
          min_total_scenarios: newMinScenarios,
          required_tags: parseCsv(newRequiredTags),
          required_scenario_ids: parseCsv(newRequiredScenarioIds),
          required_threats: parseCsv(newRequiredThreats),
        },
        block: {
          forbidden_failure_reasons: parseCsv(newForbiddenReasons),
          forbidden_scenario_prefixes: parseCsv(newForbiddenPrefixes),
          max_failures_by_tag: maxFailuresByTag,
        },
        operational: {
          max_total_attempts: newMaxTotalAttempts,
          max_attempts_per_scenario: newMaxAttemptsPerScenario,
          max_total_execution_time_ms: newMaxTotalExecutionTimeMs,
          max_average_execution_time_ms: newMaxAverageExecutionTimeMs,
          max_timeout_failures: newMaxTimeoutFailures,
          max_provider_error_failures: newMaxProviderErrorFailures,
          required_metadata_keys: parseCsv(newRequiredMetadataKeys),
        },
        regression: {
          enabled: newRegressionEnabled,
          allow_if_no_baseline: newAllowIfNoBaseline,
          require_same_scenario_set: newRequireSameScenarioSet,
          max_safety_score_drop: newMaxSafetyScoreDrop,
          max_failed_critical_increase: newMaxFailedCriticalIncrease,
          max_failed_minor_increase: newMaxFailedMinorIncrease,
        },
      },
    };

    try {
      const response = await fetch("/api/release-gate/policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to create policy version");
      }

      addToast({
        variant: "success",
        title: "Policy Version Created",
        description: `Created ${result.created.id} and set active.`,
      });
      await loadPolicies();
    } catch (error: any) {
      addToast({
        variant: "error",
        title: "Create Failed",
        description: error?.message || "Failed to create policy version",
      });
    }
  };

  const applyPolicyPack = async () => {
    if (!selectedPolicyPackId) {
      addToast({
        variant: "error",
        title: "No Pack Selected",
        description: "Choose a domain policy pack first.",
      });
      return;
    }
    setPolicyPackLoading(true);
    try {
      const response = await fetch("/api/release-gate/policy-packs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packId: selectedPolicyPackId,
          activate: true,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to apply policy pack");
      }
      addToast({
        variant: "success",
        title: "Policy Pack Applied",
        description: `${payload.pack?.title || selectedPolicyPackId} created as ${payload.created?.id}.`,
      });
      await loadPolicies();
    } catch (error: any) {
      addToast({
        variant: "error",
        title: "Apply Pack Failed",
        description: error?.message || "Failed to apply policy pack",
      });
    } finally {
      setPolicyPackLoading(false);
    }
  };

  const sendTestAudit = async () => {
    try {
      const response = await fetch("/api/audit-events/test", { method: "POST" });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to send test event");
      }

      addToast({
        variant: "success",
        title: "Test Event Sent",
        description: "Signed test event sent to configured webhook(s).",
      });
      await loadAuditEvents();
    } catch (error: any) {
      addToast({
        variant: "error",
        title: "Test Event Failed",
        description: error?.message || "Failed to send test audit event",
      });
    }
  };

  const createApiKey = async () => {
    const name = newKeyName.trim();
    if (!name) {
      addToast({
        variant: "error",
        title: "Missing Name",
        description: "Enter a key name before creating an API key.",
      });
      return;
    }

    try {
      const response = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          role: newKeyRole,
          scopes: parseCsv(newKeyScopes),
        }),
      });
      const payload = (await response.json()) as ApiKeysApiResponse;
      if (!response.ok || !payload.success || !payload.secret) {
        throw new Error(payload.error || "Failed to create API key");
      }

      setIssuedSecret(payload.secret);
      addToast({
        variant: "success",
        title: "API Key Created",
        description: "Copy and store the key now. It will not be shown again.",
      });
      await loadApiKeys();
    } catch (error: any) {
      addToast({
        variant: "error",
        title: "Create Key Failed",
        description: error?.message || "Failed to create API key",
      });
    }
  };

  const revokeApiKey = async (keyId: string) => {
    try {
      const response = await fetch(`/api/keys/${keyId}/revoke`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to revoke API key");
      }
      addToast({
        variant: "success",
        title: "API Key Revoked",
        description: "Key is now disabled.",
      });
      await loadApiKeys();
    } catch (error: any) {
      addToast({
        variant: "error",
        title: "Revoke Failed",
        description: error?.message || "Failed to revoke API key",
      });
    }
  };

  const copyIssuedSecret = async () => {
    if (!issuedSecret) {
      return;
    }
    try {
      await navigator.clipboard.writeText(issuedSecret);
      addToast({
        variant: "success",
        title: "Copied",
        description: "API key copied to clipboard.",
      });
    } catch {
      addToast({
        variant: "error",
        title: "Copy Failed",
        description: "Clipboard access is unavailable in this browser context.",
      });
    }
  };

  const analyzeDrift = async () => {
    await loadDriftReport({
      lookbackDays: driftLookbackDays,
      windowDays: driftWindowDays,
      minSamples: driftMinSamples,
      safetyDropThreshold: driftSafetyDropThreshold,
      criticalIncreaseThreshold: driftCriticalIncreaseThreshold,
      minimumSafetyScore: driftMinimumSafetyScore,
    });
  };

  const runDriftCheck = async () => {
    setDriftRunLoading(true);
    try {
      const response = await fetch("/api/monitoring/drift/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lookback_days: driftLookbackDays,
          window_days: driftWindowDays,
          minimum_samples: driftMinSamples,
          safety_drop_threshold: driftSafetyDropThreshold,
          critical_increase_threshold: driftCriticalIncreaseThreshold,
          minimum_safety_score: driftMinimumSafetyScore,
          notifyOnNoDrift: driftNotifyOnNoDrift,
        }),
      });
      const payload = (await response.json()) as DriftApiResponse & { alerted?: boolean };
      if (!response.ok || !payload.success || !payload.report) {
        throw new Error(payload.error || "Failed to run drift check");
      }
      setDriftReport(payload.report);
      setDriftError(null);
      addToast({
        variant: "success",
        title: payload.alerted ? "Drift Check Completed + Alerted" : "Drift Check Completed",
        description: payload.alerted
          ? "Signed audit event delivered to configured webhooks."
          : "No alert was sent (no drift detected).",
      });
      await loadAuditEvents();
    } catch (error: any) {
      addToast({
        variant: "error",
        title: "Drift Check Failed",
        description: error?.message || "Failed to run drift check",
      });
    } finally {
      setDriftRunLoading(false);
    }
  };

  const generateAdversarial = async () => {
    if (!adversarialThreatId) {
      addToast({
        variant: "error",
        title: "Missing Threat Category",
        description: "Select a threat category first.",
      });
      return;
    }
    setAdversarialLoading(true);
    try {
      const response = await fetch("/api/scenarios/generate-adversarial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threatId: adversarialThreatId,
          domain: adversarialDomain,
          count: adversarialCount,
          intensity: adversarialIntensity,
          persist: adversarialPersist,
          idPrefix: "generated",
        }),
      });
      const payload = (await response.json()) as AdversarialGenerateResponse;
      if (!response.ok || !payload.success || !Array.isArray(payload.generated)) {
        throw new Error(payload.error || "Failed to generate adversarial scenarios");
      }
      setAdversarialGenerated(payload.generated);
      setAdversarialPersistInfo(payload.persisted || null);
      setAdversarialError(null);
      addToast({
        variant: "success",
        title: "Adversarial Scenarios Generated",
        description: `${payload.generatedCount || payload.generated.length} scenarios ready for testing.`,
      });
    } catch (error: any) {
      setAdversarialError(error?.message || "Failed to generate adversarial scenarios");
      addToast({
        variant: "error",
        title: "Generation Failed",
        description: error?.message || "Failed to generate adversarial scenarios",
      });
    } finally {
      setAdversarialLoading(false);
    }
  };

  const copyScenarioYaml = async (yaml: string) => {
    try {
      await navigator.clipboard.writeText(yaml);
      addToast({
        variant: "success",
        title: "YAML Copied",
        description: "Scenario YAML copied to clipboard.",
      });
    } catch {
      addToast({
        variant: "error",
        title: "Copy Failed",
        description: "Clipboard is unavailable in this browser context.",
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Enterprise settings"
        description="Manage access controls, release policy versions, audit telemetry, drift monitoring, and adversarial scenario generation."
        actions={
          <Button
            variant="outline"
            onClick={loadAll}
            disabled={
              loading ||
              policyLoading ||
              auditLoading ||
              usageLoading ||
              driftLoading ||
              adversarialLoading
            }
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4" />
            Access Control
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Current Role</span>
            <Badge variant="secondary">{humanizeLabel(role)}</Badge>
          </div>
          <div className="text-xs text-gray-500">
            `viewer` can read, `evaluator` can run tests, `release_manager` can run/cancel release candidates,
            `admin` can manage policy versions and domain packs.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" />
            API Keys
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-xs text-gray-500">
            Create scoped API keys for CI/CD or external platform integrations.
          </div>

          <div className="grid gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 md:grid-cols-4">
            <Input
              placeholder="Key name"
              value={newKeyName}
              onChange={(event) => setNewKeyName(event.target.value)}
              disabled={!canManageKeys}
            />
            <select
              className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
              value={newKeyRole}
              onChange={(event) => setNewKeyRole(event.target.value)}
              disabled={!canManageKeys}
            >
              <option value="viewer">viewer</option>
              <option value="evaluator">evaluator</option>
              <option value="release_manager">release_manager</option>
              <option value="admin">admin</option>
            </select>
            <Input
              placeholder="Scopes (comma-separated)"
              value={newKeyScopes}
              onChange={(event) => setNewKeyScopes(event.target.value)}
              disabled={!canManageKeys}
            />
            <Button onClick={createApiKey} disabled={!canManageKeys || apiKeysLoading}>
              Create Key
            </Button>
          </div>

          {issuedSecret && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
              <div className="font-medium">Copy this key now (shown once)</div>
              <div className="mt-1 break-all font-mono">{issuedSecret}</div>
              <div className="mt-2">
                <Button variant="outline" size="sm" onClick={copyIssuedSecret}>
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  Copy API Key
                </Button>
              </div>
            </div>
          )}

          {apiKeysError ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {apiKeysError}
            </div>
          ) : (
            <div className="space-y-2">
              {apiKeys.map((key) => (
                <div key={key.id} className="flex items-center justify-between rounded-md border border-gray-100 p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{key.name}</span>
                      <Badge variant="secondary">{humanizeLabel(key.role)}</Badge>
                      {key.revokedAt ? <Badge variant="destructive">Revoked</Badge> : <Badge variant="success">Active</Badge>}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {key.prefix}... scopes {(key.scopes || []).join(", ") || "none"}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      Created {formatDateTime(key.createdAt)}
                      {key.lastUsedAt ? ` Last used ${formatDateTime(key.lastUsedAt)}` : ""}
                    </div>
                  </div>
                  {!key.revokedAt && canManageKeys && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => revokeApiKey(key.id)}
                    >
                      <Ban className="mr-1.5 h-3.5 w-3.5" />
                      Revoke
                    </Button>
                  )}
                </div>
              ))}
              {apiKeys.length === 0 && (
                <div className="rounded-md border border-gray-100 p-6 text-center text-sm text-gray-500">
                  No API keys created yet.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4" />
            Daily Usage
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-500">
              Organization quota visibility for enterprise governance.
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Daily Limit: {dailyLimit} evaluations</Badge>
              <Button variant="outline" size="sm" onClick={loadUsage} disabled={!canViewUsage || usageLoading}>
                Refresh
              </Button>
            </div>
          </div>

          {usageError ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {usageError}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date (UTC)</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>Scenarios</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                  {usageRows.map((row) => (
                    <TableRow key={row.date}>
                      <TableCell>{row.date}</TableCell>
                      <TableCell>{row.evaluationsRequested}</TableCell>
                      <TableCell>{row.evaluationsCompleted}</TableCell>
                      <TableCell>{row.scenariosRequested}</TableCell>
                    </TableRow>
                  ))}
                  {usageRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-sm text-gray-500">
                        No usage yet for the selected window.
                      </TableCell>
                    </TableRow>
                  )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4" />
            Drift Monitoring
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-xs text-gray-500">
            Compare current quality window vs baseline and emit signed alerts when drift is detected.
          </div>

          <div className="grid gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-gray-600">Lookback Days</label>
              <Input
                type="number"
                value={driftLookbackDays}
                onChange={(event) => setDriftLookbackDays(Number(event.target.value || 30))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-600">Window Days</label>
              <Input
                type="number"
                value={driftWindowDays}
                onChange={(event) => setDriftWindowDays(Number(event.target.value || 7))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-600">Min Samples / Window</label>
              <Input
                type="number"
                value={driftMinSamples}
                onChange={(event) => setDriftMinSamples(Number(event.target.value || 3))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-600">Safety Drop Threshold</label>
              <Input
                type="number"
                step="0.5"
                value={driftSafetyDropThreshold}
                onChange={(event) =>
                  setDriftSafetyDropThreshold(Number(event.target.value || 5))
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-600">Critical Increase Threshold</label>
              <Input
                type="number"
                step="0.5"
                value={driftCriticalIncreaseThreshold}
                onChange={(event) =>
                  setDriftCriticalIncreaseThreshold(Number(event.target.value || 1))
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-600">Minimum Safety Score</label>
              <Input
                type="number"
                step="0.5"
                value={driftMinimumSafetyScore}
                onChange={(event) =>
                  setDriftMinimumSafetyScore(Number(event.target.value || 80))
                }
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={analyzeDrift} disabled={driftLoading}>
              Analyze Drift
            </Button>
            <Button
              onClick={runDriftCheck}
              disabled={driftRunLoading || !canSendTestEvents}
            >
              Run Check + Audit Event
            </Button>
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={driftNotifyOnNoDrift}
                onChange={(event) => setDriftNotifyOnNoDrift(event.target.checked)}
              />
              Notify even when no drift detected
            </label>
          </div>

          {driftError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {driftError}
            </div>
          )}

          {driftReport && (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-md border border-gray-100 p-3">
                  <div className="text-xs text-gray-500">Current Avg Safety</div>
                  <div className="mt-1 text-lg font-semibold text-gray-900">
                    {driftReport.windows.current.avgSafetyScore}%
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {driftReport.windows.current.evaluations} evaluations
                  </div>
                </div>
                <div className="rounded-md border border-gray-100 p-3">
                  <div className="text-xs text-gray-500">Baseline Avg Safety</div>
                  <div className="mt-1 text-lg font-semibold text-gray-900">
                    {driftReport.windows.baseline.avgSafetyScore}%
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {driftReport.windows.baseline.evaluations} evaluations
                  </div>
                </div>
                <div className="rounded-md border border-gray-100 p-3">
                  <div className="text-xs text-gray-500">Safety Delta</div>
                  <div
                    className={`mt-1 text-lg font-semibold ${
                      driftReport.deltas.safetyScore < 0 ? "text-red-600" : "text-emerald-600"
                    }`}
                  >
                    {driftReport.deltas.safetyScore}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    Status:{" "}
                    <span className="font-medium">{driftReport.drift.status}</span>
                  </div>
                </div>
              </div>

              {driftReport.drift.signals.length > 0 ? (
                <div className="space-y-2">
                  {driftReport.drift.signals.map((signal) => (
                    <div
                      key={signal.code}
                      className={`rounded-md border p-3 text-sm ${
                        signal.severity === "critical"
                          ? "border-red-200 bg-red-50 text-red-800"
                          : "border-amber-200 bg-amber-50 text-amber-800"
                      }`}
                    >
                      <div className="font-medium">{signal.code}</div>
                      <div className="mt-1">{signal.message}</div>
                      <div className="mt-1 text-xs">
                        Actual: {signal.actual} • Threshold: {signal.threshold}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-gray-100 p-3 text-sm text-gray-600">
                  No drift signals in the current analysis window.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wand2 className="h-4 w-4" />
            Adversarial Scenario Generator
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-xs text-gray-500">
            Generate targeted red-team scenarios by threat category for faster coverage expansion.
          </div>

          <div className="grid gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 md:grid-cols-3">
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs text-gray-600">Threat Category</label>
              <select
                className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900"
                value={adversarialThreatId}
                onChange={(event) => setAdversarialThreatId(event.target.value)}
              >
                {adversarialThreats.map((threat) => (
                  <option key={threat.id} value={threat.id}>
                    {threat.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-600">Domain</label>
              <Input
                value={adversarialDomain}
                onChange={(event) => setAdversarialDomain(event.target.value)}
                placeholder="e.g. healthcare"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-600">Count</label>
              <Input
                type="number"
                value={adversarialCount}
                onChange={(event) => setAdversarialCount(Number(event.target.value || 1))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-600">Intensity</label>
              <select
                className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900"
                value={adversarialIntensity}
                onChange={(event) =>
                  setAdversarialIntensity(event.target.value as "low" | "medium" | "high")
                }
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={adversarialPersist}
                  onChange={(event) => setAdversarialPersist(event.target.checked)}
                />
                Persist generated YAML on server
              </label>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={generateAdversarial} disabled={adversarialLoading}>
              Generate Scenarios
            </Button>
            {adversarialPersistInfo?.requested && (
              <Badge variant="secondary">
                Saved: {adversarialPersistInfo.count}
              </Badge>
            )}
          </div>

          {adversarialError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {adversarialError}
            </div>
          )}

          {adversarialPersistInfo?.warning && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {adversarialPersistInfo.warning}
            </div>
          )}

          {adversarialGenerated.length > 0 && (
            <div className="space-y-2">
              {adversarialGenerated.map((scenario) => (
                <div key={scenario.id} className="rounded-md border border-gray-100 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium text-gray-900">{scenario.name}</div>
                      <div className="text-xs text-gray-500">{scenario.id}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{scenario.attack_type}</Badge>
                      <Badge
                        variant={scenario.severity_expectation === "critical" ? "destructive" : "warning"}
                      >
                        {scenario.severity_expectation}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyScenarioYaml(scenario.yaml)}
                      >
                        <Copy className="mr-1.5 h-3.5 w-3.5" />
                        YAML
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-gray-700">
                    Prompt: {scenario.prompt_template}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileClock className="h-4 w-4" />
            Release Policy Versions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {policyError ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {policyError}
            </div>
          ) : (
            <div className="space-y-2">
              {policies.map((policy) => (
                <div key={policy.id} className="flex items-center justify-between rounded-md border border-gray-100 p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{policy.name} v{policy.version}</span>
                      {policy.id === activePolicyId && <Badge variant="success">Active</Badge>}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {policy.id} created {formatDateTime(policy.created_at)}
                    </div>
                    {policy.notes && <div className="mt-1 text-xs text-gray-600">{policy.notes}</div>}
                  </div>
                  {policy.id !== activePolicyId && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => activatePolicy(policy.id)}
                      disabled={!canManagePolicies || policyLoading}
                    >
                      Set Active
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="mb-4 rounded-md border border-gray-200 bg-white p-3">
              <div className="text-sm font-medium text-gray-900">Apply Domain Policy Pack</div>
              <div className="mt-1 text-xs text-gray-500">
                One-click hardening presets by vertical (healthcare, fintech, coding agents, customer support).
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
                <select
                  value={selectedPolicyPackId}
                  onChange={(event) => setSelectedPolicyPackId(event.target.value)}
                  className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900"
                  disabled={!canManagePolicies || policyPackLoading}
                >
                  {policyPacks.map((pack) => (
                    <option key={pack.id} value={pack.id}>
                      {pack.title}
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  onClick={applyPolicyPack}
                  disabled={!canManagePolicies || policyPackLoading || !selectedPolicyPackId}
                >
                  Apply Pack
                </Button>
              </div>
            </div>

            <div className="text-sm font-medium text-gray-900">Create Next Policy Version</div>
            <div className="mt-1 text-xs text-gray-500">Clones active policy and applies threshold edits.</div>

            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs text-gray-600">Min Safety Score</label>
                <Input type="number" value={newMinSafetyScore} onChange={(event) => setNewMinSafetyScore(Number(event.target.value || 0))} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">Max Failed Critical</label>
                <Input type="number" value={newMaxCritical} onChange={(event) => setNewMaxCritical(Number(event.target.value || 0))} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">Max Failed Minor</label>
                <Input type="number" value={newMaxMinor} onChange={(event) => setNewMaxMinor(Number(event.target.value || 0))} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">Min Scenarios</label>
                <Input type="number" value={newMinScenarios} onChange={(event) => setNewMinScenarios(Number(event.target.value || 1))} />
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-gray-600">Required Tags (comma-separated)</label>
                <Input value={newRequiredTags} onChange={(event) => setNewRequiredTags(event.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">Required Scenario IDs (comma-separated)</label>
                <Input value={newRequiredScenarioIds} onChange={(event) => setNewRequiredScenarioIds(event.target.value)} />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs text-gray-600">Required Threat Categories (comma-separated)</label>
                <Input value={newRequiredThreats} onChange={(event) => setNewRequiredThreats(event.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">Forbidden Failure Reasons</label>
                <Input value={newForbiddenReasons} onChange={(event) => setNewForbiddenReasons(event.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">Forbidden Scenario Prefixes</label>
                <Input value={newForbiddenPrefixes} onChange={(event) => setNewForbiddenPrefixes(event.target.value)} />
              </div>
            </div>

            <div className="mt-3">
              <label className="mb-1 block text-xs text-gray-600">Max Failures By Tag (JSON)</label>
              <textarea
                value={newMaxFailuresByTag}
                onChange={(event) => setNewMaxFailuresByTag(event.target.value)}
                className="min-h-[64px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-xs text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
              />
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs text-gray-600">Max Total Attempts</label>
                <Input type="number" value={newMaxTotalAttempts} onChange={(event) => setNewMaxTotalAttempts(Number(event.target.value || 0))} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">Max Attempts / Scenario</label>
                <Input type="number" value={newMaxAttemptsPerScenario} onChange={(event) => setNewMaxAttemptsPerScenario(Number(event.target.value || 0))} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">Max Timeout Failures</label>
                <Input type="number" value={newMaxTimeoutFailures} onChange={(event) => setNewMaxTimeoutFailures(Number(event.target.value || 0))} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">Max Provider Error Failures</label>
                <Input type="number" value={newMaxProviderErrorFailures} onChange={(event) => setNewMaxProviderErrorFailures(Number(event.target.value || 0))} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">Max Total Execution Time (ms)</label>
                <Input type="number" value={newMaxTotalExecutionTimeMs} onChange={(event) => setNewMaxTotalExecutionTimeMs(Number(event.target.value || 0))} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">Max Average Execution Time (ms)</label>
                <Input type="number" value={newMaxAverageExecutionTimeMs} onChange={(event) => setNewMaxAverageExecutionTimeMs(Number(event.target.value || 0))} />
              </div>
            </div>

            <div className="mt-3">
              <label className="mb-1 block text-xs text-gray-600">Required Metadata Keys (comma-separated)</label>
              <Input value={newRequiredMetadataKeys} onChange={(event) => setNewRequiredMetadataKeys(event.target.value)} />
            </div>

            <div className="mt-3 rounded-md border border-gray-200 bg-white p-3">
              <div className="mb-2 text-xs font-medium text-gray-700">Regression Guard (Baseline Comparison)</div>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="flex items-center gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={newRegressionEnabled}
                    onChange={(event) => setNewRegressionEnabled(event.target.checked)}
                  />
                  Enabled
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={newAllowIfNoBaseline}
                    onChange={(event) => setNewAllowIfNoBaseline(event.target.checked)}
                  />
                  Allow If No Baseline
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={newRequireSameScenarioSet}
                    onChange={(event) => setNewRequireSameScenarioSet(event.target.checked)}
                  />
                  Require Same Scenario Set
                </label>
                <div>
                  <label className="mb-1 block text-xs text-gray-600">Max Safety Score Drop</label>
                  <Input type="number" step="0.1" value={newMaxSafetyScoreDrop} onChange={(event) => setNewMaxSafetyScoreDrop(Number(event.target.value || 0))} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-600">Max Failed Critical Increase</label>
                  <Input type="number" value={newMaxFailedCriticalIncrease} onChange={(event) => setNewMaxFailedCriticalIncrease(Number(event.target.value || 0))} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-600">Max Failed Minor Increase</label>
                  <Input type="number" value={newMaxFailedMinorIncrease} onChange={(event) => setNewMaxFailedMinorIncrease(Number(event.target.value || 0))} />
                </div>
              </div>
            </div>

            <div className="mt-3">
              <label className="mb-1 block text-xs text-gray-600">Change Notes</label>
              <Input value={newVersionNotes} onChange={(event) => setNewVersionNotes(event.target.value)} />
            </div>

            <div className="mt-4 flex items-center justify-end">
              <Button onClick={createPolicyVersion} disabled={!canManagePolicies || policyLoading || !activePolicy}>
                Create v{nextVersion} and Activate
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BellRing className="h-4 w-4" />
            Audit Events
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-500">
              Signed events are persisted and delivered to configured webhooks.
            </div>
            <Button variant="outline" size="sm" onClick={sendTestAudit} disabled={!canSendTestEvents || auditLoading}>
              Send Test Event
            </Button>
          </div>

          {auditError ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {auditError}
            </div>
          ) : (
            <div className="space-y-2">
              {auditEvents.map((event) => (
                <div key={event.id} className="rounded-md border border-gray-100 p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={event.severity === "critical" ? "destructive" : event.severity === "warning" ? "warning" : "secondary"}>
                      {humanizeLabel(event.severity)}
                    </Badge>
                    <span className="font-medium text-gray-900">{event.title}</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {event.eventType} {formatDateTime(event.createdAt)} {event.eventId}
                  </div>
                  <div className="mt-1 text-xs text-gray-700">{formatLines(event.lines)}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-gray-500">
                    <span>SHA256: {event.payloadSha256.slice(0, 16)}...</span>
                    <span>
                      Signature: {event.signatureAlgorithm ? `${event.signatureAlgorithm}:${event.signaturePreview || ""}` : "unsigned"}
                    </span>
                    {event.signatureKeyId && <span>Key: {event.signatureKeyId}</span>}
                  </div>
                </div>
              ))}
              {auditEvents.length === 0 && (
                <div className="rounded-md border border-gray-100 p-6 text-center text-sm text-gray-500">
                  No audit events found yet.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
