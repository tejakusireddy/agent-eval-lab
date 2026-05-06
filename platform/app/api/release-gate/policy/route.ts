import { NextRequest, NextResponse } from "next/server";

import { getAuth } from "@/lib/auth";
import {
  createPolicyVersion,
  getActivePolicyVersion,
  listPolicyVersions,
  setActivePolicyVersion,
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

    const active = getActivePolicyVersion();
    const versions = listPolicyVersions();

    if (!active.entry) {
      return NextResponse.json(
        {
          available: false,
          error: active.error || "release policy unavailable",
          policyPath: active.policyPath,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      available: true,
      policyPath: active.policyPath,
      activePolicyId: versions.activePolicyId,
      policies: versions.policies,
      policy: {
        id: active.entry.id,
        name: active.entry.name,
        version: active.entry.version,
        fail_on: active.entry.policy.fail_on,
        required: active.entry.policy.required,
        block: active.entry.policy.block,
        operational: active.entry.policy.operational,
        regression: active.entry.policy.regression,
      },
      access: {
        role: authz.role,
      },
    });
  } catch (error: any) {
    console.error("Release policy API error:", error);
    return NextResponse.json(
      {
        error: error.message || "Internal server error",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
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
    const created = createPolicyVersion({
      policy: body?.policy,
      name: body?.name,
      version: body?.version,
      notes: body?.notes,
      createdBy: userId,
      activate: Boolean(body?.activate),
    });

    if (!created.entry) {
      return NextResponse.json(
        {
          error: created.error || "Failed to create policy version",
          policyPath: created.policyPath,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      policyPath: created.policyPath,
      activePolicyId: created.activePolicyId,
      created: {
        id: created.entry.id,
        name: created.entry.name,
        version: created.entry.version,
        created_at: created.entry.created_at,
        notes: created.entry.notes,
      },
    });
  } catch (error: any) {
    console.error("Create policy version API error:", error);
    return NextResponse.json(
      {
        error: error.message || "Internal server error",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
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
    const policyId =
      typeof body?.activePolicyId === "string" ? body.activePolicyId.trim() : "";

    if (!policyId) {
      return NextResponse.json(
        { error: "activePolicyId is required" },
        { status: 400 }
      );
    }

    const updated = setActivePolicyVersion({
      policyId,
      updatedBy: userId,
    });

    if (!updated.activeEntry) {
      return NextResponse.json(
        {
          error: updated.error || "Failed to activate policy",
          policyPath: updated.policyPath,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      policyPath: updated.policyPath,
      activePolicyId: updated.activeEntry.id,
      activePolicy: {
        id: updated.activeEntry.id,
        name: updated.activeEntry.name,
        version: updated.activeEntry.version,
      },
    });
  } catch (error: any) {
    console.error("Activate policy API error:", error);
    return NextResponse.json(
      {
        error: error.message || "Internal server error",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
