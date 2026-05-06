"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Terminal,
  Wand2,
  Activity,
  Play,
  XCircle,
  Copy,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DisclosurePanel, MetadataGrid, PageHeader, ReportPanel } from "@/components/ui/surface";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  HTTP_AGENT_PRESETS,
  getHttpAgentPresetById,
} from "@/lib/http-agent-presets";
import {
  formatFallback,
  formatScore,
  formatStatusLabel,
} from "@/lib/formatting";

type Method = "GET" | "POST" | "PUT" | "PATCH";

const QUICK_SCENARIO_CANDIDATES = [
  "safety.jailbreak_basic.v1",
  "safety.system_prompt_leak.v2",
  "prompt_injection.instruction_override.v1",
  "pii.ssn_request.v1",
];

interface EvaluationSummarySnapshot {
  total?: number;
  passed?: number;
  failed_minor?: number;
  failed_critical?: number;
  safety_score?: number;
}

export default function BringYourAgentPage() {
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:8000");
  const [apiKey, setApiKey] = useState("");
  const [platformOrigin, setPlatformOrigin] = useState("http://localhost:3000");
  const [selectedPresetId, setSelectedPresetId] = useState("generic");

  const [endpointPath, setEndpointPath] = useState("/agent");
  const [healthPath, setHealthPath] = useState("/health");
  const [method, setMethod] = useState<Method>("POST");
  const [promptField, setPromptField] = useState("query");
  const [responsePath, setResponsePath] = useState("answer");
  const [authHeader, setAuthHeader] = useState("Authorization");
  const [authEnvVar, setAuthEnvVar] = useState("");
  const [authScheme, setAuthScheme] = useState("Bearer");

  const [availableScenarioIds, setAvailableScenarioIds] = useState<string[]>([]);

  const [discovering, setDiscovering] = useState(false);
  const [testing, setTesting] = useState(false);
  const [evaluating, setEvaluating] = useState(false);

  const [healthState, setHealthState] = useState<"idle" | "ok" | "error">("idle");
  const [healthMessage, setHealthMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [lastEvaluationId, setLastEvaluationId] = useState("");
  const [evaluationStatus, setEvaluationStatus] = useState("");
  const [evaluationSummary, setEvaluationSummary] =
    useState<EvaluationSummarySnapshot | null>(null);
  const [sdkTab, setSdkTab] = useState("curl");
  const [copyMessage, setCopyMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadScenarios() {
      try {
        const response = await fetch("/api/scenarios", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok || !Array.isArray(payload?.scenarios)) {
          return;
        }
        if (!cancelled) {
          const ids = payload.scenarios
            .map((scenario: { id?: string }) => scenario?.id)
            .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);
          setAvailableScenarioIds(ids);
        }
      } catch {
        // fallback handled below
      }
    }
    loadScenarios();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setPlatformOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!lastEvaluationId) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fetchStatus = async () => {
      try {
        const headers: Record<string, string> = {};
        if (apiKey.trim()) {
          headers["x-agent-eval-api-key"] = apiKey.trim();
        }
        const response = await fetch(`/api/evaluations/${lastEvaluationId}`, {
          headers,
          cache: "no-store",
        });
        const payload = await response.json();
        if (cancelled || !response.ok) {
          return;
        }

        const status = String(payload?.status || "");
        setEvaluationStatus(status);
        if (payload?.summary && typeof payload.summary === "object") {
          setEvaluationSummary(payload.summary as EvaluationSummarySnapshot);
        }

        if (!["completed", "failed", "cancelled"].includes(status)) {
          timer = setTimeout(fetchStatus, 1500);
        }
      } catch {
        if (!cancelled) {
          timer = setTimeout(fetchStatus, 2000);
        }
      }
    };

    fetchStatus();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [lastEvaluationId, apiKey]);

  const quickScenarios = useMemo(() => {
    if (availableScenarioIds.length === 0) {
      return QUICK_SCENARIO_CANDIDATES.slice(0, 2);
    }
    const available = new Set(availableScenarioIds);
    const preferred = QUICK_SCENARIO_CANDIDATES.filter((id) => available.has(id));
    return preferred.length > 0 ? preferred : availableScenarioIds.slice(0, 2);
  }, [availableScenarioIds]);

  const applyPreset = (presetId: string) => {
    const preset = getHttpAgentPresetById(presetId);
    if (!preset) {
      return;
    }
    setEndpointPath(preset.config.endpointPath);
    setHealthPath(preset.config.healthPath);
    setMethod(preset.config.method);
    setPromptField(preset.config.promptField);
    setResponsePath(preset.config.responsePath);
    setAuthHeader(preset.config.authHeader);
    setAuthScheme(preset.config.authScheme);
    setAuthEnvVar(preset.config.authEnvVar || "");
    setSelectedPresetId(preset.id);
    setStatusMessage(`Preset applied: ${preset.label}`);
  };

  const buildHeaders = () => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey.trim()) {
      headers["x-agent-eval-api-key"] = apiKey.trim();
    }
    return headers;
  };

  const handleAutoDetect = async () => {
    setDiscovering(true);
    setStatusMessage("");
    try {
      const response = await fetch("/api/agent/discover", {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify({
          base_url: baseUrl.trim(),
          endpoint_path: endpointPath || null,
          health_path: healthPath || null,
          method,
          prompt_field: promptField || null,
          response_path: responsePath || null,
          auth_header: authHeader || "Authorization",
          auth_token_env_var: authEnvVar || null,
          auth_scheme: authScheme || "Bearer",
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
      setMethod(payload.recommended.method || "POST");
      setPromptField(payload.recommended.prompt_field || "query");
      setResponsePath(payload.recommended.response_path || "answer");
      setStatusMessage(
        `Detected ${payload.recommended.method} ${payload.recommended.endpoint_path} (${payload.recommended.confidence}% confidence)`
      );
    } catch (error: any) {
      setStatusMessage(error?.message || "Auto-detection failed");
    } finally {
      setDiscovering(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setHealthState("idle");
    setHealthMessage("");
    try {
      const response = await fetch("/api/agent/ping", {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify({
          provider: "http_agent",
          http_agent_base_url: baseUrl.trim(),
          http_agent_endpoint_path: endpointPath || "/agent",
          http_agent_health_path: healthPath || "/health",
          http_agent_method: method,
          http_agent_prompt_field: promptField || "query",
          http_agent_response_path: responsePath || "answer",
          http_agent_auth_header: authHeader || "Authorization",
          http_agent_auth_env_var: authEnvVar || null,
          http_agent_auth_scheme: authScheme || "Bearer",
          timeout_seconds: 10,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || "Connection failed");
      }
      setHealthState("ok");
      setHealthMessage(payload?.message || "Agent reachable");
    } catch (error: any) {
      setHealthState("error");
      setHealthMessage(error?.message || "Connection failed");
    } finally {
      setTesting(false);
    }
  };

  const handleQuickEvaluate = async () => {
    setEvaluating(true);
    setStatusMessage("");
    setLastEvaluationId("");
    setEvaluationStatus("");
    setEvaluationSummary(null);
    try {
      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: buildHeaders(),
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
              endpoint_path: endpointPath || "/agent",
              health_path: healthPath || "/health",
              method,
              prompt_field: promptField || "query",
              response_path: responsePath || "answer",
              auth_header: authHeader || "Authorization",
              auth_token_env_var: authEnvVar || null,
              auth_scheme: authScheme || "Bearer",
            },
          },
          selectedScenarios: quickScenarios,
          releaseMode: "exploratory",
          evaluationName: `Quick Eval ${new Date().toLocaleTimeString()}`,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(
          payload?.error ||
            (response.status === 401
              ? "Unauthorized. Sign in or provide an API key."
              : "Evaluation start failed")
        );
      }
      setLastEvaluationId(payload.evaluationId);
      if (typeof payload.status === "string") {
        setEvaluationStatus(payload.status);
      }
      if (typeof payload.safetyScore === "number") {
        setEvaluationSummary((previous) => ({
          ...(previous || {}),
          safety_score: payload.safetyScore,
        }));
      }
      setStatusMessage(
        payload.inlineExecution
          ? `Evaluation finished: ${payload.evaluationId}`
          : `Evaluation started: ${payload.evaluationId}`
      );
    } catch (error: any) {
      setStatusMessage(error?.message || "Evaluation start failed");
    } finally {
      setEvaluating(false);
    }
  };

  const snippets = useMemo(() => {
    const platformApiKey = apiKey.trim();
    const evalId = lastEvaluationId || "evaluation_id_here";
    const payload = {
      agentType: "http_agent",
      agentConfig: {
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 512,
        max_concurrency: 2,
        timeout_seconds: 20,
        max_retries: 2,
        http_agent: {
          base_url: baseUrl.trim() || "http://127.0.0.1:8000",
          endpoint_path: endpointPath || "/agent",
          health_path: healthPath || "/health",
          method,
          prompt_field: promptField || "query",
          response_path: responsePath || "answer",
          auth_header: authHeader || "Authorization",
          auth_token_env_var: authEnvVar || null,
          auth_scheme: authScheme || "Bearer",
        },
      },
      selectedScenarios: quickScenarios,
      releaseMode: "exploratory",
      evaluationName: "BYOA Quick Eval",
    };

    const baseApi = platformOrigin.replace(/\/$/, "");
    const keyHeaderCurl = platformApiKey
      ? `  -H "x-agent-eval-api-key: ${platformApiKey}" \\`
      : `  # Optional: -H "x-agent-eval-api-key: ael_live_your_api_key" \\`;
    const keyHeaderJs = platformApiKey
      ? `"x-agent-eval-api-key": "${platformApiKey}",`
      : `// "x-agent-eval-api-key": "ael_live_your_api_key",`;
    const keyHeaderPy = platformApiKey
      ? `    "x-agent-eval-api-key": "${platformApiKey}",`
      : `    # "x-agent-eval-api-key": "ael_live_your_api_key",`;

    const curl = `curl -X POST "${baseApi}/api/evaluate" \\
  -H "Content-Type: application/json" \\
${keyHeaderCurl}
  -d '${JSON.stringify(payload)}'

curl "${baseApi}/api/evaluations/${evalId}"`;

    const js = `// API key is optional in PUBLIC_SELF_SERVE_MODE.
const API_KEY = "${platformApiKey || "ael_live_your_api_key"}";

const payload = ${JSON.stringify(payload, null, 2)};

const createResponse = await fetch("${baseApi}/api/evaluate", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ${keyHeaderJs}
  },
  body: JSON.stringify(payload),
});

const createData = await createResponse.json();
const evaluationId = createData.evaluationId;

const resultResponse = await fetch(
  \`${baseApi}/api/evaluations/\${evaluationId}\`,
  {
    headers: {
      ${keyHeaderJs}
    },
  }
);
const resultData = await resultResponse.json();
console.log(resultData);`;

    const python = `import requests

API_KEY = "${platformApiKey || "ael_live_your_api_key"}"
headers = {
    "Content-Type": "application/json",
${keyHeaderPy}
}

payload = ${JSON.stringify(payload, null, 2)}

create_res = requests.post(
    "${baseApi}/api/evaluate",
    headers=headers,
    json=payload,
    timeout=30,
)
create_data = create_res.json()
evaluation_id = create_data["evaluationId"]

result_res = requests.get(
    f"${baseApi}/api/evaluations/{evaluation_id}",
    headers=headers,
    timeout=30,
)
print(result_res.json())`;

    return { curl, js, python };
  }, [
    apiKey,
    lastEvaluationId,
    baseUrl,
    endpointPath,
    healthPath,
    method,
    promptField,
    responsePath,
    authHeader,
    authEnvVar,
    authScheme,
    quickScenarios,
    platformOrigin,
  ]);

  const copySnippet = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage(`${label} snippet copied.`);
    } catch {
      setCopyMessage("Clipboard access is unavailable in this browser context.");
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-gray-900" />
            <span className="text-sm font-semibold text-gray-900">Agent Eval Lab</span>
          </Link>
          <div className="flex items-center gap-3 text-xs">
            <Link href="/integrations" className="text-gray-600 hover:text-gray-900">
              Integration Guide
            </Link>
            <Link href="/sandbox" className="text-gray-600 hover:text-gray-900">
              Playground
            </Link>
            <Link href="/dashboard/evaluations/new" className="text-gray-600 hover:text-gray-900">
              Full Wizard
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <PageHeader
          eyebrow="HTTP onboarding"
          title="Bring your agent"
          description="Connect an HTTP agent, validate the contract, and launch a first evaluation without exposing low-level runtime details as the primary UI."
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Agent Connection</CardTitle>
            <CardDescription>
              Optional API key is only needed when your org enforces API-key auth.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Agent Base URL</label>
                <input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="http://127.0.0.1:8000"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Platform API Key (Optional)</label>
                <input
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="ael_live_..."
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <select
                value={selectedPresetId}
                onChange={(event) => setSelectedPresetId(event.target.value)}
                className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
              >
                {HTTP_AGENT_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label} - {preset.description}
                  </option>
                ))}
              </select>
              <Button variant="outline" onClick={() => applyPreset(selectedPresetId)}>
                Apply Preset
              </Button>
            </div>

            <MetadataGrid
              columns={4}
              items={[
                { label: "Contract", value: `${method} ${endpointPath}` },
                { label: "Health check", value: healthPath },
                { label: "Prompt field", value: promptField },
                { label: "Response path", value: responsePath },
                authEnvVar ? { label: "Auth env var", value: authEnvVar } : null,
              ].filter(Boolean) as Array<{ label: string; value: React.ReactNode }>}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Run Validation</CardTitle>
            <CardDescription>
              Quick evaluation uses {quickScenarios.length} default safety scenarios.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
                    Auto-detect
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={handleTest} disabled={testing}>
                {testing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <Activity className="mr-2 h-4 w-4" />
                    Test Health
                  </>
                )}
              </Button>
              <Button onClick={handleQuickEvaluate} disabled={evaluating}>
                {evaluating ? (
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

            {healthState === "ok" && (
              <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
                <CheckCircle2 className="h-4 w-4" />
                {healthMessage}
              </div>
            )}
            {healthState === "error" && (
              <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                <XCircle className="h-4 w-4" />
                {healthMessage}
              </div>
            )}
            {statusMessage && (
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                {statusMessage}
              </div>
            )}

            {lastEvaluationId && (
              <ReportPanel
                title="Latest evaluation"
                description="This summary updates as the evaluation progresses."
                actions={
                  <a
                    href={`${platformOrigin}/api/evaluations/${lastEvaluationId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Button variant="outline" size="sm">Open evaluation JSON</Button>
                  </a>
                }
              >
                <MetadataGrid
                  columns={4}
                  items={[
                    { label: "Evaluation ID", value: lastEvaluationId },
                    { label: "Status", value: evaluationStatus ? formatStatusLabel(evaluationStatus) : "Starting" },
                    {
                      label: "Safety score",
                      value:
                        typeof evaluationSummary?.safety_score === "number"
                          ? formatScore(evaluationSummary.safety_score)
                          : "Pending",
                    },
                    { label: "Passed", value: evaluationSummary?.passed ?? 0 },
                    { label: "Minor failures", value: evaluationSummary?.failed_minor ?? 0 },
                    { label: "Critical failures", value: evaluationSummary?.failed_critical ?? 0 },
                  ]}
                />
                <div className="mt-4 text-sm text-foreground-muted">
                  Raw endpoint: <code>GET /api/evaluations/{lastEvaluationId}</code>
                </div>
              </ReportPanel>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">SDK and API snippets</CardTitle>
            <CardDescription>
              Useful request examples generated from your current configuration. Kept secondary so the onboarding flow stays product-first.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <DisclosurePanel
              title="Technical request snippets"
              description="Show raw curl, JavaScript, and Python examples."
            >
            <Tabs value={sdkTab} onValueChange={setSdkTab}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="curl">curl</TabsTrigger>
                <TabsTrigger value="js">JavaScript</TabsTrigger>
                <TabsTrigger value="python">Python</TabsTrigger>
              </TabsList>

              <TabsContent value="curl" className="mt-3">
                <div className="flex justify-end pb-2">
                  <Button variant="outline" size="sm" onClick={() => copySnippet(snippets.curl, "curl")}>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy
                  </Button>
                </div>
                <pre className="overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800">
                  {snippets.curl}
                </pre>
              </TabsContent>

              <TabsContent value="js" className="mt-3">
                <div className="flex justify-end pb-2">
                  <Button variant="outline" size="sm" onClick={() => copySnippet(snippets.js, "JavaScript")}>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy
                  </Button>
                </div>
                <pre className="overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800">
                  {snippets.js}
                </pre>
              </TabsContent>

              <TabsContent value="python" className="mt-3">
                <div className="flex justify-end pb-2">
                  <Button variant="outline" size="sm" onClick={() => copySnippet(snippets.python, "Python")}>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy
                  </Button>
                </div>
                <pre className="overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800">
                  {snippets.python}
                </pre>
              </TabsContent>
            </Tabs>
            </DisclosurePanel>

            {copyMessage && (
              <div className="rounded-xl border border-border bg-panel-muted px-3 py-2 text-sm text-foreground-muted">
                {copyMessage}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
