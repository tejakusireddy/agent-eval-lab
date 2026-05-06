import { NextRequest, NextResponse } from "next/server";

import { getAuth } from "@/lib/auth";
import { resolveAblationForOrganization } from "@/lib/ablation-service";
import {
  apiKeyCanActAsRole,
  authenticateApiKeyFromRequest,
  hasRequiredScope,
} from "@/lib/api-keys";
import { ensureOrganizationByClerkId } from "@/lib/org";
import { hasRoleAtLeast, resolveAppRole } from "@/lib/rbac";
import {
  ensurePublicSelfServeOrganization,
  isPublicSelfServeEnabled,
} from "@/lib/public-access";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/v1/ablation/:id — poll status or return computed diff.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
): Promise<NextResponse> {
  let organizationId: string | null = null;

  try {
    const { userId, orgId } = getAuth();

    if (userId) {
      const userRole = await resolveAppRole({ userId, orgId });
      if (!hasRoleAtLeast(userRole, "viewer")) {
        return NextResponse.json(
          {
            error: "Forbidden: viewer role required",
            requiredRole: "viewer",
            currentRole: userRole,
          },
          { status: 403 }
        );
      }
      if (!orgId) {
        return NextResponse.json(
          { error: "Organization context missing for authenticated user" },
          { status: 400 }
        );
      }
      const organization = await ensureOrganizationByClerkId({ clerkId: orgId });
      organizationId = organization.id;
    } else {
      const apiKeyAuth = await authenticateApiKeyFromRequest(request);
      if (apiKeyAuth) {
        if (!apiKeyAuth.ok) {
          return NextResponse.json(
            { error: apiKeyAuth.error || "Unauthorized" },
            { status: 401 }
          );
        }
        if (!apiKeyCanActAsRole(apiKeyAuth.role, "viewer")) {
          return NextResponse.json(
            {
              error: "Forbidden: viewer role required",
              requiredRole: "viewer",
              currentRole: apiKeyAuth.role,
            },
            { status: 403 }
          );
        }
        if (!hasRequiredScope(apiKeyAuth.scopes, "evaluate:read")) {
          return NextResponse.json(
            {
              error: "Forbidden: missing scope evaluate:read",
              requiredScope: "evaluate:read",
              scopes: apiKeyAuth.scopes || [],
            },
            { status: 403 }
          );
        }
        organizationId = apiKeyAuth.organizationId || null;
      } else if (isPublicSelfServeEnabled()) {
        const publicOrg = await ensurePublicSelfServeOrganization(request);
        organizationId = publicOrg.organization.id;
      } else {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    if (!organizationId) {
      return NextResponse.json(
        { error: "Organization context missing" },
        { status: 400 }
      );
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "auth error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const resolvedParams = await Promise.resolve(params);
  const ablationId = resolvedParams.id;

  let resolved;
  try {
    resolved = await resolveAblationForOrganization(ablationId, organizationId);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "db error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (resolved.kind === "not_found") {
    return NextResponse.json({ error: "Ablation run not found" }, { status: 404 });
  }

  if (resolved.kind === "running") {
    return NextResponse.json({
      status: "running",
      poll_interval_seconds: resolved.pollIntervalSeconds,
    });
  }

  if (resolved.kind === "failed") {
    return NextResponse.json({
      status: "failed",
      error: resolved.error,
    });
  }

  return NextResponse.json({
    spec_version: "1.0",
    ablation_run_id: resolved.ablationId,
    status: "completed",
    defenses_tested: resolved.defensesTested,
    metric_diff: resolved.diff.metric_diff,
    span_diffs: resolved.diff.span_diffs,
    gate_diff: resolved.diff.gate_diff,
    flipped_scenarios: resolved.diff.flipped_scenarios,
    defense_effectiveness_score: resolved.diff.defense_effectiveness_score,
    completed_at: resolved.completedAt,
  });
}
