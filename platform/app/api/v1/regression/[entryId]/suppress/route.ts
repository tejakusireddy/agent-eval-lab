import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { getAuth } from "@/lib/auth";
import {
  apiKeyCanActAsRole,
  authenticateApiKeyFromRequest,
  hasRequiredScope,
} from "@/lib/api-keys";
import { prisma } from "@/lib/db";
import { ensureOrganizationByClerkId } from "@/lib/org";
import { hasRoleAtLeast, resolveAppRole } from "@/lib/rbac";
import { suppressEntry } from "@/lib/regression-corpus";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const BodySchema = z.object({
  reason: z.string().optional(),
});

type SuppressResponse = {
  suppressed: true;
  entry_id: string;
};

/**
 * POST /api/v1/regression/[entryId]/suppress — suppress a regression entry.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ entryId: string }> | { entryId: string } }
): Promise<NextResponse<SuppressResponse | { error: string }>> {
  const params = await Promise.resolve(context.params);
  const entryId = params.entryId;

  let organizationId: string | null = null;

  try {
    const { userId, orgId } = getAuth();

    if (userId) {
      const authRole = await resolveAppRole({ userId, orgId });
      if (!hasRoleAtLeast(authRole, "release_manager")) {
        return NextResponse.json(
          { error: "Forbidden: release_manager role required" },
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
      if (!apiKeyCanActAsRole(apiKeyAuth.role, "release_manager")) {
        return NextResponse.json(
          { error: "Forbidden: release_manager role required" },
          { status: 403 }
        );
      }
      if (!hasRequiredScope(apiKeyAuth.scopes, "evaluate:run")) {
        return NextResponse.json(
          { error: "Forbidden: missing scope evaluate:run" },
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

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    json = {};
  }

  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const entry = await prisma.regressionEntry.findFirst({
    where: { id: entryId },
    include: { project: { select: { organizationId: true } } },
  });

  if (!entry || entry.project.organizationId !== organizationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await suppressEntry(entryId, entry.projectId);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Suppress failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (parsed.data.reason) {
    const prev =
      entry.metadata &&
      typeof entry.metadata === "object" &&
      !Array.isArray(entry.metadata)
        ? (entry.metadata as Record<string, unknown>)
        : {};
    const merged: Record<string, unknown> = {
      ...prev,
      suppress_reason: parsed.data.reason,
    };
    await prisma.regressionEntry.update({
      where: { id: entryId },
      data: { metadata: merged as Prisma.InputJsonValue },
    });
  }

  const body: SuppressResponse = { suppressed: true, entry_id: entryId };
  return NextResponse.json(body);
}
