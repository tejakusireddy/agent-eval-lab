"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";

import { AppLayout } from "@/components/layout/app-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";

const MAX_SCENARIOS = 20;

const ProbeResponseSchema = z.object({
  reachable: z.boolean(),
  status_code: z.number().nullable(),
  latency_ms: z.number().nullable(),
  error: z.string().nullable(),
});

const ScenarioItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  attack_type: z.string().nullable().optional(),
});

const ScenariosApiSchema = z.object({
  spec_version: z.literal("1.0"),
  scenarios: z.array(ScenarioItemSchema),
  total: z.number(),
  grouped: z.record(z.string(), z.array(ScenarioItemSchema)),
});

const KeysListSchema = z.object({
  success: z.literal(true),
  keys: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      prefix: z.string(),
      createdAt: z.coerce.string(),
    })
  ),
});

const CreateKeyResponseSchema = z.object({
  success: z.literal(true),
  secret: z.string(),
  apiKey: z.object({
    id: z.string(),
    name: z.string(),
    prefix: z.string(),
  }),
});

const EvaluateResponseSchema = z.object({
  success: z.literal(true),
  evaluationId: z.string(),
});

type ScenarioItem = z.infer<typeof ScenarioItemSchema>;

function truncate(s: string, n: number): string {
  if (s.length <= n) {
    return s;
  }
  return `${s.slice(0, n - 1)}…`;
}

function parseAgentUrl(
  raw: string
): { base_url: string; endpoint_path: string } | null {
  try {
    const u = new URL(raw.trim());
    const base_url = u.origin;
    const endpoint_path = u.pathname && u.pathname !== "" ? u.pathname : "/";
    return { base_url, endpoint_path };
  } catch {
    return null;
  }
}

function buildCurlCommand(params: {
  baseUrl: string;
  endpointUrl: string;
  method: string;
  promptField: string;
  responsePath: string;
  scenarioIds: string[];
  apiKeyPlaceholder: string;
}): string {
  const body = {
    spec_version: "1.0" as const,
    agent: {
      endpoint_url: params.endpointUrl,
      method: params.method,
      prompt_field: params.promptField,
      response_path: params.responsePath,
      health_path: null as null,
      auth: null as null,
    },
    scenarios: params.scenarioIds,
    release_mode: "exploratory" as const,
  };
  const json = JSON.stringify(body, null, 2);
  const payload = JSON.stringify(json);
  return [
    `curl -X POST "${params.baseUrl}/api/v1/eval" \\`,
    `  -H "Authorization: Bearer ${params.apiKeyPlaceholder}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d ${payload}`,
  ].join("\n");
}

export default function OnboardingPage(): React.ReactElement {
  const router = useRouter();
  const { addToast } = useToast();
  const [step, setStep] = useState(1);

  const [endpointUrl, setEndpointUrl] = useState("");
  const [endpointTouched, setEndpointTouched] = useState(false);
  const [method, setMethod] = useState<"POST" | "GET" | "PUT" | "PATCH">(
    "POST"
  );
  const [promptField, setPromptField] = useState("query");
  const [responsePath, setResponsePath] = useState("answer");
  const [authToken, setAuthToken] = useState("");
  const [showToken, setShowToken] = useState(false);

  const [probePending, setProbePending] = useState(false);
  const [probeResult, setProbeResult] = useState<z.infer<
    typeof ProbeResponseSchema
  > | null>(null);

  const [scenariosLoading, setScenariosLoading] = useState(false);
  const [scenariosError, setScenariosError] = useState<string | null>(null);
  const [scenariosPayload, setScenariosPayload] = useState<z.infer<
    typeof ScenariosApiSchema
  > | null>(null);
  const [scenarioSearch, setScenarioSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [keysLoading, setKeysLoading] = useState(false);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [keysList, setKeysList] = useState<
    z.infer<typeof KeysListSchema>["keys"]
  >([]);
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [createKeyPending, setCreateKeyPending] = useState(false);
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
  const [pasteKeyMode, setPasteKeyMode] = useState(false);
  const [pastedKey, setPastedKey] = useState("");

  const [runPending, setRunPending] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runSuccess, setRunSuccess] = useState(false);

  const endpointValid = useMemo(() => {
    const t = endpointUrl.trim();
    if (!t) {
      return false;
    }
    return z.string().url().safeParse(t).success;
  }, [endpointUrl]);

  const curlApiKey = useMemo(() => {
    if (freshSecret) {
      return freshSecret;
    }
    if (pasteKeyMode && pastedKey.trim()) {
      return pastedKey.trim();
    }
    if (selectedKeyId) {
      return "YOUR_SAVED_API_KEY";
    }
    return "YOUR_API_KEY";
  }, [freshSecret, pasteKeyMode, pastedKey, selectedKeyId]);

  const curlCommand = useMemo(() => {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://app.example.com";
    return buildCurlCommand({
      baseUrl: origin,
      endpointUrl: endpointUrl.trim(),
      method,
      promptField,
      responsePath,
      scenarioIds: Array.from(selectedIds),
      apiKeyPlaceholder: curlApiKey,
    });
  }, [
    endpointUrl,
    method,
    promptField,
    responsePath,
    selectedIds,
    curlApiKey,
  ]);

  const loadScenarios = useCallback(async () => {
    setScenariosLoading(true);
    setScenariosError(null);
    try {
      const res = await fetch("/api/v1/scenarios");
      const data: unknown = await res.json();
      const parsed = ScenariosApiSchema.safeParse(data);
      if (!parsed.success) {
        setScenariosError("Invalid scenarios response");
        setScenariosPayload(null);
        return;
      }
      setScenariosPayload(parsed.data);
    } catch {
      setScenariosError("Could not load scenarios");
      setScenariosPayload(null);
    } finally {
      setScenariosLoading(false);
    }
  }, []);

  const loadKeys = useCallback(async () => {
    setKeysLoading(true);
    setKeysError(null);
    try {
      const res = await fetch("/api/keys");
      if (res.status === 403) {
        setKeysError(
          "Only organization admins can list or create API keys here. Use “I already have a key” to paste your secret, or ask an admin."
        );
        setKeysList([]);
        return;
      }
      if (!res.ok) {
        setKeysError("Could not load API keys");
        setKeysList([]);
        return;
      }
      const data: unknown = await res.json();
      const parsed = KeysListSchema.safeParse(data);
      if (!parsed.success) {
        setKeysError("Invalid keys response");
        setKeysList([]);
        return;
      }
      setKeysList(parsed.data.keys);
    } catch {
      setKeysError("Could not load API keys");
      setKeysList([]);
    } finally {
      setKeysLoading(false);
    }
  }, []);

  useEffect(() => {
    if (step === 2) {
      void loadScenarios();
    }
  }, [step, loadScenarios]);

  useEffect(() => {
    if (step === 3) {
      void loadKeys();
    }
  }, [step, loadKeys]);

  const filteredGrouped = useMemo(() => {
    if (!scenariosPayload) {
      return {} as Record<string, ScenarioItem[]>;
    }
    const q = scenarioSearch.trim().toLowerCase();
    const out: Record<string, ScenarioItem[]> = {};
    for (const [tag, list] of Object.entries(scenariosPayload.grouped)) {
      const filtered = list.filter((s) => {
        if (!q) {
          return true;
        }
        if (s.name.toLowerCase().includes(q)) {
          return true;
        }
        return s.tags.some((t) => t.toLowerCase().includes(q));
      });
      if (filtered.length > 0) {
        out[tag] = filtered;
      }
    }
    return out;
  }, [scenariosPayload, scenarioSearch]);

  const filteredFlat = useMemo(() => {
    const lists = Object.values(filteredGrouped);
    return lists.flat();
  }, [filteredGrouped]);

  const totalScenarios = scenariosPayload?.total ?? 0;

  const toggleScenario = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= MAX_SCENARIOS) {
          addToast({
            title: "Scenario limit",
            description: `You can select at most ${MAX_SCENARIOS} scenarios per evaluation.`,
            variant: "warning",
          });
          return prev;
        }
        next.add(id);
      }
      return next;
    });
  };

  const toggleGroup = (tag: string, list: ScenarioItem[]) => {
    const ids = list.map((s) => s.id);
    const allSelected = ids.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const id of ids) {
          next.delete(id);
        }
      } else {
        for (const id of ids) {
          if (next.size >= MAX_SCENARIOS && !next.has(id)) {
            addToast({
              title: "Scenario limit",
              description: `You can select at most ${MAX_SCENARIOS} scenarios per evaluation.`,
              variant: "warning",
            });
            return prev;
          }
          next.add(id);
        }
      }
      return next;
    });
  };

  const runProbe = async () => {
    if (!endpointValid) {
      return;
    }
    setProbePending(true);
    setProbeResult(null);
    try {
      const res = await fetch("/api/v1/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: endpointUrl.trim() }),
      });
      const data: unknown = await res.json();
      const parsed = ProbeResponseSchema.safeParse(data);
      if (!parsed.success) {
        setProbeResult({
          reachable: false,
          status_code: null,
          latency_ms: null,
          error: "Invalid probe response",
        });
        return;
      }
      setProbeResult(parsed.data);
    } catch {
      setProbeResult({
        reachable: false,
        status_code: null,
        latency_ms: null,
        error: "Request failed",
      });
    } finally {
      setProbePending(false);
    }
  };

  const createKey = async () => {
    const name = newKeyName.trim();
    if (!name) {
      return;
    }
    setCreateKeyPending(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data: unknown = await res.json();
      const parsed = CreateKeyResponseSchema.safeParse(data);
      if (!parsed.success) {
        addToast({
          title: "Could not create key",
          description:
            typeof (data as { error?: string })?.error === "string"
              ? (data as { error: string }).error
              : "Try again or ask an admin.",
          variant: "error",
        });
        return;
      }
      setFreshSecret(parsed.data.secret);
      setSelectedKeyId(parsed.data.apiKey.id);
      setKeysList((prev) => [
        {
          id: parsed.data.apiKey.id,
          name: parsed.data.apiKey.name,
          prefix: parsed.data.apiKey.prefix,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      addToast({ title: "API key created", variant: "success" });
    } finally {
      setCreateKeyPending(false);
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      addToast({ title: `${label} copied`, variant: "success" });
    } catch {
      addToast({ title: "Copy failed", variant: "error" });
    }
  };

  const runEvaluation = async () => {
    const parsed = parseAgentUrl(endpointUrl);
    if (!parsed) {
      setRunError("Invalid agent URL");
      return;
    }
    if (selectedIds.size === 0) {
      setRunError("Select at least one scenario");
      return;
    }
    setRunPending(true);
    setRunError(null);
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentType: "http_agent",
          agentConfig: {
            model: "gpt-4o-mini",
            http_agent: {
              base_url: parsed.base_url,
              endpoint_path: parsed.endpoint_path,
              health_path: "/health",
              method,
              prompt_field: promptField,
              response_path: responsePath,
              auth_header: "Authorization",
              auth_scheme: "Bearer",
              auth_token_env_var: null,
            },
          },
          selectedScenarios: Array.from(selectedIds),
          releaseMode: "exploratory",
          evaluationName: "Onboarding Evaluation",
        }),
      });
      const data: unknown = await res.json();
      if (!res.ok) {
        const msg =
          typeof (data as { error?: string })?.error === "string"
            ? (data as { error: string }).error
            : "Evaluation failed to start";
        setRunError(msg);
        return;
      }
      const parsedRes = EvaluateResponseSchema.safeParse(data);
      if (!parsedRes.success) {
        setRunError("Unexpected response from server");
        return;
      }
      setRunSuccess(true);
      setTimeout(() => {
        router.push(`/dashboard/evaluations/${parsedRes.data.evaluationId}`);
      }, 1500);
    } catch {
      setRunError("Network error");
    } finally {
      setRunPending(false);
    }
  };

  const steps = [
    { n: 1, label: "Connect" },
    { n: 2, label: "Scenarios" },
    { n: 3, label: "API Key" },
    { n: 4, label: "Launch" },
  ];

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
              Quick start
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Connect your HTTP agent and run your first evaluation.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            Skip onboarding → Dashboard
          </Link>
        </div>

        <nav aria-label="Progress" className="flex items-center justify-between gap-2">
          {steps.map((s, i) => (
            <div key={s.n} className="flex flex-1 items-center gap-2">
              <div className="flex flex-col items-center gap-1">
                <div
                  className={
                    step === s.n
                      ? "flex h-9 w-9 items-center justify-center rounded-full border-2 border-gray-900 bg-gray-900 text-white"
                      : step > s.n
                        ? "flex h-9 w-9 items-center justify-center rounded-full border border-green-600 bg-green-50 text-green-700"
                        : "flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400"
                  }
                >
                  {step > s.n ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <span className="text-sm font-medium">{s.n}</span>
                  )}
                </div>
                <span
                  className={
                    step === s.n
                      ? "text-xs font-medium text-gray-900"
                      : "text-xs text-gray-500"
                  }
                >
                  {s.label}
                </span>
              </div>
              {i < steps.length - 1 ? (
                <div
                  className={
                    step > s.n
                      ? "hidden h-px flex-1 bg-green-600 sm:block"
                      : "hidden h-px flex-1 bg-gray-200 sm:block"
                  }
                />
              ) : null}
            </div>
          ))}
        </nav>

        <Card>
          <CardHeader>
            {step === 1 ? (
              <CardTitle>Point your agent at our eval API</CardTitle>
            ) : null}
            {step === 2 ? (
              <CardTitle>Choose what to test</CardTitle>
            ) : null}
            {step === 3 ? (
              <CardTitle>Authenticate your requests</CardTitle>
            ) : null}
            {step === 4 ? (
              <CardTitle>Launch your first evaluation</CardTitle>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-6">
            {step === 1 ? (
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">
                    Endpoint URL
                  </label>
                  <Input
                    className="mt-1"
                    placeholder="https://your-agent.example.com/v1/complete"
                    value={endpointUrl}
                    onChange={(e) => setEndpointUrl(e.target.value)}
                    onBlur={() => setEndpointTouched(true)}
                  />
                  {endpointTouched && endpointUrl.trim() && !endpointValid ? (
                    <p className="mt-1 text-sm text-red-600">Enter a valid URL</p>
                  ) : null}
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">
                    HTTP method
                  </label>
                  <select
                    className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
                    value={method}
                    onChange={(e) =>
                      setMethod(e.target.value as typeof method)
                    }
                  >
                    <option value="POST">POST</option>
                    <option value="GET">GET</option>
                    <option value="PUT">PUT</option>
                    <option value="PATCH">PATCH</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">
                    Prompt field
                  </label>
                  <Input
                    className="mt-1"
                    value={promptField}
                    onChange={(e) => setPromptField(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    The JSON field name your agent reads the prompt from
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">
                    Response path
                  </label>
                  <Input
                    className="mt-1"
                    value={responsePath}
                    onChange={(e) => setResponsePath(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Dot-notation path to extract the reply from the response
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">
                    Auth token (optional)
                  </label>
                  <div className="relative mt-1">
                    <Input
                      type={showToken ? "text" : "password"}
                      placeholder="Bearer token or API key"
                      value={authToken}
                      onChange={(e) => setAuthToken(e.target.value)}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-800"
                      onClick={() => setShowToken((v) => !v)}
                      aria-label={showToken ? "Hide token" : "Show token"}
                    >
                      {showToken ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Sent as Authorization: Bearer {"{"}token{"}"} when your
                    worker calls the agent. This onboarding run does not persist
                    secrets — use an env var on the worker for production, or use
                    the curl command with the public API.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!endpointValid || probePending}
                    onClick={() => void runProbe()}
                  >
                    {probePending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Testing…
                      </>
                    ) : (
                      "Test connection"
                    )}
                  </Button>
                  {probeResult ? (
                    probeResult.reachable ? (
                      <span className="flex items-center gap-1 text-sm text-green-700">
                        <CheckCircle2 className="h-4 w-4" />
                        Reachable
                        {probeResult.latency_ms != null
                          ? ` (${probeResult.latency_ms}ms)`
                          : ""}
                      </span>
                    ) : (
                      <span className="flex max-w-md items-start gap-1 text-sm text-amber-800">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          Connection failed — you can continue anyway
                          {probeResult.error ? `: ${probeResult.error}` : ""}
                        </span>
                      </span>
                    )
                  ) : null}
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-4">
                <Input
                  placeholder="Search by name or tag…"
                  value={scenarioSearch}
                  onChange={(e) => setScenarioSearch(e.target.value)}
                />
                {scenariosLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                  </div>
                ) : null}
                {scenariosError ? (
                  <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                    {scenariosError}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() => void loadScenarios()}
                    >
                      Retry
                    </Button>
                  </div>
                ) : null}
                {!scenariosLoading &&
                !scenariosError &&
                scenariosPayload &&
                totalScenarios === 0 ? (
                  <p className="text-sm text-gray-600">No scenarios found</p>
                ) : null}
                {!scenariosLoading && !scenariosError && scenariosPayload
                  ? Object.entries(filteredGrouped).map(([tag, list]) => (
                      <div key={tag} className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-sm font-semibold text-gray-900">
                            {tag}{" "}
                            <span className="font-normal text-gray-500">
                              ({list.length})
                            </span>
                          </h3>
                          <label className="flex items-center gap-2 text-sm text-gray-600">
                            <input
                              type="checkbox"
                              checked={list.every((s) => selectedIds.has(s.id))}
                              onChange={() => toggleGroup(tag, list)}
                            />
                            Select all in group
                          </label>
                        </div>
                        <ul className="space-y-2">
                          {list.map((s) => (
                            <li
                              key={s.id}
                              className="flex items-start gap-3 rounded-md border border-gray-100 bg-gray-50 p-3"
                            >
                              <input
                                type="checkbox"
                                className="mt-1"
                                checked={selectedIds.has(s.id)}
                                onChange={() => toggleScenario(s.id)}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium text-gray-900">
                                    {s.name}
                                  </span>
                                  {s.attack_type ? (
                                    <Badge variant="secondary">
                                      {s.attack_type}
                                    </Badge>
                                  ) : null}
                                </div>
                                <p className="mt-1 text-sm text-gray-600">
                                  {truncate(s.description, 80)}
                                </p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))
                  : null}
                <p className="text-sm text-gray-600">
                  {selectedIds.size} of {filteredFlat.length || totalScenarios}{" "}
                  scenarios selected
                  {selectedIds.size >= MAX_SCENARIOS ? (
                    <span className="ml-2 text-amber-700">
                      (maximum {MAX_SCENARIOS} per run)
                    </span>
                  ) : null}
                </p>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="space-y-4">
                <button
                  type="button"
                  className="text-sm font-medium text-gray-700 underline"
                  onClick={() => setPasteKeyMode((v) => !v)}
                >
                  {pasteKeyMode
                    ? "Use key manager instead"
                    : "I already have a key"}
                </button>
                {pasteKeyMode ? (
                  <div>
                    <label className="text-sm font-medium text-gray-700">
                      Paste API key
                    </label>
                    <Input
                      className="mt-1"
                      type="password"
                      value={pastedKey}
                      onChange={(e) => setPastedKey(e.target.value)}
                      placeholder="ael_live_…"
                    />
                  </div>
                ) : null}
                {!pasteKeyMode && keysLoading ? (
                  <Skeleton className="h-20 w-full" />
                ) : null}
                {!pasteKeyMode && keysError ? (
                  <p className="text-sm text-amber-800">{keysError}</p>
                ) : null}
                {!pasteKeyMode && !keysLoading && keysList.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-sm text-gray-600">
                      Select a key for the example curl (full secret is only
                      available right after creation).
                    </p>
                    <ul className="space-y-2">
                      {keysList.map((k) => (
                        <li key={k.id}>
                          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-gray-200 p-3 text-sm">
                            <input
                              type="radio"
                              name="apikey"
                              checked={selectedKeyId === k.id}
                              onChange={() => setSelectedKeyId(k.id)}
                            />
                            <span className="font-medium">{k.name}</span>
                            <span className="text-gray-500">{k.prefix}…</span>
                            <span className="text-gray-400">
                              {new Date(k.createdAt).toLocaleDateString()}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {!pasteKeyMode && !keysLoading && keysList.length === 0 && !keysError ? (
                  <div className="space-y-3 rounded-md border border-gray-200 p-4">
                    <p className="text-sm font-medium text-gray-900">
                      Create your first API key
                    </p>
                    <Input
                      placeholder="Key name"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                    />
                    <Button
                      type="button"
                      disabled={!newKeyName.trim() || createKeyPending}
                      onClick={() => void createKey()}
                    >
                      {createKeyPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Create key"
                      )}
                    </Button>
                  </div>
                ) : null}
                {freshSecret ? (
                  <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm font-semibold text-amber-950">
                      Copy this key now — it will never be shown again
                    </p>
                    <pre className="overflow-x-auto rounded bg-white p-3 text-xs">
                      {freshSecret}
                    </pre>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void copyText(freshSecret, "API key")}
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      Copy key
                    </Button>
                  </div>
                ) : null}
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    Example: call the public eval API
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    Replace the placeholder with a key you have saved. Newly
                    created keys can be copied from above.
                  </p>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-gray-200 bg-gray-950 p-4 text-xs text-gray-100">
                    {curlCommand}
                  </pre>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => void copyText(curlCommand, "curl command")}
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Copy command
                  </Button>
                </div>
              </div>
            ) : null}

            {step === 4 ? (
              <div className="space-y-4">
                <Card className="border-gray-200 bg-gray-50">
                  <CardContent className="space-y-2 p-4 text-sm">
                    <div>
                      <span className="font-medium text-gray-700">Agent URL:</span>{" "}
                      <span className="text-gray-900">{endpointUrl.trim()}</span>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Method / fields:</span>{" "}
                      {method}, prompt: {promptField}, response: {responsePath}
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Scenarios:</span>{" "}
                      {selectedIds.size} selected
                    </div>
                    <ul className="max-h-32 list-inside list-disc overflow-y-auto text-gray-600">
                      {Array.from(selectedIds).map((id) => (
                        <li key={id}>{id}</li>
                      ))}
                    </ul>
                    <div>
                      <span className="font-medium text-gray-700">Release mode:</span>{" "}
                      exploratory
                    </div>
                  </CardContent>
                </Card>
                <p className="text-sm text-gray-600">
                  The button below uses your signed-in session and{" "}
                  <code className="rounded bg-gray-100 px-1">POST /api/evaluate</code>
                  . Your agent auth token is not stored on the server; for
                  authenticated agents, configure{" "}
                  <code className="rounded bg-gray-100 px-1">
                    auth_token_env_var
                  </code>{" "}
                  on the evaluation worker or use the curl flow with secrets you
                  control.
                </p>
                {runSuccess ? (
                  <div className="flex items-center gap-2 text-green-700">
                    <CheckCircle2 className="h-5 w-5" />
                    Evaluation started! Redirecting…
                  </div>
                ) : null}
                {runError ? (
                  <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    {runError}
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={runPending || runSuccess || selectedIds.size === 0}
                    onClick={() => void runEvaluation()}
                  >
                    {runPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Starting…
                      </>
                    ) : (
                      "Run evaluation"
                    )}
                  </Button>
                  {runError ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setRunError(null);
                        void runEvaluation();
                      }}
                    >
                      Try again
                    </Button>
                  ) : null}
                  <Link href="/dashboard">
                    <Button type="button" variant="ghost">
                      Go to dashboard
                    </Button>
                  </Link>
                </div>
              </div>
            ) : null}

            <div className="flex items-center justify-between border-t border-gray-100 pt-4">
              <Button
                type="button"
                variant="outline"
                disabled={step === 1}
                onClick={() => setStep((s) => Math.max(1, s - 1))}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              {step < 4 ? (
                <Button
                  type="button"
                  disabled={
                    (step === 1 && !endpointValid) ||
                    (step === 2 && selectedIds.size === 0)
                  }
                  onClick={() => setStep((s) => Math.min(4, s + 1))}
                >
                  Next
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
