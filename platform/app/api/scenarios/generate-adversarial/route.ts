import { mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

import { NextRequest, NextResponse } from "next/server";

import {
  apiKeyCanActAsRole,
  authenticateApiKeyFromRequest,
  hasRequiredScope,
} from "@/lib/api-keys";
import {
  generateAdversarialScenarios,
  AdversarialGenerationInput,
} from "@/lib/adversarial-scenario-generator";
import { getAuth } from "@/lib/auth";
import { THREAT_CATEGORIES } from "@/lib/threat-model";
import { authorizeRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const INTENSITIES = ["low", "medium", "high"] as const;

function sanitizeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function toCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 3;
  }
  return Math.max(1, Math.min(20, Math.floor(parsed)));
}

function toIntensity(value: unknown): "low" | "medium" | "high" {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "low" || normalized === "high") {
    return normalized;
  }
  return "medium";
}

function findScenarioDefinitionsDir(): string {
  const candidates = [
    join(process.cwd(), "..", "scenario_definitions"),
    join(process.cwd(), "scenario_definitions"),
    join(process.cwd(), "..", "..", "scenario_definitions"),
  ];
  const existing = candidates.find((candidate) => existsSync(candidate));
  if (existing) {
    return existing;
  }
  return candidates[0];
}

async function checkAccess(request: NextRequest): Promise<{
  ok: boolean;
  status: number;
  role?: string;
  error?: string;
}> {
  const { userId, orgId } = getAuth();
  if (userId) {
    if (!orgId) {
      return { ok: false, status: 401, error: "Unauthorized" };
    }
    const authz = await authorizeRole({
      userId,
      orgId,
      requiredRole: "release_manager",
    });
    if (!authz.ok) {
      return {
        ok: false,
        status: 403,
        error: "Forbidden: release_manager role required",
        role: authz.role,
      };
    }
    return { ok: true, status: 200, role: authz.role };
  }

  const apiKeyAuth = await authenticateApiKeyFromRequest(request);
  if (!apiKeyAuth) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  if (!apiKeyAuth.ok) {
    return { ok: false, status: 401, error: apiKeyAuth.error || "Unauthorized" };
  }
  if (!apiKeyCanActAsRole(apiKeyAuth.role, "release_manager")) {
    return {
      ok: false,
      status: 403,
      error: "Forbidden: release_manager role required",
      role: apiKeyAuth.role,
    };
  }
  if (
    !hasRequiredScope(apiKeyAuth.scopes, "evaluate:run") &&
    !hasRequiredScope(apiKeyAuth.scopes, "evaluate:read")
  ) {
    return {
      ok: false,
      status: 403,
      error: "Forbidden: missing scope evaluate:run or evaluate:read",
      role: apiKeyAuth.role,
    };
  }
  return { ok: true, status: 200, role: apiKeyAuth.role };
}

export async function GET(request: NextRequest) {
  const access = await checkAccess(request);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error, role: access.role },
      { status: access.status }
    );
  }

  return NextResponse.json({
    success: true,
    defaults: {
      count: 3,
      intensity: "medium",
      idPrefix: "generated",
      persist: false,
    },
    intensities: INTENSITIES,
    threats: THREAT_CATEGORIES.map((threat) => ({
      id: threat.id,
      title: threat.title,
      description: threat.description,
      recommendedScenarioIds: threat.recommendedScenarioIds,
    })),
    access: {
      role: access.role,
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const access = await checkAccess(request);
    if (!access.ok) {
      return NextResponse.json(
        { error: access.error, role: access.role },
        { status: access.status }
      );
    }

    const body = await request.json();
    const input: AdversarialGenerationInput = {
      threatId:
        typeof body?.threatId === "string" && body.threatId.trim().length > 0
          ? body.threatId.trim()
          : "security_surface_expansion",
      domain:
        typeof body?.domain === "string" && body.domain.trim().length > 0
          ? body.domain.trim()
          : "general",
      count: toCount(body?.count),
      intensity: toIntensity(body?.intensity),
      idPrefix:
        typeof body?.idPrefix === "string" && body.idPrefix.trim().length > 0
          ? body.idPrefix.trim()
          : "generated",
    };
    const persist = Boolean(body?.persist);

    const generated = generateAdversarialScenarios(input);

    const persistedFiles: string[] = [];
    let persistWarning: string | null = null;

    if (persist) {
      const scenariosRoot = findScenarioDefinitionsDir();
      const generatedDir = join(scenariosRoot, "generated_adversarial");
      try {
        await mkdir(generatedDir, { recursive: true });
        for (const item of generated) {
          const fileName = `${sanitizeFilename(item.scenario.id)}.yaml`;
          const filePath = join(generatedDir, fileName);
          await writeFile(filePath, item.yaml, "utf-8");
          persistedFiles.push(filePath);
        }
      } catch (error: any) {
        persistWarning =
          error?.message ||
          "Failed to persist generated scenarios to disk (non-writable runtime).";
      }
    }

    return NextResponse.json({
      success: true,
      generatedCount: generated.length,
      generated: generated.map((item) => ({
        id: item.scenario.id,
        name: item.scenario.name,
        attack_type: item.scenario.attack_type,
        tags: item.scenario.tags,
        severity_expectation: item.scenario.severity_expectation,
        prompt_template: item.scenario.prompt_template,
        yaml: item.yaml,
      })),
      persisted: {
        requested: persist,
        count: persistedFiles.length,
        files: persistedFiles,
        warning: persistWarning,
      },
      access: {
        role: access.role,
      },
    });
  } catch (error: any) {
    console.error("Adversarial scenario generation API error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to generate adversarial scenarios" },
      { status: 500 }
    );
  }
}
