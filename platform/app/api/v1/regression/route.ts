import { NextRequest, NextResponse } from "next/server";

import { getAuth } from "@/lib/auth";
import {
  apiKeyCanActAsRole,
  authenticateApiKeyFromRequest,
  hasRequiredScope,
} from "@/lib/api-keys";
import { prisma } from "@/lib/db";
import { ensureOrganizationByClerkId } from "@/lib/org";
import { hasRoleAtLeast, resolveAppRole } from "@/lib/rbac";
import {
  getCorpusSummary,
  listRegressionEntriesForProject,
  type RegressionEntryShape,
} from "@/lib/regression-corpus";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RegressionGetResponse = {
  spec_version: "1.0";
  project_id: string;
  corpus: RegressionEntryShape[];
  summary: {
    total: number;
    active: number;
    resolved: number;
    suppressed: number;
    scenario_ids: string[];
  };
};

/**
 * GET /api/v1/regression?project_id= — list regression corpus for a project.
 */
export async function GET(
  request: NextRequest
): Promise<NextResponse<RegressionGetResponse | { error: string }>> {
  let organizationId: string | null = null;

  try {
    const { userId, orgId } = getAuth();

    if (userId) {
      const authRole = await resolveAppRole({ userId, orgId });
      if (!hasRoleAtLeast(authRole, "evaluator")) {
        return NextResponse.json(
          { error: "Forbidden: evaluator role required" },
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
      if (!apiKeyAuth?.ok) {
        return NextResponse.json(
          { error: apiKeyAuth?.error || "Unauthorized" },
          { status: 401 }
        );
      }
      if (!apiKeyCanActAsRole(apiKeyAuth.role, "evaluator")) {
        return NextResponse.json(
          { error: "Forbidden: evaluator role required" },
          { status: 403 }
        );
      }
      if (!hasRequiredScope(apiKeyAuth.scopes, "evaluate:read")) {
        return NextResponse.json(
          { error: "Forbidden: missing scope evaluate:read" },
          { status: 403 }
        );
      }
      organizationId = apiKeyAuth.organizationId ?? null;
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

  const projectId = request.nextUrl.searchParams.get("project_id")?.trim();
  if (!projectId) {
    return NextResponse.json(
      { error: "Missing project_id query parameter" },
      { status: 400 }
    );
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
  });
  if (!project) {
    return NextResponse.json(
      { error: "Project not found for organization" },
      { status: 404 }
    );
  }

  const corpus = await listRegressionEntriesForProject(projectId);
  const summary = await getCorpusSummary(projectId);

  const body: RegressionGetResponse = {
    spec_version: "1.0",
    project_id: projectId,
    corpus,
    summary,
  };

  return NextResponse.json(body);
}
