import { NextRequest, NextResponse } from "next/server";

import { getAuth } from "@/lib/auth";
import { issueApiKey } from "@/lib/api-keys";
import { prisma } from "@/lib/db";
import { ensureOrganizationByClerkId } from "@/lib/org";
import { AppRole, authorizeRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseRole(value: unknown): AppRole {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "viewer" || raw === "evaluator" || raw === "release_manager" || raw === "admin") {
    return raw as AppRole;
  }
  return "evaluator";
}

function toScopes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    )
  );
}

export async function GET() {
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

    const org = await ensureOrganizationByClerkId({ clerkId: orgId });
    const keys = await prisma.apiKey.findMany({
      where: { organizationId: org.id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      success: true,
      keys: keys.map((key) => ({
        id: key.id,
        name: key.name,
        prefix: key.prefix,
        role: key.role,
        scopes: key.scopes || [],
        createdBy: key.createdBy,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt,
        revokedAt: key.revokedAt,
      })),
    });
  } catch (error: any) {
    console.error("API keys GET error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const org = await ensureOrganizationByClerkId({ clerkId: orgId });
    const role = parseRole(body?.role);
    const scopes = toScopes(body?.scopes);

    const issued = await issueApiKey({
      organizationId: org.id,
      name,
      role,
      scopes,
      createdBy: userId,
    });

    return NextResponse.json({
      success: true,
      apiKey: {
        id: issued.apiKey.id,
        name: issued.apiKey.name,
        prefix: issued.apiKey.prefix,
        role: issued.apiKey.role,
        scopes: issued.apiKey.scopes || [],
        createdAt: issued.apiKey.createdAt,
      },
      secret: issued.rawKey,
      note: "Copy and store this secret now. It will not be shown again.",
    });
  } catch (error: any) {
    console.error("API keys POST error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
