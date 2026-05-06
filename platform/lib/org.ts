import { prisma } from "@/lib/db";

export async function ensureOrganizationByClerkId(params: {
  clerkId: string;
  fallbackName?: string;
}) {
  const { clerkId, fallbackName } = params;
  const normalizedClerkId = clerkId.trim();
  if (!normalizedClerkId) {
    throw new Error("Organization clerkId is required");
  }

  const existing = await prisma.organization.findUnique({
    where: { clerkId: normalizedClerkId },
  });
  if (existing) {
    return existing;
  }

  return prisma.organization.create({
    data: {
      clerkId: normalizedClerkId,
      name: fallbackName || "Default Organization",
    },
  });
}
