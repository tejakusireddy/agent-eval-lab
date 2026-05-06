import { NextRequest, NextResponse } from "next/server";

import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { authorizeRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function toBoundedLimit(value: string | null, fallback: number = 50): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(200, Math.max(1, Math.floor(parsed)));
}

export async function GET(request: NextRequest) {
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

    const limit = toBoundedLimit(request.nextUrl.searchParams.get("limit"));
    const eventType = request.nextUrl.searchParams.get("eventType")?.trim() || null;
    const severity = request.nextUrl.searchParams.get("severity")?.trim() || null;

    const where: Record<string, unknown> = {};
    if (orgId) {
      where.OR = [{ organizationId: orgId }, { organizationId: null }];
    }
    if (eventType) {
      where.eventType = eventType;
    }
    if (severity) {
      where.severity = severity;
    }

    const events = await prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({
      success: true,
      total: events.length,
      events: events.map((event) => ({
        id: event.id,
        eventId: event.eventId,
        eventType: event.eventType,
        severity: event.severity,
        title: event.title,
        lines: event.lines,
        metadata: event.metadata,
        organizationId: event.organizationId,
        evaluationId: event.evaluationId,
        payloadSha256: event.payloadSha256,
        signatureAlgorithm: event.signatureAlgorithm,
        signatureKeyId: event.signatureKeyId,
        signaturePreview: event.signatureValue
          ? `${event.signatureValue.slice(0, 12)}...`
          : null,
        deliveryStatus: event.deliveryStatus,
        createdAt: event.createdAt,
      })),
      access: {
        role: authz.role,
      },
    });
  } catch (error: any) {
    console.error("Audit events API error:", error);
    return NextResponse.json(
      {
        error: error?.message || "Internal server error",
        hint: "If AuditEvent table is missing, run `cd platform && npm run db:push`",
      },
      { status: 500 }
    );
  }
}
