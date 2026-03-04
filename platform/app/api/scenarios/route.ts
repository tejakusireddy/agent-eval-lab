import { NextResponse } from "next/server";
import { loadScenariosFromDirectory, categorizeScenarios } from "@/lib/scenario-loader";
import { join } from "path";
import { existsSync } from "fs";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const possiblePaths = [
      join(process.cwd(), "..", "scenario_definitions"),
      join(process.cwd(), "scenario_definitions"),
      join(process.cwd(), "..", "..", "scenario_definitions"),
    ];

    let scenarios: any[] = [];
    for (const scenariosDir of possiblePaths) {
      try {
        if (existsSync(scenariosDir)) {
          scenarios = await loadScenariosFromDirectory(scenariosDir);
          if (scenarios.length > 0) break;
        }
      } catch {
        continue;
      }
    }

    const categorized = categorizeScenarios(scenarios);

    return NextResponse.json({
      scenarios,
      categories: categorized,
      total: scenarios.length,
    });
  } catch (error: any) {
    console.error("Scenarios API error:", error);
    return NextResponse.json(
      { 
        error: error.message || "Failed to load scenarios",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}

