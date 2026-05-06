"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, ChevronRight, ChevronLeft, Check } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { AgentConfigForm } from "./agent-config-form";
import { ScenarioSelector } from "./scenario-selector";

type ReleaseMode = "exploratory" | "release_candidate";

interface ReleasePolicyRequirements {
  min_total_scenarios: number;
  required_tags: string[];
  required_scenario_ids: string[];
}

interface ReleasePolicyResponse {
  available: boolean;
  activePolicyId?: string | null;
  policies?: Array<{
    id: string;
    name: string;
    version: number;
  }>;
  policy?: {
    id: string;
    name: string;
    required: ReleasePolicyRequirements;
  };
  error?: string;
}

const EXPLORATORY_RECOMMENDED_IDS = [
  "safety.jailbreak_basic.v1",
  "safety.system_prompt_leak.v2",
  "prompt_injection.instruction_override.v1",
  "pii.ssn_request.v1",
];

const RELEASE_RECOMMENDED_IDS = [
  "safety.jailbreak_basic.v1",
  "safety.system_prompt_leak.v2",
  "jailbreak.authority_impersonation.v1",
  "prompt_injection.instruction_override.v1",
  "prompt_injection.ignore_previous.v1",
  "pii.ssn_request.v1",
  "pii.credit_card.v1",
  "tool_abuse.file_delete.v1",
  "tool_abuse.code_execution.v1",
  "safety.pii_leakage_email.v1",
];

const agentConfigSchema = z.object({
  provider: z.enum(["openai", "http_agent"]),
  model: z.string().min(1, "Model is required"),
  temperature: z.number().min(0).max(2),
  max_tokens: z.number().min(1).max(4096),
  base_url: z.string().optional(),
  http_agent_base_url: z.string().optional(),
  http_agent_endpoint_path: z.string().optional(),
  http_agent_health_path: z.string().optional(),
  http_agent_method: z.enum(["GET", "POST", "PUT", "PATCH"]).optional(),
  http_agent_prompt_field: z.string().optional(),
  http_agent_response_path: z.string().optional(),
  http_agent_auth_header: z.string().optional(),
  http_agent_auth_env_var: z.string().optional(),
  http_agent_auth_scheme: z.string().optional(),
});

type AgentConfig = z.infer<typeof agentConfigSchema>;

function selectRecommendedScenarios(params: {
  scenarios: any[];
  mode: ReleaseMode;
}): string[] {
  const { scenarios, mode } = params;
  const targetCount = mode === "release_candidate" ? 10 : 4;
  const available = new Set(
    scenarios
      .map((scenario) => scenario?.id)
      .filter((scenarioId): scenarioId is string => typeof scenarioId === "string" && scenarioId.length > 0)
  );
  const preferred =
    mode === "release_candidate" ? RELEASE_RECOMMENDED_IDS : EXPLORATORY_RECOMMENDED_IDS;
  const matched = preferred.filter((scenarioId) => available.has(scenarioId));
  if (matched.length > 0) {
    return matched.slice(0, targetCount);
  }

  return scenarios
    .map((scenario) => scenario?.id)
    .filter((scenarioId): scenarioId is string => typeof scenarioId === "string" && scenarioId.length > 0)
    .slice(0, targetCount);
}

interface EvaluationWizardProps {
  scenarios: any[];
}

export function EvaluationWizard({ scenarios }: EvaluationWizardProps) {
  const router = useRouter();
  const { addToast } = useToast();
  const [step, setStep] = useState(1);
  const [selectedScenarios, setSelectedScenarios] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [releaseMode, setReleaseMode] = useState<ReleaseMode>("release_candidate");
  const [policyRequirements, setPolicyRequirements] = useState<ReleasePolicyRequirements | null>(null);
  const [policyName, setPolicyName] = useState<string>("enterprise-default");
  const [selectedPolicyId, setSelectedPolicyId] = useState<string>("");
  const [availablePolicies, setAvailablePolicies] = useState<
    Array<{ id: string; name: string; version: number }>
  >([]);
  const [policyLoadError, setPolicyLoadError] = useState<string | null>(null);
  const [autoSelectedMode, setAutoSelectedMode] = useState<ReleaseMode | null>(null);

  const form = useForm<AgentConfig>({
    resolver: zodResolver(agentConfigSchema),
    defaultValues: {
      provider: "openai",
      model: "gpt-4o-mini",
      temperature: 0.0,
      max_tokens: 512,
      http_agent_base_url: "http://localhost:8000",
      http_agent_endpoint_path: "/agent",
      http_agent_health_path: "/health",
      http_agent_method: "POST",
      http_agent_prompt_field: "query",
      http_agent_response_path: "answer",
      http_agent_auth_header: "Authorization",
      http_agent_auth_scheme: "Bearer",
    },
  });

  useEffect(() => {
    let cancelled = false;

    async function loadPolicy() {
      try {
        const response = await fetch("/api/release-gate/policy");
        const payload = (await response.json()) as ReleasePolicyResponse;

        if (cancelled) {
          return;
        }

        if (!response.ok || !payload.available || !payload.policy) {
          setPolicyRequirements(null);
          setPolicyLoadError(payload.error || "Release policy unavailable");
          return;
        }

        setPolicyName(payload.policy.name);
        setPolicyRequirements(payload.policy.required);
        setAvailablePolicies(Array.isArray(payload.policies) ? payload.policies : []);
        setSelectedPolicyId(payload.activePolicyId || payload.policy.id || "");
        setPolicyLoadError(null);
      } catch (error: any) {
        if (cancelled) {
          return;
        }
        setPolicyRequirements(null);
        setAvailablePolicies([]);
        setSelectedPolicyId("");
        setPolicyLoadError(error?.message || "Release policy unavailable");
      }
    }

    loadPolicy();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (step !== 3 || selectedScenarios.length > 0 || autoSelectedMode === releaseMode) {
      return;
    }
    const recommended = selectRecommendedScenarios({ scenarios, mode: releaseMode });
    if (recommended.length === 0) {
      return;
    }
    setSelectedScenarios(recommended);
    setAutoSelectedMode(releaseMode);
    addToast({
      variant: "success",
      title: "Recommended Scenarios Applied",
      description:
        releaseMode === "release_candidate"
          ? "Loaded policy-oriented release candidate set."
          : "Loaded quick exploratory smoke set.",
    });
  }, [addToast, autoSelectedMode, releaseMode, scenarios, selectedScenarios.length, step]);

  const releaseValidation = useMemo(() => {
    if (releaseMode !== "release_candidate") {
      return {
        valid: true,
        violations: [] as string[],
      };
    }

    if (!policyRequirements) {
      return {
        valid: false,
        violations: [policyLoadError || "Release policy requirements not available"],
      };
    }

    const selectedSet = new Set(selectedScenarios);
    const selectedDetails = scenarios.filter((scenario) => selectedSet.has(scenario.id));
    const observedTags = new Set<string>();

    for (const scenario of selectedDetails) {
      if (typeof scenario.id === "string" && scenario.id.includes(".")) {
        observedTags.add(scenario.id.split(".")[0].toLowerCase());
      }

      if (Array.isArray(scenario.tags)) {
        for (const tag of scenario.tags) {
          if (typeof tag === "string") {
            observedTags.add(tag.toLowerCase());
          }
        }
      }
    }

    const violations: string[] = [];
    if (selectedScenarios.length < policyRequirements.min_total_scenarios) {
      violations.push(
        `Select at least ${policyRequirements.min_total_scenarios} scenarios for release candidate mode`
      );
    }

    for (const requiredTag of policyRequirements.required_tags) {
      if (!observedTags.has(requiredTag.toLowerCase())) {
        violations.push(`Missing required tag coverage: ${requiredTag}`);
      }
    }

    for (const requiredScenarioId of policyRequirements.required_scenario_ids) {
      if (!selectedSet.has(requiredScenarioId)) {
        violations.push(`Missing required scenario: ${requiredScenarioId}`);
      }
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }, [policyLoadError, policyRequirements, releaseMode, scenarios, selectedScenarios]);

  const handleNext = async () => {
    if (step === 2) {
      const isValid = await form.trigger();
      if (!isValid) {
        addToast({
          variant: "error",
          title: "Validation Error",
          description: "Please fix the form errors before continuing",
        });
        return;
      }
    }
    if (step < 3) {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const handleRun = async () => {
    if (selectedScenarios.length === 0) {
      addToast({
        variant: "error",
        title: "No Scenarios Selected",
        description: "Please select at least one scenario to run",
      });
      return;
    }

    if (releaseMode === "release_candidate" && !releaseValidation.valid) {
      addToast({
        variant: "error",
        title: "Release Candidate Requirements Not Met",
        description: releaseValidation.violations[0] || "Expand scenario coverage to continue",
      });
      return;
    }

    setLoading(true);
    try {
      const formData = form.getValues();
      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentType: formData.provider,
          agentConfig: {
            model: formData.model,
            temperature: formData.temperature,
            max_tokens: formData.max_tokens,
            max_concurrency: 3,
            timeout_seconds: 30.0,
            max_retries: 3,
            base_url: formData.base_url || null,
            http_agent: formData.provider === "http_agent" ? {
              base_url: formData.http_agent_base_url || "http://localhost:8000",
              endpoint_path: formData.http_agent_endpoint_path || "/agent",
              health_path: formData.http_agent_health_path || "/health",
              method: formData.http_agent_method || "POST",
              prompt_field: formData.http_agent_prompt_field || "query",
              response_path: formData.http_agent_response_path || "answer",
              auth_header: formData.http_agent_auth_header || "Authorization",
              auth_token_env_var: formData.http_agent_auth_env_var || null,
              auth_scheme: formData.http_agent_auth_scheme || "Bearer",
            } : undefined,
          },
          selectedScenarios,
          releaseMode,
          releasePolicyId: selectedPolicyId || undefined,
          evaluationName: `Evaluation ${new Date().toLocaleString()}`,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        if (Array.isArray(error?.violations) && error.violations.length > 0) {
          throw new Error(`${error.error} (${error.violations[0]})`);
        }
        throw new Error(error.error || "Failed to start evaluation");
      }

      const data = await response.json();
      addToast({
        variant: "success",
        title: "Evaluation Started",
        description: "Your evaluation is now running",
      });
      router.push(`/dashboard/evaluations/${data.evaluationId}`);
    } catch (error: any) {
      addToast({
        variant: "error",
        title: "Error",
        description: error.message || "Failed to start evaluation",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
          New Evaluation
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Run safety and reliability tests on your AI agent
        </p>
      </div>

      <div className="flex items-center justify-center gap-2 pb-8">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-medium ${
                s < step
                  ? "border-green-500 bg-green-50 text-green-600"
                  : s === step
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-200 bg-white text-gray-400"
              }`}
            >
              {s < step ? <Check className="h-4 w-4" /> : s}
            </div>
            {s < 3 && (
              <div
                className={`h-0.5 w-12 ${
                  s < step ? "bg-green-500" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {step === 1 && "Choose Agent Type"}
            {step === 2 && "Configure Agent"}
            {step === 3 && "Select Scenarios"}
          </CardTitle>
          <CardDescription>
            {step === 1 && "Select the type of agent you want to evaluate"}
            {step === 2 && "Configure your agent settings"}
            {step === 3 && "Choose which scenarios to run"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="text-xs text-gray-600">
                  Fast start: choose <span className="font-medium text-gray-900">HTTP Agent</span> for any custom API endpoint.
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    form.setValue("provider", "http_agent");
                    setStep(2);
                  }}
                >
                  Quick Start HTTP Agent
                </Button>
              </div>
              <Tabs
                value={form.watch("provider")}
                onValueChange={(value) => form.setValue("provider", value as "openai" | "http_agent")}
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="openai">OpenAI</TabsTrigger>
                  <TabsTrigger value="http_agent">HTTP Agent</TabsTrigger>
                </TabsList>
                <TabsContent value="openai" className="mt-6">
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                    <h3 className="font-medium text-gray-900">OpenAI API</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      Evaluate models via OpenAI API or OpenAI-compatible endpoints
                    </p>
                  </div>
                </TabsContent>
                <TabsContent value="http_agent" className="mt-6">
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                    <h3 className="font-medium text-gray-900">HTTP Agent</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      Evaluate custom HTTP-based agents (e.g., RAG services)
                    </p>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}

          {step === 2 && <AgentConfigForm form={form} />}

          {step === 3 && (
            <div className="space-y-6">
              <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
                <h3 className="text-sm font-medium text-gray-900">Execution Mode</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setReleaseMode("release_candidate")}
                    className={`rounded-lg border p-3 text-left transition ${
                      releaseMode === "release_candidate"
                        ? "border-gray-900 bg-white"
                        : "border-gray-200 bg-white/60"
                    }`}
                  >
                    <div className="text-sm font-medium text-gray-900">Release Candidate</div>
                    <div className="mt-1 text-xs text-gray-600">
                      Strict policy-enforced run. Submission is blocked until required coverage is met.
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setReleaseMode("exploratory")}
                    className={`rounded-lg border p-3 text-left transition ${
                      releaseMode === "exploratory"
                        ? "border-gray-900 bg-white"
                        : "border-gray-200 bg-white/60"
                    }`}
                  >
                    <div className="text-sm font-medium text-gray-900">Exploratory</div>
                    <div className="mt-1 text-xs text-gray-600">
                      Fast iterative testing. Marked as non-release and excluded from GO/BLOCK enforcement.
                    </div>
                  </button>
                </div>

                {releaseMode === "release_candidate" && (
                  <div className="rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-700">
                    <div className="font-medium text-gray-900">
                      Policy: {policyName}
                    </div>
                    {availablePolicies.length > 0 && (
                      <div className="mt-2">
                        <label className="mb-1 block text-[11px] font-medium text-gray-700">
                          Policy Version
                        </label>
                        <select
                          value={selectedPolicyId}
                          onChange={(event) => setSelectedPolicyId(event.target.value)}
                          className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                        >
                          {availablePolicies.map((policy) => (
                            <option key={policy.id} value={policy.id}>
                              {policy.name} v{policy.version} ({policy.id})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {policyRequirements ? (
                      <>
                        <div className="mt-1">
                          Minimum scenarios: {policyRequirements.min_total_scenarios}
                        </div>
                        <div className="mt-1">
                          Required tags: {policyRequirements.required_tags.join(", ")}
                        </div>
                        <div className="mt-1">
                          Required IDs: {policyRequirements.required_scenario_ids.join(", ")}
                        </div>
                      </>
                    ) : (
                      <div className="mt-1 text-red-600">
                        {policyLoadError || "Policy requirements unavailable"}
                      </div>
                    )}
                    {!releaseValidation.valid && (
                      <div className="mt-2 text-red-600">
                        Missing: {releaseValidation.violations.slice(0, 3).join(" | ")}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between rounded-lg border border-gray-200 bg-white p-3">
                <div className="text-xs text-gray-600">
                  Recommended pack loaded for <span className="font-medium text-gray-900">{releaseMode === "release_candidate" ? "release candidate" : "exploratory"}</span> mode.
                  {" "}
                  You can still adjust manually below.
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedScenarios(
                        selectRecommendedScenarios({ scenarios, mode: "exploratory" })
                      );
                      setAutoSelectedMode("exploratory");
                      addToast({
                        variant: "success",
                        title: "Exploratory Pack Applied",
                        description: "Loaded quick smoke scenarios.",
                      });
                    }}
                  >
                    Use Exploratory Pack
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedScenarios(
                        selectRecommendedScenarios({ scenarios, mode: "release_candidate" })
                      );
                      setAutoSelectedMode("release_candidate");
                      addToast({
                        variant: "success",
                        title: "Release Pack Applied",
                        description: "Loaded enterprise release candidate scenarios.",
                      });
                    }}
                  >
                    Use Release Pack
                  </Button>
                </div>
              </div>

              <ScenarioSelector
                scenarios={scenarios}
                selectedScenarios={selectedScenarios}
                onSelectionChange={setSelectedScenarios}
              />
            </div>
          )}

          <div className="flex justify-between border-t border-gray-100 pt-6">
            <Button
              variant="ghost"
              onClick={handleBack}
              disabled={step === 1}
            >
              <ChevronLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            {step < 3 ? (
              <Button onClick={handleNext}>
                Next
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={handleRun}
                disabled={
                  loading ||
                  selectedScenarios.length === 0 ||
                  (releaseMode === "release_candidate" && !releaseValidation.valid)
                }
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Starting...
                  </>
                ) : (
                  releaseMode === "release_candidate"
                    ? "Run Release Candidate"
                    : "Run Exploratory Evaluation"
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
