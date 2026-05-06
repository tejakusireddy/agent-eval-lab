import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ProbeBodySchema = z.object({
  url: z.string().url(),
});

function isBlockedLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h.endsWith(".localhost")
  );
}

function buildHealthUrl(agentUrl: string): string {
  const base = agentUrl.trim().endsWith("/") ? agentUrl.trim() : `${agentUrl.trim()}/`;
  return new URL("health", base).href;
}

export type ProbeResponse = {
  reachable: boolean;
  status_code: number | null;
  latency_ms: number | null;
  error: string | null;
};

/**
 * Server-side reachability probe for a partner agent (avoids browser CORS).
 */
export async function POST(request: NextRequest): Promise<NextResponse<ProbeResponse>> {
  const empty: ProbeResponse = {
    reachable: false,
    status_code: null,
    latency_ms: null,
    error: null,
  };

  try {
    const { userId } = getAuth();
    if (!userId) {
      return NextResponse.json(
        { ...empty, error: "Unauthorized" },
        { status: 401 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { ...empty, error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const parsed = ProbeBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ...empty,
          error: "Invalid URL",
        },
        { status: 400 }
      );
    }

    let probeTarget: URL;
    try {
      probeTarget = new URL(parsed.data.url);
    } catch {
      return NextResponse.json(
        { ...empty, error: "Invalid URL" },
        { status: 400 }
      );
    }

    if (probeTarget.protocol !== "http:" && probeTarget.protocol !== "https:") {
      return NextResponse.json(
        { ...empty, error: "URL must use http or https" },
        { status: 400 }
      );
    }

    if (
      process.env.NODE_ENV === "production" &&
      isBlockedLocalHost(probeTarget.hostname)
    ) {
      return NextResponse.json(
        {
          ...empty,
          error: "Localhost URLs are not allowed in production",
        },
        { status: 400 }
      );
    }

    const healthUrl = buildHealthUrl(parsed.data.url);
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(healthUrl, {
        method: "GET",
        signal: controller.signal,
        headers: { Accept: "application/json, text/plain, */*" },
      });
      clearTimeout(timer);
      const latency_ms = Math.round(performance.now() - started);
      const reachable = res.ok;
      return NextResponse.json({
        reachable,
        status_code: res.status,
        latency_ms,
        error: reachable ? null : `HTTP ${res.status}`,
      });
    } catch (e: unknown) {
      clearTimeout(timer);
      const latency_ms = Math.round(performance.now() - started);
      const msg = e instanceof Error ? e.message : "Request failed";
      return NextResponse.json({
        reachable: false,
        status_code: null,
        latency_ms,
        error: msg,
      });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unexpected error";
    return NextResponse.json(
      {
        reachable: false,
        status_code: null,
        latency_ms: null,
        error: msg,
      },
      { status: 200 }
    );
  }
}
