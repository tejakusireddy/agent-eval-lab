import { NextRequest, NextResponse } from "next/server";
import { validateHttpAgentUrl } from "@/lib/url-validator";

export const dynamic = "force-dynamic";
export const revalidate = 0;
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

function extractByPath(payload: any, path: string): any {
  let current: any = payload;
  for (const part of path.split(".")) {
    const key = part.trim();
    if (!key) {
      continue;
    }
    if (current && typeof current === "object" && key in current) {
      current = current[key];
    } else {
      return null;
    }
  }
  return current;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const baseUrlRaw = String(body?.base_url || "").trim();
    const query = String(body?.query || "").trim();
    const timeoutMs = Math.max(1000, Number(body?.timeout_seconds || 20) * 1000);
    const endpointPath = normalizePath(body?.endpoint_path, "/agent");
    const method = String(body?.method || "POST").toUpperCase();
    const promptField = toOptionalString(body?.prompt_field) || "query";
    const responsePath = toOptionalString(body?.response_path) || "answer";
    const authHeader = toOptionalString(body?.auth_header) || "Authorization";
    const authTokenEnvVar = toOptionalString(body?.auth_token_env_var);
    const authScheme = toOptionalString(body?.auth_scheme) || "Bearer";

    if (!baseUrlRaw) {
      return NextResponse.json(
        { success: false, error: "HTTP agent base URL is required" },
        { status: 400 }
      );
    }

    if (!query) {
      return NextResponse.json(
        { success: false, error: "Query is required" },
        { status: 400 }
      );
    }

    if (!SUPPORTED_HTTP_METHODS.has(method)) {
      return NextResponse.json(
        {
          success: false,
          error: `Unsupported HTTP method '${method}'. Supported methods: GET, POST, PUT, PATCH`,
        },
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
    const endpoint = `${baseUrl}${endpointPath}`;
    const token = authTokenEnvVar ? process.env[authTokenEnvVar] : null;
    if (authTokenEnvVar && !token) {
      return NextResponse.json(
        {
          success: false,
          error: `Auth token env var '${authTokenEnvVar}' is not configured on server`,
        },
        { status: 400 }
      );
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (token) {
      const normalizedScheme = authScheme.trim().toLowerCase();
      const useRawToken =
        normalizedScheme.length === 0 ||
        normalizedScheme === "none" ||
        normalizedScheme === "raw";
      headers[authHeader] = useRawToken
        ? token
        : `${authScheme} ${token}`.trim();
    }

    const requestBody = {
      [promptField]: query,
    };
    const requestUrl =
      method === "GET"
        ? `${endpoint}?${encodeURIComponent(promptField)}=${encodeURIComponent(query)}`
        : endpoint;
    const startedAt = Date.now();

    const response = await fetch(requestUrl, {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(requestBody),
      signal: timeoutSignal(timeoutMs),
    });

    const latencyMs = Date.now() - startedAt;
    const contentType = response.headers.get("content-type") || "";

    let payload: any = null;
    let textPayload = "";

    if (contentType.includes("application/json")) {
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    } else {
      try {
        textPayload = await response.text();
      } catch {
        textPayload = "";
      }
      try {
        payload = textPayload ? JSON.parse(textPayload) : null;
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const detail =
        payload?.detail ||
        payload?.error ||
        textPayload ||
        `Agent endpoint returned status ${response.status}`;

      return NextResponse.json(
        {
          success: false,
          error: String(detail),
          details: { endpoint, status: response.status, latencyMs },
        },
        { status: 502 }
      );
    }

    const resolvedAnswer = extractByPath(payload, responsePath);
    const answer =
      typeof resolvedAnswer === "string"
        ? resolvedAnswer
        : typeof payload?.answer === "string"
        ? payload.answer
        : typeof payload?.response === "string"
        ? payload.response
        : typeof payload?.output === "string"
        ? payload.output
        : typeof payload?.text === "string"
        ? payload.text
        : textPayload;

    if (!answer) {
      return NextResponse.json(
        {
          success: false,
          error: `Agent response does not include readable text at '${responsePath}'`,
          details: { endpoint, latencyMs, payload },
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      answer,
      details: {
        endpoint,
        latencyMs,
        context_snippets: payload?.context_snippets || [],
        metadata: payload?.metadata || {},
      },
    });
  } catch (error: any) {
    const message =
      error?.name === "AbortError"
        ? "Agent query timed out"
        : error?.message || "Agent query failed";

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
