import { prisma } from "@/lib/db";

export type AppRole = "viewer" | "evaluator" | "release_manager" | "admin";

const ROLE_RANK: Record<AppRole, number> = {
  viewer: 1,
  evaluator: 2,
  release_manager: 3,
  admin: 4,
};

function toRole(value: string | null | undefined): AppRole | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "viewer" || normalized === "read_only" || normalized === "readonly") {
    return "viewer";
  }
  if (normalized === "evaluator" || normalized === "member" || normalized === "developer") {
    return "evaluator";
  }
  if (
    normalized === "release_manager" ||
    normalized === "release-manager" ||
    normalized === "manager"
  ) {
    return "release_manager";
  }
  if (normalized === "admin" || normalized === "owner" || normalized === "org:admin") {
    return "admin";
  }

  return null;
}

function parseUserList(envKey: string): Set<string> {
  const raw = process.env[envKey];
  if (!raw) {
    return new Set();
  }

  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

function getDefaultRole(): AppRole {
  const configured = toRole(process.env.RBAC_DEFAULT_ROLE);
  if (configured) {
    return configured;
  }

  return process.env.NODE_ENV === "production" ? "viewer" : "admin";
}

function isStrictModeEnabled(): boolean {
  const raw = (process.env.RBAC_STRICT || "false").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function roleFromEnvAllowlist(userId: string): AppRole | null {
  const adminUsers = parseUserList("RBAC_ADMIN_USER_IDS");
  if (adminUsers.has(userId)) {
    return "admin";
  }

  const releaseManagerUsers = parseUserList("RBAC_RELEASE_MANAGER_USER_IDS");
  if (releaseManagerUsers.has(userId)) {
    return "release_manager";
  }

  const evaluatorUsers = parseUserList("RBAC_EVALUATOR_USER_IDS");
  if (evaluatorUsers.has(userId)) {
    return "evaluator";
  }

  const viewerUsers = parseUserList("RBAC_VIEWER_USER_IDS");
  if (viewerUsers.has(userId)) {
    return "viewer";
  }

  return null;
}

function mapOrganizationRole(role: string | null | undefined): AppRole | null {
  return toRole(role || null);
}

export function hasRoleAtLeast(role: AppRole, required: AppRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

export async function resolveAppRole(params: {
  userId: string | null | undefined;
  orgId: string | null | undefined;
}): Promise<AppRole> {
  const userId = params.userId || null;
  const orgId = params.orgId || null;

  if (!userId) {
    return "viewer";
  }

  const allowlistedRole = roleFromEnvAllowlist(userId);
  if (allowlistedRole) {
    return allowlistedRole;
  }

  if (orgId) {
    try {
      const org = await prisma.organization.findUnique({
        where: { clerkId: orgId },
        select: {
          id: true,
          members: {
            where: { userId },
            select: { role: true },
            take: 1,
          },
        },
      });

      const orgRole = mapOrganizationRole(org?.members?.[0]?.role || null);
      if (orgRole) {
        return orgRole;
      }
    } catch (error) {
      console.warn("RBAC org lookup failed, using fallback role:", error);
    }
  }

  if (isStrictModeEnabled()) {
    return "viewer";
  }

  return getDefaultRole();
}

export async function authorizeRole(params: {
  userId: string | null | undefined;
  orgId: string | null | undefined;
  requiredRole: AppRole;
}): Promise<{ ok: boolean; role: AppRole }> {
  const role = await resolveAppRole({
    userId: params.userId,
    orgId: params.orgId,
  });

  return {
    ok: hasRoleAtLeast(role, params.requiredRole),
    role,
  };
}
