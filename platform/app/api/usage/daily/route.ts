import { NextRequest, NextResponse } from "next/server";

import { getAuth } from "@/lib/auth";
import {
  apiKeyCanActAsRole,
  authenticateApiKeyFromRequest,
  hasRequiredScope,
} from "@/lib/api-keys";
import { ensureOrganizationByClerkId } from "@/lib/org";
import { authorizeRole } from "@/lib/rbac";
import { getDailyEvaluationLimit, listRecentDailyUsage } from "@/lib/usage-meter";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function toDays(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 30;
  }
  return Math.max(1, Math.min(90, Math.floor(parsed)));
}

export async function GET(request: NextRequest) {
  try {
    const { userId, orgId } = getAuth();
    let organizationId: string | null = null;
    if (userId) {
      if (!orgId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const authz = await authorizeRole({ userId, orgId, requiredRole: "viewer" });
      if (!authz.ok) {
        return NextResponse.json(
          { error: "Forbidden: viewer role required", currentRole: authz.role },
          { status: 403 }
        );
      }
      const org = await ensureOrganizationByClerkId({ clerkId: orgId });
      organizationId = org.id;
    } else {
      const apiKeyAuth = await authenticateApiKeyFromRequest(request);
      if (!apiKeyAuth) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (!apiKeyAuth.ok) {
        return NextResponse.json({ error: apiKeyAuth.error || "Unauthorized" }, { status: 401 });
      }
      if (!apiKeyCanActAsRole(apiKeyAuth.role, "viewer")) {
        return NextResponse.json(
          { error: "Forbidden: viewer role required", currentRole: apiKeyAuth.role },
          { status: 403 }
        );
      }
      if (!hasRequiredScope(apiKeyAuth.scopes, "usage:read")) {
        return NextResponse.json(
          {
            error: "Forbidden: missing scope usage:read",
            requiredScope: "usage:read",
            scopes: apiKeyAuth.scopes || [],
          },
          { status: 403 }
        );
      }
      organizationId = apiKeyAuth.organizationId || null;
    }

    if (!organizationId) {
      return NextResponse.json({ error: "Organization context missing" }, { status: 400 });
    }

    const days = toDays(request.nextUrl.searchParams.get("days"));
    const rows = await listRecentDailyUsage({
      organizationId,
      days,
    });

    return NextResponse.json({
      success: true,
      limit: {
        dailyEvaluations: getDailyEvaluationLimit(),
      },
      usage: rows.map((row) => ({
        date: row.usageDate.toISOString().slice(0, 10),
        evaluationsRequested: row.evaluationsRequested,
        evaluationsCompleted: row.evaluationsCompleted,
        scenariosRequested: row.scenariosRequested,
      })),
    });
  } catch (error: any) {
    console.error("Usage daily API error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
