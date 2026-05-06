"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { ScenarioSelector } from "@/components/evaluation/scenario-selector";

type AgentType = "openai" | "http_agent";
type ReleaseMode = "exploratory" | "release_candidate";

interface ScenarioItem {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
}

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

interface BatchWizardProps {
  scenarios: ScenarioItem[];
}

interface AgentCandidate {
  id: string;
  name: string;
  agentType: AgentType;
  model: string;
  temperature: number;
  maxTokens: number;
  baseUrl: string;
  endpointPath: string;
  healthPath: string;
  method: "GET" | "POST" | "PUT" | "PATCH";
  promptField: string;
  responsePath: string;
  authHeader: string;
  authEnvVar: string;
  authScheme: string;
}

function createAgentCandidate(index: number): AgentCandidate {
  return {
    id: `agent-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
    name: `Candidate ${index + 1}`,
    agentType: "http_agent",
    model: "gpt-4o-mini",
    temperature: 0,
    maxTokens: 512,
    baseUrl: "http://127.0.0.1:8000",
    endpointPath: "/agent",
    healthPath: "/health",
    method: "POST",
    promptField: "query",
    responsePath: "answer",
    authHeader: "Authorization",
    authEnvVar: "",
    authScheme: "Bearer",
  };
}

export function BatchWizard({ scenarios }: BatchWizardProps) {
  const router = useRouter();
  const { addToast } = useToast();

  const [evaluationNamePrefix, setEvaluationNamePrefix] = useState("Enterprise Candidate Bakeoff");
  const [releaseMode, setReleaseMode] = useState<ReleaseMode>("release_candidate");
  const [selectedScenarios, setSelectedScenarios] = useState<string[]>([]);
  const [agents, setAgents] = useState<AgentCandidate[]>([
    createAgentCandidate(0),
    createAgentCandidate(1),
  ]);
  const [loading, setLoading] = useState(false);
  const [policyRequirements, setPolicyRequirements] = useState<ReleasePolicyRequirements | null>(null);
  const [policyName, setPolicyName] = useState("enterprise-default");
  const [selectedPolicyId, setSelectedPolicyId] = useState<string>("");
  const [availablePolicies, setAvailablePolicies] = useState<
    Array<{ id: string; name: string; version: number }>
  >([]);
  const [policyLoadError, setPolicyLoadError] = useState<string | null>(null);

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
      if (scenario.id.includes(".")) {
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
      violations.push(`Select at least ${policyRequirements.min_total_scenarios} scenarios`);
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

  const updateAgent = <K extends keyof AgentCandidate>(id: string, key: K, value: AgentCandidate[K]) => {
    setAgents((previous) =>
      previous.map((agent) => (agent.id === id ? { ...agent, [key]: value } : agent))
    );
  };

  const addAgent = () => {
    setAgents((previous) => [...previous, createAgentCandidate(previous.length)]);
  };

  const removeAgent = (id: string) => {
    if (agents.length <= 1) {
      addToast({
        variant: "error",
        title: "Cannot Remove",
        description: "At least one agent candidate is required.",
      });
      return;
    }
    setAgents((previous) => previous.filter((agent) => agent.id !== id));
  };

  const validateBeforeRun = (): string | null => {
    if (selectedScenarios.length === 0) {
      return "Select at least one scenario.";
    }

    if (releaseMode === "release_candidate" && !releaseValidation.valid) {
      return releaseValidation.violations[0] || "Release candidate requirements are not met.";
    }

    for (const [index, agent] of agents.entries()) {
      if (!agent.name.trim()) {
        return `Agent ${index + 1} needs a name.`;
      }
      if (agent.agentType === "openai" && !agent.model.trim()) {
        return `Agent ${index + 1} needs a model name.`;
      }
      if (agent.agentType === "http_agent") {
        if (!agent.baseUrl.trim()) {
          return `Agent ${index + 1} needs an HTTP base URL.`;
        }
        if (!agent.endpointPath.trim()) {
          return `Agent ${index + 1} needs an endpoint path.`;
        }
        if (!agent.healthPath.trim()) {
          return `Agent ${index + 1} needs a health path.`;
        }
      }
    }

    return null;
  };

  const handleRunBatch = async () => {
    const validationError = validateBeforeRun();
    if (validationError) {
      addToast({
        variant: "error",
        title: "Validation Error",
        description: validationError,
      });
      return;
    }

    setLoading(true);
    try {
      const payload = {
        evaluationNamePrefix: evaluationNamePrefix.trim() || "Batch Eval",
        releaseMode,
        releasePolicyId: selectedPolicyId || undefined,
        selectedScenarios,
        agents: agents.map((agent) => {
          if (agent.agentType === "openai") {
            return {
              name: agent.name.trim(),
              agentType: "openai",
              agentConfig: {
                model: agent.model,
                temperature: agent.temperature,
                max_tokens: agent.maxTokens,
              },
            };
          }

          return {
            name: agent.name.trim(),
            agentType: "http_agent",
            agentConfig: {
              http_agent: {
                base_url: agent.baseUrl.trim(),
                endpoint_path: agent.endpointPath.trim(),
                health_path: agent.healthPath.trim(),
                method: agent.method,
                prompt_field: agent.promptField.trim() || "query",
                response_path: agent.responsePath.trim() || "answer",
                auth_header: agent.authHeader.trim() || "Authorization",
                auth_token_env_var: agent.authEnvVar.trim() || null,
                auth_scheme: agent.authScheme.trim() || "Bearer",
              },
            },
          };
        }),
      };

      const response = await fetch("/api/evaluations/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        if (Array.isArray(result?.violations) && result.violations.length > 0) {
          throw new Error(`${result.error} (${result.violations[0]})`);
        }
        throw new Error(result?.error || "Failed to start batch");
      }

      addToast({
        variant: "success",
        title: "Batch Started",
        description: `Started ${result.totalAgents || agents.length} evaluations in batch ${result.batchId}.`,
      });
      router.push(`/dashboard/batches/${result.batchId}`);
    } catch (error: any) {
      addToast({
        variant: "error",
        title: "Batch Failed",
        description: error?.message || "Failed to create batch evaluation.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900">New Batch Evaluation</h1>
        <p className="mt-2 text-sm text-gray-500">
          Compare multiple agent candidates against one scenario suite and select a release winner.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Batch Setup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Batch Name Prefix</label>
            <Input
              value={evaluationNamePrefix}
              onChange={(event) => setEvaluationNamePrefix(event.target.value)}
              placeholder="Enterprise Candidate Bakeoff"
            />
          </div>

          <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-900">Execution Mode</div>
                <div className="mt-1 text-xs text-gray-600">
                  Policy: {policyName}
                </div>
              </div>
            </div>
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
                <div className="mt-1 text-xs text-gray-600">Strict policy enforcement with GO/BLOCK gate.</div>
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
                <div className="mt-1 text-xs text-gray-600">Faster iteration without release gate blocking.</div>
              </button>
            </div>

            {releaseMode === "release_candidate" && (
              <div className="rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-700">
                <div className="font-medium">Release Policy Checks</div>
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
                {releaseValidation.valid ? (
                  <div className="mt-1 text-green-700">Coverage meets release requirements.</div>
                ) : (
                  <ul className="mt-2 space-y-1 text-red-700">
                    {releaseValidation.violations.slice(0, 4).map((violation) => (
                      <li key={violation}>• {violation}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agent Candidates ({agents.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {agents.map((agent, index) => (
            <div key={agent.id} className="space-y-4 rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">Candidate {index + 1}</Badge>
                  <Input
                    value={agent.name}
                    onChange={(event) => updateAgent(agent.id, "name", event.target.value)}
                    className="h-8 w-52"
                    placeholder={`Candidate ${index + 1}`}
                  />
                </div>
                <Button variant="outline" size="sm" onClick={() => removeAgent(agent.id)}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remove
                </Button>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">Type</label>
                  <select
                    value={agent.agentType}
                    onChange={(event) =>
                      updateAgent(agent.id, "agentType", event.target.value as AgentType)
                    }
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                  >
                    <option value="http_agent">HTTP Agent</option>
                    <option value="openai">OpenAI API</option>
                  </select>
                </div>

                {agent.agentType === "openai" ? (
                  <>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-gray-700">Model</label>
                      <Input
                        value={agent.model}
                        onChange={(event) => updateAgent(agent.id, "model", event.target.value)}
                        placeholder="gpt-4o-mini"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-gray-700">Temperature</label>
                      <Input
                        type="number"
                        step="0.1"
                        value={agent.temperature}
                        onChange={(event) =>
                          updateAgent(agent.id, "temperature", Number(event.target.value || 0))
                        }
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-gray-700">Max Tokens</label>
                      <Input
                        type="number"
                        value={agent.maxTokens}
                        onChange={(event) =>
                          updateAgent(agent.id, "maxTokens", Number(event.target.value || 512))
                        }
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-gray-700">Base URL</label>
                      <Input
                        value={agent.baseUrl}
                        onChange={(event) => updateAgent(agent.id, "baseUrl", event.target.value)}
                        placeholder="http://127.0.0.1:8000"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-gray-700">Method</label>
                      <select
                        value={agent.method}
                        onChange={(event) =>
                          updateAgent(
                            agent.id,
                            "method",
                            event.target.value as AgentCandidate["method"]
                          )
                        }
                        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                      >
                        <option value="POST">POST</option>
                        <option value="GET">GET</option>
                        <option value="PUT">PUT</option>
                        <option value="PATCH">PATCH</option>
                      </select>
                    </div>
                  </>
                )}
              </div>

              {agent.agentType === "http_agent" && (
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">Endpoint Path</label>
                    <Input
                      value={agent.endpointPath}
                      onChange={(event) =>
                        updateAgent(agent.id, "endpointPath", event.target.value)
                      }
                      placeholder="/agent"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">Health Path</label>
                    <Input
                      value={agent.healthPath}
                      onChange={(event) => updateAgent(agent.id, "healthPath", event.target.value)}
                      placeholder="/health"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">Prompt Field</label>
                    <Input
                      value={agent.promptField}
                      onChange={(event) => updateAgent(agent.id, "promptField", event.target.value)}
                      placeholder="query"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">Response Path</label>
                    <Input
                      value={agent.responsePath}
                      onChange={(event) =>
                        updateAgent(agent.id, "responsePath", event.target.value)
                      }
                      placeholder="answer"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">Auth Header</label>
                    <Input
                      value={agent.authHeader}
                      onChange={(event) => updateAgent(agent.id, "authHeader", event.target.value)}
                      placeholder="Authorization"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">Auth Env Var (Optional)</label>
                    <Input
                      value={agent.authEnvVar}
                      onChange={(event) => updateAgent(agent.id, "authEnvVar", event.target.value)}
                      placeholder="MOCK_AGENT_API_KEY"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">Auth Scheme</label>
                    <Input
                      value={agent.authScheme}
                      onChange={(event) => updateAgent(agent.id, "authScheme", event.target.value)}
                      placeholder="Bearer or raw"
                    />
                  </div>
                </div>
              )}
            </div>
          ))}

          <Button variant="outline" onClick={addAgent}>
            <Plus className="mr-2 h-4 w-4" />
            Add Candidate
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scenario Suite</CardTitle>
        </CardHeader>
        <CardContent>
          <ScenarioSelector
            scenarios={scenarios}
            selectedScenarios={selectedScenarios}
            onSelectionChange={setSelectedScenarios}
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <Button variant="outline" onClick={() => router.push("/dashboard/batches")}>Cancel</Button>
        <Button onClick={handleRunBatch} disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Starting Batch...
            </>
          ) : (
            `Run Batch (${agents.length} agents)`
          )}
        </Button>
      </div>
    </div>
  );
}
