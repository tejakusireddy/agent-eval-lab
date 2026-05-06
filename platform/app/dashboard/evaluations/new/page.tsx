import { AppLayout } from "@/components/layout/app-layout";
import { EvaluationWizard } from "@/components/evaluation/evaluation-wizard";
import { loadScenarioCatalog } from "@/lib/server-scenarios";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function NewEvaluationPage() {
  const { scenarios } = await loadScenarioCatalog();

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl">
        <EvaluationWizard scenarios={scenarios} />
      </div>
    </AppLayout>
  );
}
