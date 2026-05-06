"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DisclosurePanel, MetadataGrid } from "@/components/ui/surface";
import { useToast } from "@/components/ui/toast";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Send,
  Activity,
  Wand2,
  Play,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  HTTP_AGENT_PRESETS,
  getHttpAgentPresetById,
} from "@/lib/http-agent-presets";
import { formatFallback, formatLatency } from "@/lib/formatting";

interface QueryResult {
  answer: string;
  details?: {
    endpoint?: string;
    latencyMs?: number;
    context_snippets?: string[];
    metadata?: Record<string, unknown>;
  };
}

interface DiscoveryResult {
  recommended?: {
    endpoint_path: string;
    health_path: string | null;
    method: "GET" | "POST" | "PUT" | "PATCH";
    prompt_field: string;
    response_path: string;
    confidence: number;
  };
  diagnostics?: {
    health_checks?: Array<{
      path: string;
      status: number;
      ok: boolean;
      latency_ms: number;
      error?: string;
    }>;
    probes?: Array<{
      endpoint_path: string;
      method: string;
      prompt_field: string;
      response_path: string | null;
      status: number;
      ok: boolean;
      latency_ms: number;
      error?: string;
    }>;
  };
}

const QUICK_SCENARIO_CANDIDATES = [
  "safety.jailbreak_basic.v1",
  "safety.system_prompt_leak.v2",
  "prompt_injection.instruction_override.v1",
  "pii.ssn_request.v1",
];

export function HttpAgentPlayground() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addToast } = useToast();
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:8000");
  const [endpointPath, setEndpointPath] = useState("/agent");
  const [healthPath, setHealthPath] = useState("/health");
  const [method, setMethod] = useState<"GET" | "POST" | "PUT" | "PATCH">("POST");
  const [promptField, setPromptField] = useState("query");
  const [responsePath, setResponsePath] = useState("answer");
  const [authHeader, setAuthHeader] = useState("Authorization");
  const [authEnvVar, setAuthEnvVar] = useState("");
  const [authScheme, setAuthScheme] = useState("Bearer");
  const [query, setQuery] = useState("What does this knowledge base contain?");
  const [testing, setTesting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [quickEvaluating, setQuickEvaluating] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState("generic");
  const [healthStatus, setHealthStatus] = useState<"idle" | "ok" | "error">("idle");
  const [healthMessage, setHealthMessage] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [availableScenarioIds, setAvailableScenarioIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function loadScenarioIds() {
      try {
        const response = await fetch("/api/scenarios", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok || !Array.isArray(payload?.scenarios)) {
          return;
        }
        if (!cancelled) {
          setAvailableScenarioIds(
            payload.scenarios
              .map((scenario: { id?: string }) => scenario?.id)
              .filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
          );
        }
      } catch {
        // ignore; fallback scenario list will be used
      }
    }

    loadScenarioIds();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyPreset = (presetId: string, showAdvancedFields: boolean) => {
    const preset = getHttpAgentPresetById(presetId);
    if (!preset) {
      return;
    }
    setSelectedPresetId(preset.id);
    setEndpointPath(preset.config.endpointPath);
    setHealthPath(preset.config.healthPath);
    setMethod(preset.config.method);
    setPromptField(preset.config.promptField);
    setResponsePath(preset.config.responsePath);
    setAuthHeader(preset.config.authHeader);
    setAuthScheme(preset.config.authScheme);
    if (preset.config.authEnvVar) {
      setAuthEnvVar(preset.config.authEnvVar);
    }
    if (showAdvancedFields) {
      setShowAdvanced(true);
    }
  };

  useEffect(() => {
    const presetId = searchParams.get("preset");
    if (presetId) {
      applyPreset(presetId, true);
    }
    const baseUrlParam = searchParams.get("baseUrl");
    if (baseUrlParam) {
      setBaseUrl(baseUrlParam);
    }
  }, [searchParams]);

  const quickScenarios = useMemo(() => {
    if (availableScenarioIds.length === 0) {
      return QUICK_SCENARIO_CANDIDATES.slice(0, 2);
    }
    const available = new Set(availableScenarioIds);
    const selected = QUICK_SCENARIO_CANDIDATES.filter((scenarioId) =>
      available.has(scenarioId)
    );
    return selected.length > 0 ? selected : availableScenarioIds.slice(0, 2);
  }, [availableScenarioIds]);

  const handleTestConnection = async () => {
    setTesting(true);
    setHealthStatus("idle");
    setHealthMessage("");

    try {
      const response = await fetch("/api/agent/ping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "http_agent",
          http_agent_base_url: baseUrl.trim(),
          http_agent_endpoint_path: endpointPath.trim() || "/agent",
          http_agent_health_path: healthPath.trim() || "/health",
          http_agent_method: method,
          http_agent_prompt_field: promptField.trim() || "query",
          http_agent_response_path: responsePath.trim() || "answer",
          http_agent_auth_header: authHeader.trim() || "Authorization",
          http_agent_auth_env_var: authEnvVar.trim() || null,
          http_agent_auth_scheme: authScheme.trim() || "Bearer",
          timeout_seconds: 10,
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || "Connection test failed");
      }

      setHealthStatus("ok");
      const message = payload?.message || "HTTP agent is reachable";
      setHealthMessage(message);
      addToast({
        variant: "success",
        title: "Agent Reachable",
        description: message,
      });
    } catch (error: any) {
      setHealthStatus("error");
      const message = error?.message || "Could not reach HTTP agent";
      setHealthMessage(message);
      addToast({
        variant: "error",
        title: "Connection Failed",
        description: message,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleAutoDetect = async () => {
    setDiscovering(true);
    setDiscovery(null);
    try {
      const response = await fetch("/api/agent/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_url: baseUrl.trim(),
          endpoint_path: endpointPath.trim() || null,
          health_path: healthPath.trim() || null,
          method,
          prompt_field: promptField.trim() || null,
          response_path: responsePath.trim() || null,
          auth_header: authHeader.trim() || "Authorization",
          auth_token_env_var: authEnvVar.trim() || null,
          auth_scheme: authScheme.trim() || "Bearer",
          timeout_seconds: 8,
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload?.success || !payload?.recommended) {
        throw new Error(payload?.error || "Auto-detection failed");
      }

      setEndpointPath(payload.recommended.endpoint_path || "/agent");
      if (payload.recommended.health_path) {
        setHealthPath(payload.recommended.health_path);
      }
      setMethod(payload.recommended.method);
      setPromptField(payload.recommended.prompt_field || "query");
      setResponsePath(payload.recommended.response_path || "answer");
      setShowAdvanced(true);
      setDiscovery(payload);

      addToast({
        variant: "success",
        title: "Auto-detection Complete",
        description: `Detected ${payload.recommended.method} ${payload.recommended.endpoint_path} (${payload.recommended.confidence}% confidence).`,
      });
    } catch (error: any) {
      addToast({
        variant: "error",
        title: "Auto-detection Failed",
        description: error?.message || "Could not auto-detect this agent contract.",
      });
    } finally {
      setDiscovering(false);
    }
  };

  const handleRunQuery = async () => {
    if (!query.trim()) {
      addToast({
        variant: "error",
        title: "Query Required",
        description: "Please enter a prompt for the agent.",
      });
      return;
    }

    setQuerying(true);
    setResult(null);

    try {
      const response = await fetch("/api/agent/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_url: baseUrl.trim(),
          endpoint_path: endpointPath.trim() || "/agent",
          method,
          prompt_field: promptField.trim() || "query",
          response_path: responsePath.trim() || "answer",
          auth_header: authHeader.trim() || "Authorization",
          auth_token_env_var: authEnvVar.trim() || null,
          auth_scheme: authScheme.trim() || "Bearer",
          query: query.trim(),
          timeout_seconds: 20,
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || "Agent query failed");
      }

      setResult({
        answer: payload.answer,
        details: payload.details,
      });
    } catch (error: any) {
      addToast({
        variant: "error",
        title: "Query Failed",
        description: error?.message || "Could not get a response from agent.",
      });
    } finally {
      setQuerying(false);
    }
  };

  const handleQuickEvaluate = async () => {
    if (!baseUrl.trim()) {
      addToast({
        variant: "error",
        title: "Base URL Required",
        description: "Enter your agent base URL before running evaluation.",
      });
      return;
    }

    if (quickScenarios.length === 0) {
      addToast({
        variant: "error",
        title: "No Scenarios Available",
        description: "Scenario catalog is empty. Add scenarios before running.",
      });
      return;
    }

    setQuickEvaluating(true);
    try {
      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentType: "http_agent",
          agentConfig: {
            model: "gpt-4o-mini",
            temperature: 0,
            max_tokens: 512,
            max_concurrency: 2,
            timeout_seconds: 20,
            max_retries: 2,
            http_agent: {
              base_url: baseUrl.trim(),
              endpoint_path: endpointPath.trim() || "/agent",
              health_path: healthPath.trim() || "/health",
              method,
              prompt_field: promptField.trim() || "query",
              response_path: responsePath.trim() || "answer",
              auth_header: authHeader.trim() || "Authorization",
              auth_token_env_var: authEnvVar.trim() || null,
              auth_scheme: authScheme.trim() || "Bearer",
            },
          },
          selectedScenarios: quickScenarios,
          releaseMode: "exploratory",
          evaluationName: `Quick Eval ${new Date().toLocaleTimeString()}`,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || "Failed to start quick evaluation");
      }

      addToast({
        variant: "success",
        title: "Quick Evaluation Started",
        description: `${quickScenarios.length} scenarios are running now.`,
      });
      router.push(`/dashboard/evaluations/${payload.evaluationId}`);
    } catch (error: any) {
      addToast({
        variant: "error",
        title: "Quick Evaluation Failed",
        description: error?.message || "Could not start quick evaluation.",
      });
    } finally {
      setQuickEvaluating(false);
    }
  };

  return (
    <Card className="border-gray-200">
      <CardHeader>
        <CardTitle className="text-xl">HTTP Agent Playground</CardTitle>
        <CardDescription>
          Validate your agent behavior before running red-team scenarios.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Agent Base URL</label>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            placeholder="http://127.0.0.1:8000"
          />
          <p className="mt-1 text-xs text-gray-500">Use any HTTP agent URL (localhost allowed in dev).</p>
        </div>

        <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium text-foreground">
              Active contract
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAdvanced((current) => !current)}
            >
              {showAdvanced ? (
                <>
                  <ChevronUp className="mr-2 h-3.5 w-3.5" />
                  Hide Advanced
                </>
              ) : (
                <>
                  <ChevronDown className="mr-2 h-3.5 w-3.5" />
                  Edit Contract
                </>
              )}
            </Button>
          </div>
          <div className="mt-3">
            <MetadataGrid
              columns={4}
              items={[
                { label: "Endpoint", value: `${method} ${endpointPath || "/agent"}` },
                { label: "Prompt field", value: promptField || "query" },
                { label: "Response path", value: responsePath || "answer" },
                { label: "Health path", value: healthPath || "/health" },
              ]}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={selectedPresetId}
              onChange={(event) => {
                const nextPresetId = event.target.value;
                setSelectedPresetId(nextPresetId);
              }}
              className="h-8 min-w-[220px] rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            >
              {HTTP_AGENT_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                applyPreset(selectedPresetId, true);
                const preset = getHttpAgentPresetById(selectedPresetId);
                addToast({
                  variant: "success",
                  title: "Preset Applied",
                  description: preset?.description || "Contract preset loaded.",
                });
              }}
            >
              Apply Preset
            </Button>
          </div>
        </div>

        {showAdvanced && (
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Endpoint Path</label>
              <input
                value={endpointPath}
                onChange={(e) => setEndpointPath(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                placeholder="/agent"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Health Path</label>
              <input
                value={healthPath}
                onChange={(e) => setHealthPath(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                placeholder="/health"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Method</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as "GET" | "POST" | "PUT" | "PATCH")}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
              >
                <option value="POST">POST</option>
                <option value="GET">GET</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Prompt Field</label>
              <input
                value={promptField}
                onChange={(e) => setPromptField(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                placeholder="query"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Response Path</label>
              <input
                value={responsePath}
                onChange={(e) => setResponsePath(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                placeholder="answer"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Auth Header</label>
              <input
                value={authHeader}
                onChange={(e) => setAuthHeader(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                placeholder="Authorization"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Auth Env Var (Optional)</label>
              <input
                value={authEnvVar}
                onChange={(e) => setAuthEnvVar(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                placeholder="MY_AGENT_API_KEY"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Auth Scheme</label>
              <input
                value={authScheme}
                onChange={(e) => setAuthScheme(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                placeholder="Bearer"
              />
              <p className="mt-1 text-xs text-gray-500">Use <code>raw</code> for x-api-key style tokens.</p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={handleAutoDetect} disabled={discovering}>
            {discovering ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Detecting...
              </>
            ) : (
              <>
                <Wand2 className="mr-2 h-4 w-4" />
                Auto-detect Config
              </>
            )}
          </Button>
          <Button variant="outline" onClick={handleTestConnection} disabled={testing}>
            {testing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <Activity className="mr-2 h-4 w-4" />
                Test Agent Health
              </>
            )}
          </Button>
          {healthStatus === "ok" && (
            <div className="flex items-center gap-2 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4" />
              {healthMessage}
            </div>
          )}
          {healthStatus === "error" && (
            <div className="flex items-center gap-2 text-sm text-red-700">
              <XCircle className="h-4 w-4" />
              {healthMessage}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between rounded-md border border-gray-200 bg-gray-50 p-3">
          <div className="text-sm text-foreground-muted">
            One-click evaluation runs <span className="font-medium text-foreground">{quickScenarios.length}</span> core safety scenarios.
          </div>
          <Button onClick={handleQuickEvaluate} disabled={quickEvaluating}>
            {quickEvaluating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Run Quick Evaluation
              </>
            )}
          </Button>
        </div>

        {discovery?.recommended && (
          <div className="rounded-xl border border-accent/10 bg-accent/5 p-4">
            <div className="text-sm font-semibold text-foreground">Detected contract</div>
            <div className="mt-3">
              <MetadataGrid
                columns={4}
                items={[
                  {
                    label: "Endpoint",
                    value: `${discovery.recommended.method} ${discovery.recommended.endpoint_path}`,
                  },
                  { label: "Prompt field", value: discovery.recommended.prompt_field },
                  { label: "Response path", value: discovery.recommended.response_path },
                  { label: "Confidence", value: `${discovery.recommended.confidence}%` },
                ]}
              />
            </div>
          </div>
        )}

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Try a Prompt</label>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            placeholder="Ask your agent a question..."
          />
        </div>

        <div>
          <Button onClick={handleRunQuery} disabled={querying}>
            {querying ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Querying...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Send Prompt to Agent
              </>
            )}
          </Button>
        </div>

        {result && (
          <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div>
              <div className="text-sm font-medium text-foreground">Agent response</div>
              <div className="mt-3 whitespace-pre-wrap rounded-xl bg-panel p-4 text-sm leading-6 text-foreground-muted">
                {result.answer}
              </div>
            </div>

            <MetadataGrid
              columns={2}
              items={[
                { label: "Endpoint", value: formatFallback(result.details?.endpoint) },
                { label: "Latency", value: formatLatency(result.details?.latencyMs) },
              ]}
            />

            {result.details?.context_snippets && result.details.context_snippets.length > 0 && (
              <div className="rounded-md border border-gray-200 bg-white p-3">
                <div className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-foreground-subtle">Context snippets</div>
                <ul className="space-y-2 text-sm text-foreground-muted">
                  {result.details.context_snippets.map((snippet, idx) => (
                    <li key={idx} className="rounded-xl bg-panel-muted p-3">
                      {snippet}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <DisclosurePanel
              title="Technical details"
              description="Inspect transport metadata for this playground request."
            >
              <div className="overflow-auto rounded-xl bg-panel-muted p-4">
                <pre className="text-xs leading-6 text-foreground-muted">
                  {JSON.stringify(result.details?.metadata || {}, null, 2)}
                </pre>
              </div>
            </DisclosurePanel>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
