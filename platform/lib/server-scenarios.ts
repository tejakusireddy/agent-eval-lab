import { existsSync } from "fs";
import { join } from "path";

import {
  categorizeScenarios,
  loadScenariosFromDirectory,
  type ScenarioDefinition,
} from "@/lib/scenario-loader";

const SCENARIO_PATH_CANDIDATES = [
  join(process.cwd(), "..", "scenario_definitions"),
  join(process.cwd(), "scenario_definitions"),
  join(process.cwd(), "..", "..", "scenario_definitions"),
];

export async function loadScenarioCatalog(): Promise<{
  scenarios: ScenarioDefinition[];
  categories: Record<string, ScenarioDefinition[]>;
}> {
  let scenarios: ScenarioDefinition[] = [];

  for (const scenariosDir of SCENARIO_PATH_CANDIDATES) {
    try {
      if (!existsSync(scenariosDir)) {
        continue;
      }

      const loaded = await loadScenariosFromDirectory(scenariosDir);
      if (loaded.length > 0) {
        scenarios = loaded;
        break;
      }
    } catch {
      continue;
    }
  }

  return {
    scenarios,
    categories: categorizeScenarios(scenarios),
  };
}
