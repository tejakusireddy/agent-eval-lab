import { NextRequest, NextResponse } from "next/server";
import { validateHttpAgentUrl } from "@/lib/url-validator";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  controller.signal.addEventListener("abort", () => clearTimeout(timer));
  return controller.signal;
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

      // Prefer health endpoint when available.
      const healthResponse = await fetch(`${baseUrl}/health`, {
        method: "GET",
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
            endpoint: `${baseUrl}/health`,
            status: healthResponse.status,
            health,
          },
        });
      }

      return NextResponse.json(
        {
          success: false,
          error: `Health check failed with status ${healthResponse.status}`,
          details: { endpoint: `${baseUrl}/health` },
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
