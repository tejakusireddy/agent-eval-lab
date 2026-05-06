import { NextRequest, NextResponse } from "next/server";

import { getAuth } from "@/lib/auth";
import {
  applyDomainPolicyPack,
  DOMAIN_POLICY_PACKS,
  getDomainPolicyPackById,
} from "@/lib/domain-policy-packs";
import {
  createPolicyVersion,
  getActivePolicyVersion,
} from "@/lib/policy-registry";
import { authorizeRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const { userId, orgId } = getAuth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const authz = await authorizeRole({ userId, orgId, requiredRole: "viewer" });
    if (!authz.ok) {
      return NextResponse.json(
        {
          error: "Forbidden: viewer role required",
          requiredRole: "viewer",
          currentRole: authz.role,
        },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      packs: DOMAIN_POLICY_PACKS.map((pack) => ({
        id: pack.id,
        title: pack.title,
        description: pack.description,
        notes: pack.notes,
        requiredThreats: pack.requiredThreats,
        recommendedScenarioIds: pack.recommendedScenarioIds,
      })),
      access: {
        role: authz.role,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to load policy packs" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, orgId } = getAuth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const authz = await authorizeRole({ userId, orgId, requiredRole: "admin" });
    if (!authz.ok) {
      return NextResponse.json(
        {
          error: "Forbidden: admin role required",
          requiredRole: "admin",
          currentRole: authz.role,
        },
        { status: 403 }
      );
    }

    const body = await request.json();
    const packId = typeof body?.packId === "string" ? body.packId.trim() : "";
    const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
    const activate = Boolean(body?.activate ?? true);

    if (!packId) {
      return NextResponse.json({ error: "packId is required" }, { status: 400 });
    }

    const pack = getDomainPolicyPackById(packId);
    if (!pack) {
      return NextResponse.json({ error: "Unknown policy pack" }, { status: 404 });
    }

    const active = getActivePolicyVersion();
    if (!active.entry) {
      return NextResponse.json(
        { error: active.error || "Active policy unavailable" },
        { status: 500 }
      );
    }

    const nextVersion = active.entry.version + 1;
    const policy = applyDomainPolicyPack(active.entry.policy, pack, nextVersion);

    const created = createPolicyVersion({
      policy,
      name: active.entry.name,
      version: nextVersion,
      notes: notes || `Applied domain policy pack: ${pack.title}`,
      createdBy: userId,
      activate,
    });

    if (!created.entry) {
      return NextResponse.json(
        { error: created.error || "Failed to create policy version from pack" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      pack: {
        id: pack.id,
        title: pack.title,
      },
      created: {
        id: created.entry.id,
        name: created.entry.name,
        version: created.entry.version,
        created_at: created.entry.created_at,
        notes: created.entry.notes,
      },
      activePolicyId: created.activePolicyId,
      activated: activate,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to apply policy pack" },
      { status: 500 }
    );
  }
}
