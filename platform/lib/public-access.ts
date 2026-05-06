import crypto from "crypto";
import { NextRequest } from "next/server";

import { ensureOrganizationByClerkId } from "@/lib/org";

const PUBLIC_CLERK_ID_PREFIX = "public-self-serve:";

function pickClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor
      .split(",")
      .map((entry) => entry.trim())
      .find((entry) => entry.length > 0);
    if (first) {
      return first;
    }
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp && realIp.trim()) {
    return realIp.trim();
  }

  // request.ip is available in some runtimes; fallback to a stable placeholder.
  return request.ip || "unknown-ip";
}

function fingerprint(value: string): string {
  const salt = process.env.PUBLIC_SELF_SERVE_SALT || "agent-eval-lab-public";
  return crypto
    .createHash("sha256")
    .update(`${salt}:${value}`)
    .digest("hex")
    .slice(0, 24);
}

export function isPublicSelfServeEnabled(): boolean {
  return process.env.PUBLIC_SELF_SERVE_MODE === "true";
}

export function getPublicSelfServeDailyLimit(): number {
  const fromEnv = Number(process.env.PUBLIC_SELF_SERVE_DAILY_LIMIT || 3);
  if (!Number.isFinite(fromEnv)) {
    return 3;
  }
  return Math.max(1, Math.floor(fromEnv));
}

export function getPublicSelfServeMaxScenarios(): number {
  const fromEnv = Number(process.env.PUBLIC_SELF_SERVE_MAX_SCENARIOS || 3);
  if (!Number.isFinite(fromEnv)) {
    return 3;
  }
  return Math.max(1, Math.floor(fromEnv));
}

export function getPublicSelfServeActorId(request: NextRequest): string {
  const ip = pickClientIp(request);
  return fingerprint(ip);
}

export function getPublicSelfServeOrganizationClerkId(actorId: string): string {
  return `${PUBLIC_CLERK_ID_PREFIX}${actorId}`;
}

export function isPublicSelfServeOrganizationClerkId(clerkId: string): boolean {
  return clerkId.startsWith(PUBLIC_CLERK_ID_PREFIX);
}

export async function ensurePublicSelfServeOrganization(request: NextRequest) {
  const actorId = getPublicSelfServeActorId(request);
  const clerkId = getPublicSelfServeOrganizationClerkId(actorId);
  const organization = await ensureOrganizationByClerkId({
    clerkId,
    fallbackName: `Public Self-Serve ${actorId.slice(0, 8)}`,
  });
  return {
    actorId,
    organization,
  };
}
