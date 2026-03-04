import { NextRequest, NextResponse } from "next/server";
import { validateHttpAgentUrl } from "@/lib/url-validator";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  controller.signal.addEventListener("abort", () => clearTimeout(timer));
  return controller.signal;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const baseUrlRaw = String(body?.base_url || "").trim();
    const query = String(body?.query || "").trim();
    const timeoutMs = Math.max(1000, Number(body?.timeout_seconds || 20) * 1000);

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

    const validation = validateHttpAgentUrl(baseUrlRaw);
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.error || "Invalid URL" },
        { status: 400 }
      );
    }

    const baseUrl = baseUrlRaw.replace(/\/+$/, "");
    const endpoint = `${baseUrl}/agent`;
    const startedAt = Date.now();

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
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

    const answer =
      typeof payload?.answer === "string"
        ? payload.answer
        : typeof payload?.response === "string"
        ? payload.response
        : typeof payload?.output === "string"
        ? payload.output
        : textPayload;

    if (!answer) {
      return NextResponse.json(
        {
          success: false,
          error: "Agent response does not include an answer field",
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

