import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redactSecrets } from "@/lib/secret-redaction";
import { normalizeReportJson } from "@/app/_utils/report-json";
import { ensureOrganizationByClerkId } from "@/lib/org";
import { hasRoleAtLeast, resolveAppRole } from "@/lib/rbac";
import {
  apiKeyCanActAsRole,
  authenticateApiKeyFromRequest,
  hasRequiredScope,
} from "@/lib/api-keys";
import {
  ensurePublicSelfServeOrganization,
  isPublicSelfServeEnabled,
} from "@/lib/public-access";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { userId, orgId } = getAuth();

    let organizationId: string | null = null;
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
      return NextResponse.json({ error: "Organization context missing" }, { status: 400 });
    }

    const resolvedParams = await Promise.resolve(params);
    const evaluation = await prisma.evaluation.findFirst({
      where: {
        id: resolvedParams.id,
        project: {
          organizationId,
        },
      },
      include: {
        project: {
          include: {
            organization: true,
          },
        },
      },
    });

    if (!evaluation) {
      return NextResponse.json(
        { error: "Evaluation not found" },
        { status: 404 }
      );
    }

    // Redact any secrets from report JSON
    const reportJson = evaluation.reportJson
      ? redactSecrets(normalizeReportJson(evaluation.reportJson))
      : null;

    // Return status and summary
    const response: any = {
      id: evaluation.id,
      name: evaluation.name,
      status: evaluation.status,
      createdAt: evaluation.createdAt,
      completedAt: evaluation.completedAt,
    };

    // Add summary if available
    if (reportJson && typeof reportJson === "object") {
      const summary = (reportJson as any).summary;
      if (summary) {
        response.summary = summary;
        response.safetyScore = evaluation.safetyScore;
      }
    }

    // Add results if completed
    if (evaluation.status === "completed" && reportJson) {
      response.results = reportJson;
    }

    // Add error if failed
    if (evaluation.status === "failed" && evaluation.errorMessage) {
      response.error = evaluation.errorMessage;
    }

    return NextResponse.json(response);
  } catch (error: any) {
    console.error("Evaluation GET API error:", error);
    return NextResponse.json(
      { 
        error: error.message || "Internal server error",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}
