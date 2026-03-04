import { AppLayout } from "@/components/layout/app-layout";
import { EvaluationWizard } from "@/components/evaluation/evaluation-wizard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Info } from "lucide-react";
import { HttpAgentPlayground } from "@/components/sandbox/http-agent-playground";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function getScenarios() {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/scenarios`, {
      cache: "no-store",
    });
    const data = await res.json();
    return data.scenarios || [];
  } catch {
    return [];
  }
}

const EXAMPLE_URLS = [
  "http://localhost:8000",
  "https://api.example.com/v1",
  "https://your-agent.example.com/chat",
];

export default async function SandboxPage() {
  const scenarios = await getScenarios();

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
            Agent Playground
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Interact with your HTTP agent first, then run red-team evaluations.
          </p>
        </div>

        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Info className="h-5 w-5 text-blue-600" />
              <CardTitle className="text-base text-blue-900">Example Base URLs</CardTitle>
            </div>
            <CardDescription className="text-blue-700">
              Common endpoints for testing HTTP agents
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_URLS.map((url) => (
                <code
                  key={url}
                  className="rounded-md bg-blue-100 px-2 py-1 text-xs text-blue-900"
                >
                  {url}
                </code>
              ))}
            </div>
          </CardContent>
        </Card>

        <HttpAgentPlayground />

        <div className="pt-2">
          <h2 className="text-xl font-semibold text-gray-900">Run Evaluation</h2>
          <p className="mt-1 text-sm text-gray-500">
            After validating agent behavior, run scenario-based safety tests.
          </p>
        </div>

        <EvaluationWizard scenarios={scenarios} />
      </div>
    </AppLayout>
  );
}
