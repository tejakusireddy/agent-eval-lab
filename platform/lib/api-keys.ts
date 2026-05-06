import crypto from "crypto";

import { NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { AppRole, hasRoleAtLeast } from "@/lib/rbac";

const API_KEY_PREFIX = "ael_live_";
const DEFAULT_SCOPES = ["evaluate:run", "evaluate:read", "usage:read"];

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

function hashApiKey(rawKey: string): string {
  const salt = process.env.API_KEY_HASH_SALT || "";
  return crypto.createHash("sha256").update(`${salt}:${rawKey}`).digest("hex");
}

function generateApiKeyValue(): string {
  const token = crypto.randomBytes(24).toString("base64url");
  return `${API_KEY_PREFIX}${token}`;
}

function buildApiKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, 20);
}

export function extractApiKeyFromRequest(request: NextRequest): string | null {
  const direct = request.headers.get("x-agent-eval-api-key")?.trim();
  if (direct) {
    return direct;
  }

  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization) {
    return null;
  }
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  const token = authorization.slice(7).trim();
  return token || null;
}

export interface ApiKeyAuthResult {
  ok: boolean;
  keyId?: string;
  organizationId?: string;
  orgClerkId?: string;
  role?: AppRole;
  scopes?: string[];
  error?: string;
}

export async function authenticateApiKey(rawKey: string): Promise<ApiKeyAuthResult> {
  if (!rawKey || !rawKey.startsWith(API_KEY_PREFIX)) {
    return { ok: false, error: "Invalid API key format" };
  }

  const keyHash = hashApiKey(rawKey);
  const key = await prisma.apiKey.findFirst({
    where: {
      keyHash,
      revokedAt: null,
    },
    include: {
      organization: {
        select: {
          id: true,
          clerkId: true,
        },
      },
    },
  });

  if (!key) {
    return { ok: false, error: "API key not found or revoked" };
  }

  await prisma.apiKey.update({
    where: { id: key.id },
    data: { lastUsedAt: new Date() },
  });

  const role = (key.role as AppRole) || "evaluator";
  const scopes = toScopes(key.scopes || DEFAULT_SCOPES);
  return {
    ok: true,
    keyId: key.id,
    organizationId: key.organizationId,
    orgClerkId: key.organization.clerkId,
    role,
    scopes: scopes.length > 0 ? scopes : DEFAULT_SCOPES,
  };
}

export async function authenticateApiKeyFromRequest(
  request: NextRequest
): Promise<ApiKeyAuthResult | null> {
  const rawKey = extractApiKeyFromRequest(request);
  if (!rawKey) {
    return null;
  }
  return authenticateApiKey(rawKey);
}

export function hasRequiredScope(
  scopes: string[] | undefined,
  requiredScope: string
): boolean {
  if (!scopes || scopes.length === 0) {
    return false;
  }
  return scopes.includes(requiredScope) || scopes.includes("*");
}

export function apiKeyCanActAsRole(
  role: AppRole | undefined,
  requiredRole: AppRole
): boolean {
  if (!role) {
    return false;
  }
  return hasRoleAtLeast(role, requiredRole);
}

export async function issueApiKey(params: {
  organizationId: string;
  name: string;
  role: AppRole;
  scopes?: string[];
  createdBy?: string | null;
}) {
  const rawKey = generateApiKeyValue();
  const prefix = buildApiKeyPrefix(rawKey);
  const keyHash = hashApiKey(rawKey);
  const scopes = params.scopes && params.scopes.length > 0 ? params.scopes : DEFAULT_SCOPES;

  const apiKey = await prisma.apiKey.create({
    data: {
      organizationId: params.organizationId,
      name: params.name,
      prefix,
      keyHash,
      role: params.role,
      scopes,
      createdBy: params.createdBy || null,
    },
  });

  return {
    apiKey,
    rawKey,
  };
}

export function redactApiKey(rawKey: string): string {
  if (rawKey.length <= 10) {
    return "****";
  }
  return `${rawKey.slice(0, 8)}...${rawKey.slice(-4)}`;
}
