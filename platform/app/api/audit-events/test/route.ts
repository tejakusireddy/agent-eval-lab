import { NextResponse } from "next/server";

import { getAuth } from "@/lib/auth";
import { sendAuditEvent } from "@/lib/alerts";
import { authorizeRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST() {
  try {
    const { userId, orgId } = getAuth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const authz = await authorizeRole({
      userId,
      orgId,
      requiredRole: "release_manager",
    });
    if (!authz.ok) {
      return NextResponse.json(
        {
          error: "Forbidden: release_manager role required",
          requiredRole: "release_manager",
          currentRole: authz.role,
        },
        { status: 403 }
      );
    }

    await sendAuditEvent({
      eventType: "platform.audit.test",
      severity: "info",
      title: "Audit Pipeline Test",
      actorUserId: userId,
      organizationId: orgId,
      lines: [
        "Signed audit event test triggered from settings API.",
        "Use this event to verify Slack signature + persistence.",
      ],
      metadata: {
        triggered_from: "/api/audit-events/test",
      },
    });

    return NextResponse.json({
      success: true,
      message: "Audit test event sent",
    });
  } catch (error: any) {
    console.error("Audit test API error:", error);
    return NextResponse.json(
      {
        error: error?.message || "Internal server error",
      },
      { status: 500 }
    );
  }
}
