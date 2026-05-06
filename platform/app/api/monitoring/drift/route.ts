import { NextRequest, NextResponse } from "next/server";

import {
  apiKeyCanActAsRole,
  authenticateApiKeyFromRequest,
  hasRequiredScope,
} from "@/lib/api-keys";
import { getAuth } from "@/lib/auth";
import { buildDriftReport } from "@/lib/drift-monitoring";
import { ensureOrganizationByClerkId } from "@/lib/org";
import { authorizeRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function toOptionalNumber(value: string | null): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

export async function GET(request: NextRequest) {
  try {
    const { userId, orgId } = getAuth();
    let organizationId: string | null = null;
    let role = "viewer";

    if (userId) {
      if (!orgId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const authz = await authorizeRole({
        userId,
        orgId,
        requiredRole: "viewer",
      });
      if (!authz.ok) {
        return NextResponse.json(
          { error: "Forbidden: viewer role required", currentRole: authz.role },
          { status: 403 }
        );
      }
      const org = await ensureOrganizationByClerkId({ clerkId: orgId });
      organizationId = org.id;
      role = authz.role;
    } else {
      const apiKeyAuth = await authenticateApiKeyFromRequest(request);
      if (!apiKeyAuth) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (!apiKeyAuth.ok) {
        return NextResponse.json(
          { error: apiKeyAuth.error || "Unauthorized" },
          { status: 401 }
        );
      }
      if (!apiKeyCanActAsRole(apiKeyAuth.role, "viewer")) {
        return NextResponse.json(
          { error: "Forbidden: viewer role required", currentRole: apiKeyAuth.role },
          { status: 403 }
        );
      }
      if (
        !hasRequiredScope(apiKeyAuth.scopes, "usage:read") &&
        !hasRequiredScope(apiKeyAuth.scopes, "evaluate:read")
      ) {
        return NextResponse.json(
          {
            error: "Forbidden: missing scope usage:read or evaluate:read",
            requiredScope: "usage:read|evaluate:read",
            scopes: apiKeyAuth.scopes || [],
          },
          { status: 403 }
        );
      }
      organizationId = apiKeyAuth.organizationId || null;
      role = apiKeyAuth.role || "viewer";
    }

    if (!organizationId) {
      return NextResponse.json(
        { error: "Organization context missing" },
        { status: 400 }
      );
    }

    const report = await buildDriftReport({
      organizationId,
      lookbackDays: toOptionalNumber(request.nextUrl.searchParams.get("lookback_days")),
      windowDays: toOptionalNumber(request.nextUrl.searchParams.get("window_days")),
      minimumSamples: toOptionalNumber(request.nextUrl.searchParams.get("minimum_samples")),
      safetyDropThreshold: toOptionalNumber(
        request.nextUrl.searchParams.get("safety_drop_threshold")
      ),
      criticalIncreaseThreshold: toOptionalNumber(
        request.nextUrl.searchParams.get("critical_increase_threshold")
      ),
      minimumSafetyScore: toOptionalNumber(
        request.nextUrl.searchParams.get("minimum_safety_score")
      ),
    });

    return NextResponse.json({
      success: true,
      report,
      access: {
        role,
      },
    });
  } catch (error: any) {
    console.error("Drift monitoring API error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
