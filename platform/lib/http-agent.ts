import { validateHttpAgentUrl } from "@/lib/url-validator";

export const SUPPORTED_HTTP_METHODS = ["GET", "POST", "PUT", "PATCH"] as const;
export type HttpAgentMethod = (typeof SUPPORTED_HTTP_METHODS)[number];

export interface HttpAgentAuthConfig {
  authHeader: string;
  authTokenEnvVar: string | null;
  authScheme: string;
}

export interface HttpAgentProbeConfig extends HttpAgentAuthConfig {
  baseUrl: string;
  endpointPath: string;
  method: HttpAgentMethod;
  promptField: string;
  responsePath?: string;
  timeoutMs: number;
  query: string;
}

export interface HttpAgentProbeResult {
  ok: boolean;
  endpoint: string;
  method: HttpAgentMethod;
  status: number;
  latencyMs: number;
  answer: string | null;
  matchedResponsePath: string | null;
  payload: unknown;
  candidateResponsePaths: string[];
  error?: string;
}

function dedupe<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

export function normalizePath(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const selected = raw || fallback;
  if (selected.startsWith("/")) {
    return selected;
  }
  return `/${selected}`;
}

export function toOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  controller.signal.addEventListener("abort", () => clearTimeout(timer));
  return controller.signal;
}

export function extractByPath(payload: unknown, path: string): unknown {
  if (!path || typeof path !== "string") {
    return null;
  }
  let current: unknown = payload;
  for (const part of path.split(".")) {
    const key = part.trim();
    if (!key) {
      continue;
    }
    if (
      current !== null &&
      typeof current === "object" &&
      !Array.isArray(current) &&
      key in (current as Record<string, unknown>)
    ) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return null;
    }
  }
  return current;
}

export function inferCandidateResponsePaths(payload: unknown): string[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const preferred = [
    "answer",
    "response",
    "output",
    "text",
    "message",
    "result",
    "result.text",
    "result.answer",
    "data.answer",
    "data.response",
    "data.output",
    "data.text",
  ];

  const discovered: string[] = [];
  const queue: Array<{ value: unknown; path: string; depth: number }> = [
    { value: payload, path: "", depth: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth > 2) {
      continue;
    }
    if (!current.value || typeof current.value !== "object" || Array.isArray(current.value)) {
      continue;
    }

    for (const [key, value] of Object.entries(current.value as Record<string, unknown>)) {
      const path = current.path ? `${current.path}.${key}` : key;
      if (typeof value === "string" && value.trim().length > 0) {
        discovered.push(path);
      }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        queue.push({ value, path, depth: current.depth + 1 });
      }
    }
  }

  return dedupe([...preferred, ...discovered]);
}

export function buildAuthHeaderMap(params: HttpAgentAuthConfig): {
  headers: Record<string, string>;
  error?: string;
} {
  const { authHeader, authTokenEnvVar, authScheme } = params;
  if (!authTokenEnvVar) {
    return { headers: {} };
  }

  const token = process.env[authTokenEnvVar];
  if (!token) {
    return {
      headers: {},
      error: `Auth token env var '${authTokenEnvVar}' is not configured on server`,
    };
  }

  const normalizedScheme = authScheme.trim().toLowerCase();
  const useRawToken =
    normalizedScheme.length === 0 ||
    normalizedScheme === "none" ||
    normalizedScheme === "raw";
  const headerValue = useRawToken
    ? token
    : `${authScheme.trim()} ${token}`.trim();

  return {
    headers: {
      [authHeader]: headerValue,
    },
  };
}

export async function probeHttpAgent(config: HttpAgentProbeConfig): Promise<HttpAgentProbeResult> {
  const {
    baseUrl,
    endpointPath,
    method,
    promptField,
    responsePath,
    timeoutMs,
    query,
    authHeader,
    authTokenEnvVar,
    authScheme,
  } = config;

  const auth = buildAuthHeaderMap({ authHeader, authTokenEnvVar, authScheme });
  if (auth.error) {
    return {
      ok: false,
      endpoint: `${baseUrl}${endpointPath}`,
      method,
      status: 0,
      latencyMs: 0,
      answer: null,
      matchedResponsePath: null,
      payload: null,
      candidateResponsePaths: [],
      error: auth.error,
    };
  }

  const endpoint = `${baseUrl}${endpointPath}`;
  const requestUrl =
    method === "GET"
      ? `${endpoint}?${encodeURIComponent(promptField)}=${encodeURIComponent(query)}`
      : endpoint;

  const startedAt = Date.now();
  try {
    const response = await fetch(requestUrl, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...auth.headers,
      },
      body: method === "GET" ? undefined : JSON.stringify({ [promptField]: query }),
      signal: timeoutSignal(timeoutMs),
    });
    const latencyMs = Date.now() - startedAt;

    const contentType = response.headers.get("content-type") || "";
    let payload: unknown = null;
    let textPayload = "";

    if (contentType.includes("application/json")) {
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    } else {
      textPayload = await response.text().catch(() => "");
      try {
        payload = textPayload ? JSON.parse(textPayload) : null;
      } catch {
        payload = null;
      }
    }

    const candidatePaths = inferCandidateResponsePaths(payload);
    const orderedPaths = dedupe([responsePath || "", ...candidatePaths]).filter(Boolean);

    let matchedResponsePath: string | null = null;
    let answer: string | null = null;

    for (const path of orderedPaths) {
      const extracted = extractByPath(payload, path);
      if (typeof extracted === "string" && extracted.trim().length > 0) {
        matchedResponsePath = path;
        answer = extracted;
        break;
      }
    }

    if (!answer && typeof payload === "string" && payload.trim().length > 0) {
      answer = payload;
      matchedResponsePath = null;
    }

    if (!answer && textPayload.trim().length > 0) {
      answer = textPayload;
      matchedResponsePath = null;
    }

    if (!response.ok) {
      const errorDetail =
        (payload as any)?.detail ||
        (payload as any)?.error ||
        textPayload ||
        `Agent endpoint returned status ${response.status}`;
      return {
        ok: false,
        endpoint,
        method,
        status: response.status,
        latencyMs,
        answer: null,
        matchedResponsePath,
        payload,
        candidateResponsePaths: orderedPaths,
        error: String(errorDetail),
      };
    }

    return {
      ok: Boolean(answer),
      endpoint,
      method,
      status: response.status,
      latencyMs,
      answer,
      matchedResponsePath,
      payload,
      candidateResponsePaths: orderedPaths,
      error: answer ? undefined : "Response did not include readable text",
    };
  } catch (error: any) {
    const message =
      error?.name === "AbortError"
        ? "Request timed out"
        : error?.message || "Probe request failed";
    return {
      ok: false,
      endpoint,
      method,
      status: 0,
      latencyMs: Date.now() - startedAt,
      answer: null,
      matchedResponsePath: null,
      payload: null,
      candidateResponsePaths: [],
      error: message,
    };
  }
}

export interface HttpAgentDiscoveryInput {
  baseUrlRaw: string;
  endpointPath: string | null;
  healthPath: string | null;
  method: HttpAgentMethod | null;
  promptField: string | null;
  responsePath: string | null;
  authHeader: string;
  authTokenEnvVar: string | null;
  authScheme: string;
  timeoutMs: number;
}

export interface HttpAgentDiscoveryResult {
  success: boolean;
  error?: string;
  recommended?: {
    endpoint_path: string;
    health_path: string | null;
    method: HttpAgentMethod;
    prompt_field: string;
    response_path: string;
    confidence: number;
  };
  diagnostics?: {
    health_checks: HealthCheckDiagnostic[];
    probes: ProbeDiagnostic[];
  };
}

export interface HealthCheckDiagnostic {
  path: string;
  status: number;
  ok: boolean;
  latency_ms: number;
  error?: string;
}

export interface ProbeDiagnostic {
  endpoint_path: string;
  method: HttpAgentMethod;
  prompt_field: string;
  response_path: string | null;
  status: number;
  ok: boolean;
  latency_ms: number;
  error?: string;
}

export async function discoverHttpAgentConfig(
  input: HttpAgentDiscoveryInput
): Promise<HttpAgentDiscoveryResult> {
  const {
    baseUrlRaw,
    endpointPath,
    healthPath,
    method,
    promptField,
    responsePath,
    authHeader,
    authTokenEnvVar,
    authScheme,
    timeoutMs,
  } = input;

  const trimmedBaseUrl = baseUrlRaw.trim();
  if (!trimmedBaseUrl) {
    return {
      success: false,
      error: "HTTP agent base URL is required",
    };
  }

  const validation = validateHttpAgentUrl(trimmedBaseUrl);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error || "Invalid URL",
    };
  }

  const auth = buildAuthHeaderMap({ authHeader, authTokenEnvVar, authScheme });
  if (auth.error) {
    return {
      success: false,
      error: auth.error,
    };
  }

  const baseUrl = trimmedBaseUrl.replace(/\/+$/, "");

  const healthCandidates = dedupe(
    [
      healthPath ? normalizePath(healthPath, "/health") : null,
      "/health",
      "/status",
      "/ready",
      "/api/health",
      "/api/status",
    ].filter((entry): entry is string => Boolean(entry))
  );

  const healthChecks: HealthCheckDiagnostic[] = [];
  let healthyPath: string | null = null;
  for (const candidate of healthCandidates) {
    const startedAt = Date.now();
    try {
      const response = await fetch(`${baseUrl}${candidate}`, {
        method: "GET",
        headers: {
          ...auth.headers,
        },
        signal: timeoutSignal(timeoutMs),
      });
      const latencyMs = Date.now() - startedAt;
      const ok = response.ok;
      healthChecks.push({
        path: candidate,
        status: response.status,
        ok,
        latency_ms: latencyMs,
      });
      if (ok && !healthyPath) {
        healthyPath = candidate;
      }
      if (ok && candidate === healthPath) {
        healthyPath = candidate;
      }
    } catch (error: any) {
      healthChecks.push({
        path: candidate,
        status: 0,
        ok: false,
        latency_ms: Date.now() - startedAt,
        error:
          error?.name === "AbortError"
            ? "Health check timed out"
            : error?.message || "Health check failed",
      });
    }
  }

  const methodCandidates = method ? [method] : (["POST", "GET"] as HttpAgentMethod[]);
  const endpointCandidates = dedupe(
    [
      endpointPath ? normalizePath(endpointPath, "/agent") : null,
      "/agent",
      "/chat",
      "/query",
      "/respond",
      "/api/agent",
      "/api/chat",
      "/api/query",
      "/api/secure/respond",
    ].filter((entry): entry is string => Boolean(entry))
  );
  const promptFieldCandidates = dedupe(
    [promptField, "query", "prompt", "input", "message", "text", "question"].filter(
      (entry): entry is string => Boolean(entry && entry.trim())
    )
  );

  const probes: ProbeDiagnostic[] = [];
  let best: {
    endpointPath: string;
    method: HttpAgentMethod;
    promptField: string;
    responsePath: string;
    confidence: number;
  } | null = null;

  const maxProbeAttempts = 24;
  let attempts = 0;
  outer: for (const endpointCandidate of endpointCandidates) {
    for (const methodCandidate of methodCandidates) {
      for (const promptFieldCandidate of promptFieldCandidates) {
        if (attempts >= maxProbeAttempts) {
          break outer;
        }
        attempts += 1;

        const probe = await probeHttpAgent({
          baseUrl,
          endpointPath: endpointCandidate,
          method: methodCandidate,
          promptField: promptFieldCandidate.trim(),
          responsePath: responsePath || undefined,
          timeoutMs,
          query: "ping",
          authHeader,
          authTokenEnvVar,
          authScheme,
        });

        probes.push({
          endpoint_path: endpointCandidate,
          method: methodCandidate,
          prompt_field: promptFieldCandidate.trim(),
          response_path: probe.matchedResponsePath,
          status: probe.status,
          ok: probe.ok,
          latency_ms: probe.latencyMs,
          error: probe.error,
        });

        if (!probe.ok) {
          continue;
        }

        const chosenResponsePath =
          probe.matchedResponsePath || responsePath || "answer";
        let confidence = 70;
        if (endpointPath && normalizePath(endpointPath, "/agent") === endpointCandidate) {
          confidence += 10;
        }
        if (method && method === methodCandidate) {
          confidence += 5;
        }
        if (promptField && promptField.trim() === promptFieldCandidate.trim()) {
          confidence += 5;
        }
        if (responsePath && responsePath === chosenResponsePath) {
          confidence += 10;
        } else if (!responsePath && probe.matchedResponsePath) {
          confidence += 5;
        }
        if (probe.latencyMs <= 1000) {
          confidence += 5;
        }
        if (probe.status >= 200 && probe.status < 300) {
          confidence += 5;
        }
        confidence = Math.min(99, confidence);

        if (!best || confidence > best.confidence) {
          best = {
            endpointPath: endpointCandidate,
            method: methodCandidate,
            promptField: promptFieldCandidate.trim(),
            responsePath: chosenResponsePath,
            confidence,
          };
        }
        if (best.confidence >= 90) {
          break outer;
        }
      }
    }
  }

  if (!best) {
    return {
      success: false,
      error:
        "Could not auto-detect a working agent contract. Verify base URL, auth settings, and endpoint shape.",
      diagnostics: {
        health_checks: healthChecks,
        probes,
      },
    };
  }

  return {
    success: true,
    recommended: {
      endpoint_path: best.endpointPath,
      health_path: healthyPath,
      method: best.method,
      prompt_field: best.promptField,
      response_path: best.responsePath,
      confidence: best.confidence,
    },
    diagnostics: {
      health_checks: healthChecks,
      probes,
    },
  };
}
