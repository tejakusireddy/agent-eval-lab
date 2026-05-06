import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

// DEPRECATED: This endpoint is a legacy execution path.
// All evaluation requests are forwarded to POST /api/evaluate.
// This file exists only for backward compatibility.
// TODO(cleanup): Remove after confirming no external callers
// remain. Added: 2026-04-02. Track via server logs for
// "legacy_eval_run_called" events.

export async function POST(request: NextRequest): Promise<NextResponse> {
  console.warn(
    JSON.stringify({
      event: "legacy_eval_run_called",
      message:
        "POST /api/evaluations/run is deprecated. " +
        "Use POST /api/evaluate or POST /api/v1/eval instead.",
      timestamp: new Date().toISOString(),
      path: "/api/evaluations/run",
    })
  );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isRecord(body)) {
    return NextResponse.json(
      { error: "Expected JSON object body" },
      { status: 400 }
    );
  }

  const legacy = body;
  const config: Record<string, unknown> = isRecord(legacy.config)
    ? legacy.config
    : {};

  const rawProvider = config["provider"];
  const agentType =
    typeof rawProvider === "string" && rawProvider.trim() !== ""
      ? rawProvider
      : "openai";

  const scenarioIdsRaw = legacy.scenarioIds;
  const selectedScenarios = Array.isArray(scenarioIdsRaw)
    ? scenarioIdsRaw.filter((id): id is string => typeof id === "string")
    : [];

  const canonicalBody: Record<string, unknown> = {
    agentType,
    agentConfig: config,
    selectedScenarios,
    projectId:
      typeof legacy.projectId === "string" ? legacy.projectId : undefined,
    evaluationName:
      typeof legacy.name === "string" ? legacy.name : undefined,
    releaseMode: "exploratory",
  };

  const canonicalUrl = new URL("/api/evaluate", request.url).toString();

  try {
    const forwardResponse = await fetch(canonicalUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: request.headers.get("cookie") ?? "",
        authorization: request.headers.get("authorization") ?? "",
      },
      body: JSON.stringify(canonicalBody),
    });

    let responseData: unknown;
    try {
      responseData = await forwardResponse.json();
    } catch {
      return NextResponse.json(
        {
          error: "Invalid response from evaluation service",
          _deprecated: true,
          _migrate_to: "POST /api/evaluate or POST /api/v1/eval",
        },
        { status: 502 }
      );
    }

    if (!isRecord(responseData)) {
      return NextResponse.json(
        {
          error: "Unexpected response shape",
          _deprecated: true,
          _migrate_to: "POST /api/evaluate or POST /api/v1/eval",
        },
        { status: 502 }
      );
    }

    const deprecatedPayload = {
      ...responseData,
      _deprecated: true as const,
      _migrate_to: "POST /api/evaluate or POST /api/v1/eval",
    };

    if (
      forwardResponse.ok &&
      typeof responseData.evaluationId === "string"
    ) {
      return NextResponse.json(
        {
          ...deprecatedPayload,
          evaluationId: responseData.evaluationId,
          status:
            typeof responseData.status === "string"
              ? responseData.status
              : "queued",
        },
        { status: forwardResponse.status }
      );
    }

    return NextResponse.json(deprecatedPayload, {
      status: forwardResponse.status,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Forward failed";
    console.error(
      JSON.stringify({
        event: "legacy_eval_run_forward_failed",
        error: message,
        timestamp: new Date().toISOString(),
      })
    );
    return NextResponse.json(
      {
        error: "Evaluation request failed",
        detail: message,
        _deprecated: true,
        _migrate_to: "POST /api/evaluate or POST /api/v1/eval",
      },
      { status: 500 }
    );
  }
}
