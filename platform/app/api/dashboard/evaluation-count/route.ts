import { NextResponse } from "next/server";

import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Lightweight count for nav / onboarding (session only).
 */
export async function GET(): Promise<NextResponse<{ count: number }>> {
  const { userId, orgId } = getAuth();
  if (!userId || !orgId) {
    return NextResponse.json({ count: -1 }, { status: 401 });
  }

  try {
    const org = await prisma.organization.findUnique({
      where: { clerkId: orgId },
      select: { id: true },
    });
    if (!org) {
      return NextResponse.json({ count: 0 });
    }
    const count = await prisma.evaluation.count({
      where: { project: { organizationId: org.id } },
    });
    return NextResponse.json({ count });
  } catch (e: unknown) {
    console.error("evaluation_count_failed", e);
    return NextResponse.json({ count: 0 }, { status: 500 });
  }
}
