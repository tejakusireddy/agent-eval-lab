import { existsSync } from "fs";
import { join } from "path";
import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth";
import { AppLayout } from "@/components/layout/app-layout";
import { BatchWizard } from "@/components/batch/batch-wizard";
import { loadScenariosFromDirectory } from "@/lib/scenario-loader";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function getScenarios() {
  const possiblePaths = [
    join(process.cwd(), "..", "scenario_definitions"),
    join(process.cwd(), "scenario_definitions"),
    join(process.cwd(), "..", "..", "scenario_definitions"),
  ];

  for (const scenariosDir of possiblePaths) {
    if (!existsSync(scenariosDir)) {
      continue;
    }

    try {
      const scenarios = await loadScenariosFromDirectory(scenariosDir);
      if (scenarios.length > 0) {
        return scenarios;
      }
    } catch {
      // Try next path.
    }
  }

  return [];
}

export default async function NewBatchPage() {
  const { userId } = getAuth();
  if (!userId) {
    redirect("/");
  }

  const scenarios = await getScenarios();

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl">
        <BatchWizard scenarios={scenarios} />
      </div>
    </AppLayout>
  );
}
