import { existsSync } from "fs";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  apiKeyCanActAsRole,
  authenticateApiKeyFromRequest,
  hasRequiredScope,
} from "@/lib/api-keys";
import { getAuth } from "@/lib/auth";
import { hasRoleAtLeast, resolveAppRole } from "@/lib/rbac";
import { loadScenariosFromDirectory } from "@/lib/scenario-loader";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ScenarioItemSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().default(""),
  tags: z.array(z.string()).default([]),
  attack_type: z.string().nullable().optional(),
});

export type ScenarioListItem = z.infer<typeof ScenarioItemSchema>;

const ScenariosResponseSchema = z.object({
  spec_version: z.literal("1.0"),
  scenarios: z.array(ScenarioItemSchema),
  total: z.number().int().nonnegative(),
  grouped: z.record(z.string(), z.array(ScenarioItemSchema)),
});

function resolveScenariosDirectory(): string | null {
  const possiblePaths = [
    join(process.cwd(), "..", "scenario_definitions"),
    join(process.cwd(), "scenario_definitions"),
    join(process.cwd(), "..", "..", "scenario_definitions"),
  ];
  for (const p of possiblePaths) {
    if (existsSync(p)) {
      return p;
    }
  }
  return null;
}

/**
 * Public-ish scenario catalog for onboarding and API clients (session or API key).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const apiKeyAuth = await authenticateApiKeyFromRequest(request);
  if (apiKeyAuth) {
    if (!apiKeyAuth.ok) {
      return NextResponse.json(
        { error: apiKeyAuth.error || "Unauthorized" },
        { status: 401 }
      );
    }
    if (!apiKeyCanActAsRole(apiKeyAuth.role ?? "evaluator", "viewer")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!hasRequiredScope(apiKeyAuth.scopes, "evaluate:read")) {
      return NextResponse.json(
        { error: "Forbidden: missing scope evaluate:read" },
        { status: 403 }
      );
    }
  } else {
    const { userId, orgId } = getAuth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!orgId) {
      return NextResponse.json(
        { error: "Organization context required" },
        { status: 400 }
      );
    }
    const role = await resolveAppRole({ userId, orgId });
    if (!hasRoleAtLeast(role, "viewer")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const dir = resolveScenariosDirectory();
  if (!dir) {
    const payload = ScenariosResponseSchema.parse({
      spec_version: "1.0",
      scenarios: [],
      total: 0,
      grouped: {},
    });
    return NextResponse.json(payload);
  }

  const raw = await loadScenariosFromDirectory(dir);
  const scenarios: ScenarioListItem[] = [];
  for (const s of raw) {
    const row = {
      id: s.id,
      name: s.name,
      description: s.description ?? "",
      tags: Array.isArray(s.tags) ? s.tags : [],
      attack_type: s.attack_type ?? null,
    };
    const v = ScenarioItemSchema.safeParse(row);
    if (!v.success) {
      console.error("scenario_skipped_malformed", {
        id: s.id,
        issues: v.error.issues,
      });
      continue;
    }
    scenarios.push(v.data);
  }

  const grouped: Record<string, ScenarioListItem[]> = {};
  for (const sc of scenarios) {
    const tag = sc.tags[0] ?? "untagged";
    if (!grouped[tag]) {
      grouped[tag] = [];
    }
    grouped[tag].push(sc);
  }

  const payload = ScenariosResponseSchema.parse({
    spec_version: "1.0",
    scenarios,
    total: scenarios.length,
    grouped,
  });

  return NextResponse.json(payload);
}
