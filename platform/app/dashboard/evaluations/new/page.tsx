import { AppLayout } from "@/components/layout/app-layout";
import { EvaluationWizard } from "@/components/evaluation/evaluation-wizard";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function getScenarios() {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/scenarios`, {
      cache: "no-store",
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      return [];
    }
    const data = await res.json();
    return data.scenarios || [];
  } catch {
    return [];
  }
}

export default async function NewEvaluationPage() {
  const scenarios = await getScenarios();

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl">
        <EvaluationWizard scenarios={scenarios} />
      </div>
    </AppLayout>
  );
}
