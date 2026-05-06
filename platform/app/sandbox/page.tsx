import { AppLayout } from "@/components/layout/app-layout";
import { EvaluationWizard } from "@/components/evaluation/evaluation-wizard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, ReportPanel } from "@/components/ui/surface";
import { Info } from "lucide-react";
import { HttpAgentPlayground } from "@/components/sandbox/http-agent-playground";
import { loadScenarioCatalog } from "@/lib/server-scenarios";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const EXAMPLE_URLS = [
  "http://localhost:8000",
  "https://api.example.com/v1",
  "https://your-agent.example.com/chat",
];

export default async function SandboxPage() {
  const { scenarios } = await loadScenarioCatalog();

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader
          eyebrow="Sandbox"
          title="Agent playground"
          description="Validate your HTTP agent response path first, then move directly into scenario-based evaluation."
        />

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

        <ReportPanel
          title="Run an evaluation"
          description="After validating the contract and response path, launch scenario-based testing."
        >
          <EvaluationWizard scenarios={scenarios} />
        </ReportPanel>
      </div>
    </AppLayout>
  );
}
