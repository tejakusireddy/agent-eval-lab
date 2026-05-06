import { NextRequest, NextResponse } from "next/server";
import { validateHttpAgentUrl } from "@/lib/url-validator";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const SUPPORTED_HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH"]);

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  controller.signal.addEventListener("abort", () => clearTimeout(timer));
  return controller.signal;
}

function normalizePath(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const selected = raw || fallback;
  if (selected.startsWith("/")) {
    return selected;
  }
  return `/${selected}`;
}

function toOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildAuthHeaderMap(params: {
  authHeader: string;
  authTokenEnvVar: string | null;
  authScheme: string;
}): { headers: Record<string, string>; error?: string } {
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const provider = String(body?.provider || "openai");
    const timeoutMs = Math.max(1000, Number(body?.timeout_seconds || 10) * 1000);

    if (provider === "http_agent") {
      const baseUrlRaw = String(body?.http_agent_base_url || "").trim();
      if (!baseUrlRaw) {
        return NextResponse.json(
          { success: false, error: "HTTP agent base URL is required" },
          { status: 400 }
        );
      }

      const validation = validateHttpAgentUrl(baseUrlRaw);
      if (!validation.valid) {
        return NextResponse.json(
          { success: false, error: validation.error || "Invalid URL" },
          { status: 400 }
        );
      }

      const baseUrl = baseUrlRaw.replace(/\/+$/, "");
      const endpointPath = normalizePath(body?.http_agent_endpoint_path, "/agent");
      const healthPath = normalizePath(body?.http_agent_health_path, "/health");
      const method = String(body?.http_agent_method || "POST").toUpperCase();
      const promptField = toOptionalString(body?.http_agent_prompt_field) || "query";
      const authHeader = toOptionalString(body?.http_agent_auth_header) || "Authorization";
      const authTokenEnvVar = toOptionalString(body?.http_agent_auth_env_var);
      const authScheme = toOptionalString(body?.http_agent_auth_scheme) || "Bearer";

      if (!SUPPORTED_HTTP_METHODS.has(method)) {
        return NextResponse.json(
          {
            success: false,
            error: `Unsupported HTTP method '${method}'. Supported methods: GET, POST, PUT, PATCH`,
          },
          { status: 400 }
        );
      }

      const auth = buildAuthHeaderMap({
        authHeader,
        authTokenEnvVar,
        authScheme,
      });
      if (auth.error) {
        return NextResponse.json(
          {
            success: false,
            error: auth.error,
          },
          { status: 400 }
        );
      }

      // Prefer health endpoint when available.
      const healthEndpoint = `${baseUrl}${healthPath}`;
      const healthResponse = await fetch(healthEndpoint, {
        method: "GET",
        headers: {
          ...auth.headers,
        },
        signal: timeoutSignal(timeoutMs),
      });

      if (healthResponse.ok) {
        let health: unknown = null;
        try {
          health = await healthResponse.json();
        } catch {
          // no-op: not all services return JSON
        }
        return NextResponse.json({
          success: true,
          provider,
          message: "HTTP agent is reachable",
          details: {
            endpoint: healthEndpoint,
            status: healthResponse.status,
            health,
          },
        });
      }

      const probeEndpoint = `${baseUrl}${endpointPath}`;
      const probeStartedAt = Date.now();
      const probeUrl =
        method === "GET"
          ? `${probeEndpoint}?${encodeURIComponent(promptField)}=${encodeURIComponent("ping")}`
          : probeEndpoint;

      const probeResponse = await fetch(probeUrl, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...auth.headers,
        },
        body: method === "GET" ? undefined : JSON.stringify({ [promptField]: "ping" }),
        signal: timeoutSignal(timeoutMs),
      });

      const probeLatencyMs = Date.now() - probeStartedAt;
      if (probeResponse.ok) {
        return NextResponse.json({
          success: true,
          provider,
          message: "Execution endpoint is reachable",
          details: {
            endpoint: probeEndpoint,
            method,
            status: probeResponse.status,
            latencyMs: probeLatencyMs,
          },
        });
      }

      return NextResponse.json(
        {
          success: false,
          error:
            `Health check failed with status ${healthResponse.status}; ` +
            `execution probe failed with status ${probeResponse.status}`,
          details: { endpoint: healthEndpoint, probeEndpoint, method },
        },
        { status: 502 }
      );
    }

    // OpenAI/OpenAI-compatible provider connectivity check.
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return NextResponse.json(
        {
          success: false,
          error: "OPENAI_API_KEY is not configured on server",
        },
        { status: 500 }
      );
    }

    const baseUrl = String(body?.base_url || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      signal: timeoutSignal(timeoutMs),
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `Model endpoint returned status ${response.status}`,
          details: { endpoint: `${baseUrl}/models` },
        },
        { status: 502 }
      );
    }

    let modelCount: number | null = null;
    try {
      const payload = await response.json();
      if (Array.isArray(payload?.data)) {
        modelCount = payload.data.length;
      }
    } catch {
      // no-op
    }

    return NextResponse.json({
      success: true,
      provider: "openai",
      message: "OpenAI endpoint is reachable",
      details: {
        endpoint: `${baseUrl}/models`,
        modelCount,
      },
    });
  } catch (error: any) {
    const message =
      error?.name === "AbortError"
        ? "Connection test timed out"
        : error?.message || "Connection test failed";

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
