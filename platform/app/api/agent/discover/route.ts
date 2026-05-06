import { NextRequest, NextResponse } from "next/server";

import {
  HttpAgentMethod,
  SUPPORTED_HTTP_METHODS,
  discoverHttpAgentConfig,
  normalizePath,
  toOptionalString,
} from "@/lib/http-agent";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseMethod(value: unknown): HttpAgentMethod | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  return SUPPORTED_HTTP_METHODS.includes(normalized as HttpAgentMethod)
    ? (normalized as HttpAgentMethod)
    : null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const result = await discoverHttpAgentConfig({
      baseUrlRaw: String(body?.base_url || ""),
      endpointPath: toOptionalString(body?.endpoint_path),
      healthPath: toOptionalString(body?.health_path),
      method: parseMethod(body?.method),
      promptField: toOptionalString(body?.prompt_field),
      responsePath: toOptionalString(body?.response_path),
      authHeader: toOptionalString(body?.auth_header) || "Authorization",
      authTokenEnvVar: toOptionalString(body?.auth_token_env_var),
      authScheme: toOptionalString(body?.auth_scheme) || "Bearer",
      timeoutMs: Math.max(1000, Number(body?.timeout_seconds || 8) * 1000),
    });

    if (!result.success || !result.recommended) {
      return NextResponse.json(
        {
          success: false,
          error: result.error || "Auto-discovery failed",
          diagnostics: result.diagnostics || null,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      recommended: {
        endpoint_path: normalizePath(result.recommended.endpoint_path, "/agent"),
        health_path: result.recommended.health_path
          ? normalizePath(result.recommended.health_path, "/health")
          : null,
        method: result.recommended.method,
        prompt_field: result.recommended.prompt_field,
        response_path: result.recommended.response_path,
        confidence: result.recommended.confidence,
      },
      diagnostics: result.diagnostics,
    });
  } catch (error: any) {
    const message = error?.message || "Failed to auto-discover agent contract";
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
