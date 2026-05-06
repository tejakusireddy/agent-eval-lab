import { getAuth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { AppLayout } from "@/components/layout/app-layout";
import { ResultsViewer } from "@/components/evaluation/results-viewer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/evaluation/status-badge";
import { GateBadge } from "@/components/evaluation/gate-badge";
import { EmptyState, MetadataGrid, PageHeader, ReportPanel } from "@/components/ui/surface";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { evaluateGateForEvaluation } from "@/lib/evaluation-gate";
import { formatDateTime, formatFallback, humanizeLabel } from "@/lib/formatting";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function EvaluationResultPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const { userId } = getAuth();
  if (!userId) {
    redirect("/");
  }

  const resolvedParams = await Promise.resolve(params);
  const evaluation = await prisma.evaluation.findUnique({
    where: { id: resolvedParams.id },
  });

  if (!evaluation) {
    return (
      <AppLayout>
        <EmptyState
          title="Evaluation not found"
          description="This evaluation may have been deleted or you may not have access to it."
          action={
            <Link href="/dashboard">
              <Button variant="outline">Back to dashboard</Button>
            </Link>
          }
        />
      </AppLayout>
    );
  }

  const gateResult = await evaluateGateForEvaluation({
    id: evaluation.id,
    projectId: evaluation.projectId,
    status: evaluation.status,
    createdAt: evaluation.createdAt,
    reportJson: evaluation.reportJson,
    config: evaluation.config,
    scenarios: evaluation.scenarios,
  });
  const gateDecision = gateResult.gate;

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Evaluation"
          title={evaluation.name || "Evaluation results"}
          description="Review the release decision, scenario outcomes, and generated artifacts for this run."
          actions={
            <>
              <Link href="/dashboard">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>
              </Link>
              <StatusBadge status={evaluation.status as any} />
              <GateBadge status={gateDecision.status} />
              {evaluation.status === "failed" ? (
                <form action={`/api/evaluations/${evaluation.id}/retry`} method="POST">
                  <Button type="submit" variant="outline" size="sm">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Retry
                  </Button>
                </form>
              ) : null}
            </>
          }
        />

        <MetadataGrid
          columns={4}
          items={[
            { label: "Created", value: formatDateTime(evaluation.createdAt) },
            { label: "Completed", value: formatDateTime(evaluation.completedAt, "Still running") },
            { label: "Policy", value: formatFallback(gateDecision.policyName) },
            { label: "Mode", value: humanizeLabel(gateResult.releaseMode) },
            gateResult.baselineEvaluationId
              ? { label: "Baseline run", value: gateResult.baselineEvaluationId }
              : null,
          ].filter(Boolean) as Array<{ label: string; value: React.ReactNode }>}
        />

        {gateDecision.violations.length > 0 && (
          <ReportPanel
            title="Release gate findings"
            description="These checks contributed to the current release decision."
          >
            <ul className="space-y-2 text-sm text-foreground-muted">
                {gateDecision.violations.slice(0, 8).map((violation) => (
                  <li key={violation}>{violation}</li>
                ))}
              </ul>
          </ReportPanel>
        )}
        <ResultsViewer evaluation={evaluation} />
      </div>
    </AppLayout>
  );
}
