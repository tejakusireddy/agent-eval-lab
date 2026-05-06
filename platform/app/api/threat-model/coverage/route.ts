import { existsSync } from "fs";
import { join } from "path";

import { NextRequest, NextResponse } from "next/server";

import { loadScenariosFromDirectory } from "@/lib/scenario-loader";
import {
  THREAT_CATEGORIES,
  computeThreatCoverage,
  getDefaultRequiredThreatIds,
} from "@/lib/threat-model";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseList(value: string | null): string[] {
  if (!value) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    )
  );
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const selectedScenarioIds = parseList(searchParams.get("selected"));
    const requiredThreatIds = parseList(searchParams.get("required_threats"));

    const possiblePaths = [
      join(process.cwd(), "..", "scenario_definitions"),
      join(process.cwd(), "scenario_definitions"),
      join(process.cwd(), "..", "..", "scenario_definitions"),
    ];

    let scenariosDir = "";
    for (const candidate of possiblePaths) {
      if (existsSync(candidate)) {
        scenariosDir = candidate;
        break;
      }
    }

    if (!scenariosDir) {
      return NextResponse.json(
        { error: "scenario_definitions directory not found" },
        { status: 500 }
      );
    }

    const scenarios = await loadScenariosFromDirectory(scenariosDir);
    const coverage = computeThreatCoverage({
      scenarioCatalog: scenarios.map((scenario) => ({
        id: scenario.id,
        tags: scenario.tags || [],
        attack_type: scenario.attack_type || null,
      })),
      selectedScenarioIds,
      requiredThreatIds:
        requiredThreatIds.length > 0 ? requiredThreatIds : getDefaultRequiredThreatIds(),
    });

    return NextResponse.json({
      success: true,
      requiredThreatIds: coverage.requiredThreatIds,
      summary: {
        coveredRequiredCount: coverage.coveredRequiredCount,
        totalRequiredCount: coverage.totalRequiredCount,
        coveragePercent: coverage.coveragePercent,
        missingRequiredThreatIds: coverage.missingRequiredThreatIds,
      },
      threats: coverage.threats,
      taxonomy: THREAT_CATEGORIES.map((threat) => ({
        id: threat.id,
        title: threat.title,
        description: threat.description,
      })),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to compute threat coverage" },
      { status: 500 }
    );
  }
}
