import { NextResponse } from "next/server";

import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ensureOrganizationByClerkId } from "@/lib/org";
import { authorizeRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { userId, orgId } = getAuth();
    if (!userId || !orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const authz = await authorizeRole({ userId, orgId, requiredRole: "admin" });
    if (!authz.ok) {
      return NextResponse.json(
        { error: "Forbidden: admin role required", currentRole: authz.role },
        { status: 403 }
      );
    }

    const resolvedParams = await Promise.resolve(params);
    const org = await ensureOrganizationByClerkId({ clerkId: orgId });

    const key = await prisma.apiKey.findFirst({
      where: {
        id: resolvedParams.id,
        organizationId: org.id,
      },
    });
    if (!key) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }
    if (key.revokedAt) {
      return NextResponse.json({ success: true, alreadyRevoked: true });
    }

    await prisma.apiKey.update({
      where: { id: key.id },
      data: { revokedAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("API key revoke error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
