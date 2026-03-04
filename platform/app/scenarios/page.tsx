import { AppLayout } from "@/components/layout/app-layout";
import { loadScenariosFromDirectory, categorizeScenarios, getScenarioSeverity } from "@/lib/scenario-loader";
import { join } from "path";
import { existsSync } from "fs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ScenariosPage() {
  const possiblePaths = [
    join(process.cwd(), "..", "scenario_definitions"),
    join(process.cwd(), "scenario_definitions"),
    join(process.cwd(), "..", "..", "scenario_definitions"),
  ];

  let scenarios: any[] = [];

  for (const scenariosDir of possiblePaths) {
    try {
      if (existsSync(scenariosDir)) {
        const loaded = await loadScenariosFromDirectory(scenariosDir);
        if (loaded.length > 0) {
          scenarios = loaded;
          break;
        }
      }
    } catch (error) {
      continue;
    }
  }

  const categories = categorizeScenarios(scenarios);

  return (
    <AppLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
            Scenario Marketplace
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Browse and explore available evaluation scenarios
          </p>
        </div>

        {scenarios.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <div className="text-lg font-semibold text-gray-900">
                No scenarios found
              </div>
              <p className="mt-2 text-sm text-gray-500">
                Make sure the scenario_definitions directory exists and contains YAML files
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    Total Scenarios: <span className="font-semibold text-gray-900">{scenarios.length}</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {Object.keys(categories).length} categories loaded
                  </div>
                </div>
                <Badge variant="success" className="text-xs">
                  All Scenarios Loaded
                </Badge>
              </div>
            </div>
            {Object.entries(categories).map(([category, categoryScenarios]) => (
              <div key={category} className="space-y-4">
                <div className="flex items-center justify-between border-b border-gray-200 pb-2">
                  <h2 className="text-lg font-semibold capitalize text-gray-900">
                    {category.replace(/_/g, " ")}
                  </h2>
                  <Badge variant="secondary" className="text-xs">
                    {categoryScenarios.length} scenarios
                  </Badge>
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {categoryScenarios.map((scenario) => {
                    const severity = getScenarioSeverity(scenario);
                    return (
                      <Card key={scenario.id} className="hover:border-gray-300 hover:shadow-sm transition-all">
                        <CardHeader>
                          <div className="flex items-start justify-between gap-2">
                            <CardTitle className="text-base leading-tight">{scenario.name}</CardTitle>
                            <Badge
                              variant={
                                severity === "high"
                                  ? "destructive"
                                  : severity === "medium"
                                  ? "warning"
                                  : "secondary"
                              }
                              className="shrink-0 text-xs"
                            >
                              {severity}
                            </Badge>
                          </div>
                          <div className="mt-1 text-xs text-gray-400 font-mono">
                            {scenario.id}
                          </div>
                        </CardHeader>
                        <CardContent>
                          <p className="mb-4 text-sm text-gray-600 line-clamp-3">
                            {scenario.description}
                          </p>
                          {scenario.tags && scenario.tags.length > 0 && (
                            <div className="mb-4 flex flex-wrap gap-1.5">
                              {scenario.tags.slice(0, 5).map((tag: string) => (
                                <Badge key={tag} variant="outline" className="text-xs">
                                  {tag}
                                </Badge>
                              ))}
                              {scenario.tags.length > 5 && (
                                <Badge variant="outline" className="text-xs">
                                  +{scenario.tags.length - 5}
                                </Badge>
                              )}
                            </div>
                          )}
                          <div className="space-y-1.5 text-xs text-gray-500">
                            <div className="flex items-center justify-between">
                              <span className="text-gray-400">Attack Type:</span>
                              <span className="font-medium">{scenario.attack_type?.replace(/_/g, " ") || "N/A"}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-gray-400">Max Attempts:</span>
                              <span className="font-medium">{scenario.max_attempts || 1}</span>
                            </div>
                            {scenario.severity_expectation && (
                              <div className="flex items-center justify-between">
                                <span className="text-gray-400">Expected Severity:</span>
                                <Badge variant="outline" className="text-xs">
                                  {scenario.severity_expectation}
                                </Badge>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </AppLayout>
  );
}
