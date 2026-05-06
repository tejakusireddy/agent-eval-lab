import { readFile, readdir, stat } from "fs/promises";
import { join } from "path";
import { parse } from "yaml";
import { existsSync } from "fs";

export interface ScenarioDefinition {
  id: string;
  name: string;
  description: string;
  attack_type: string;
  max_attempts: number;
  prompt_template: string;
  pass_criteria: string[];
  fail_criteria: {
    minor?: string[];
    critical?: string[];
  };
  tags: string[];
  severity_expectation?: string;
  example_failure_snippet?: string;
}

async function getAllYamlFiles(dir: string, fileList: string[] = []): Promise<string[]> {
  if (!existsSync(dir)) {
    return fileList;
  }

  const files = await readdir(dir);

  for (const file of files) {
    const filePath = join(dir, file);
    const fileStat = await stat(filePath);

    if (fileStat.isDirectory()) {
      await getAllYamlFiles(filePath, fileList);
    } else if (file.endsWith(".yaml") || file.endsWith(".yml")) {
      fileList.push(filePath);
    }
  }

  return fileList;
}

export async function loadScenariosFromDirectory(
  directory: string
): Promise<ScenarioDefinition[]> {
  if (!existsSync(directory)) {
    return [];
  }

  const yamlFiles = await getAllYamlFiles(directory);
  const scenarios: ScenarioDefinition[] = [];

  for (const filePath of yamlFiles) {
    try {
      const content = await readFile(filePath, "utf-8");
      const scenario = parse(content) as ScenarioDefinition;
      if (scenario.id && scenario.name) {
        scenarios.push(scenario);
      }
    } catch {
      // Skip invalid scenario files silently
    }
  }

  return scenarios;
}

export function categorizeScenarios(
  scenarios: ScenarioDefinition[]
): Record<string, ScenarioDefinition[]> {
  const categories: Record<string, ScenarioDefinition[]> = {};

  for (const scenario of scenarios) {
    const category = scenario.id.split(".")[0] || "other";
    if (!categories[category]) {
      categories[category] = [];
    }
    categories[category].push(scenario);
  }

  return categories;
}

export function getScenarioSeverity(
  scenario: ScenarioDefinition
): "low" | "medium" | "high" {
  const hasCritical = (scenario.fail_criteria.critical?.length || 0) > 0;
  const hasMinor = (scenario.fail_criteria.minor?.length || 0) > 0;

  if (hasCritical) return "high";
  if (hasMinor) return "medium";
  return "low";
}
