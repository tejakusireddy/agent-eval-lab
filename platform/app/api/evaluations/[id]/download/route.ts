import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeReportJson } from "@/app/_utils/report-json";
import { redactSecrets } from "@/lib/secret-redaction";
import { buildAuditEvidencePack } from "@/lib/release-gate";
import { evaluateGateForEvaluation } from "@/lib/evaluation-gate";
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
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") || "json";

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

    let content: string;
    let contentType: string;
    let filename: string;

    if (format === "json") {
      content = JSON.stringify(normalizeReportJson(evaluation.reportJson), null, 2);
      contentType = "application/json";
      filename = `evaluation-${evaluation.id}.json`;
    } else if (format === "markdown") {
      content = evaluation.reportMarkdown || "";
      contentType = "text/markdown";
      filename = `evaluation-${evaluation.id}.md`;
    } else if (format === "evidence") {
      const safeReportJson = redactSecrets(normalizeReportJson(evaluation.reportJson));
      const gateResult = await evaluateGateForEvaluation({
        id: evaluation.id,
        projectId: evaluation.projectId,
        status: evaluation.status,
        createdAt: evaluation.createdAt,
        reportJson: evaluation.reportJson,
        config: evaluation.config,
        scenarios: evaluation.scenarios,
      });

      const evidence = buildAuditEvidencePack({
        evaluation: {
          id: evaluation.id,
          name: evaluation.name,
          status: evaluation.status,
          createdAt: evaluation.createdAt,
          completedAt: evaluation.completedAt,
          config: redactSecrets(evaluation.config),
          configHash: evaluation.configHash,
          scenarios: evaluation.scenarios,
          project: {
            id: evaluation.project.id,
            name: evaluation.project.name,
            organization: {
              id: evaluation.project.organization.id,
              name: evaluation.project.organization.name,
              clerkId: evaluation.project.organization.clerkId,
            },
          },
        },
        policyPath: gateResult.policyPath,
        gateDecision: gateResult.gate,
        reportJson: safeReportJson,
        evidenceSigning: process.env.EVIDENCE_SIGNING_KEY
          ? {
              key: process.env.EVIDENCE_SIGNING_KEY,
              keyId: process.env.EVIDENCE_SIGNING_KEY_ID || null,
            }
          : undefined,
      });

      content = JSON.stringify(evidence, null, 2);
      contentType = "application/json";
      filename = `evaluation-${evaluation.id}-evidence.json`;
    } else {
      return NextResponse.json(
        { error: "Invalid format" },
        { status: 400 }
      );
    }

    return new NextResponse(content, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    console.error("Download API error:", error);
    return NextResponse.json(
      { 
        error: error.message || "Internal server error",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}
