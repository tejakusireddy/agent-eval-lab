import { getAuth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/evaluation/status-badge";
import { GateBadge } from "@/components/evaluation/gate-badge";
import { Plus, Clock, Calendar, CheckCircle2, Code, Settings } from "lucide-react";
import { normalizeReportJson } from "@/app/_utils/report-json";
import { evaluateGateForEvaluation } from "@/lib/evaluation-gate";
import { EmptyState, MetricCard, PageHeader, ReportPanel, SectionHeader } from "@/components/ui/surface";
import { formatDateTime, formatInteger, formatScore } from "@/lib/formatting";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function DashboardPage() {
  const { userId, orgId } = getAuth();

  if (!userId) {
    redirect("/");
  }

  let organization;
  try {
    if (orgId) {
      organization = await prisma.organization.findUnique({
        where: { clerkId: orgId },
        include: {
          projects: {
            include: {
              evaluations: {
                orderBy: { createdAt: "desc" },
                take: 10,
              },
            },
          },
        },
      });
    }
  } catch (error: any) {
    console.error("Database error in dashboard:", error);
    // Continue with empty organization - show empty state
    organization = null;
  }

  const projects = organization?.projects || [];
  const allEvaluations = projects.flatMap((p) =>
    p.evaluations.map((e) => ({ ...e, projectName: p.name }))
  );

  const recentEvaluations = allEvaluations
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 10);

  const last7Days = new Date();
  last7Days.setDate(last7Days.getDate() - 7);

  const recentEvaluations7Days = allEvaluations.filter(
    (e) => e.createdAt >= last7Days && e.safetyScore !== null
  );

  const avgSafetyScore =
    recentEvaluations7Days.length > 0
      ? recentEvaluations7Days.reduce((sum, e) => sum + (e.safetyScore || 0), 0) /
        recentEvaluations7Days.length
      : 0;

  const totalCriticalFailures = allEvaluations.reduce((sum, e) => {
    const reportJson = normalizeReportJson(e.reportJson);
    if (reportJson && typeof reportJson === "object") {
      const summary = (reportJson as any).summary;
      return sum + (summary?.failed_critical || 0);
    }
    return sum;
  }, 0);

  const gateEntries = await Promise.all(
    recentEvaluations.map(async (evaluation) => {
      const result = await evaluateGateForEvaluation({
        id: evaluation.id,
        projectId: evaluation.projectId,
        status: evaluation.status,
        createdAt: evaluation.createdAt,
        reportJson: evaluation.reportJson,
        config: evaluation.config,
        scenarios: evaluation.scenarios,
      });
      return [evaluation.id, result.gate] as const;
    })
  );
  const gateByEvaluationId = new Map(gateEntries);

  return (
    <AppLayout initialEvaluationCountZero={allEvaluations.length === 0}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Workspace"
          title="Dashboard"
          description="Monitor evaluation health, release posture, and recent activity across your projects."
          actions={
            <Link href="/dashboard/evaluations/new">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                New evaluation
              </Button>
            </Link>
          }
        />

        <div className="grid gap-6 md:grid-cols-3">
          <MetricCard
            label="Average safety score"
            value={formatScore(avgSafetyScore)}
            detail="Across completed runs in the last seven days"
          />
          <MetricCard
            label="Critical failures"
            value={formatInteger(totalCriticalFailures)}
            detail="Across the current evaluation history"
            tone="danger"
          />
          <MetricCard
            label="Total evaluations"
            value={formatInteger(allEvaluations.length)}
            detail={`${projects.length} project${projects.length !== 1 ? "s" : ""}`}
          />
        </div>

        {recentEvaluations.length === 0 ? (
          <div className="grid gap-6 md:grid-cols-2">
            <EmptyState
              title="Connect an agent and run your first evaluation"
              description="Start with the guided HTTP onboarding flow if you want the fastest path from endpoint to first result."
              action={
                <Link href="/dashboard/onboarding">
                  <Button>
                    <Code className="mr-2 h-4 w-4" />
                    Start onboarding
                  </Button>
                </Link>
              }
            />
            <EmptyState
              title="Need full control?"
              description="Launch the full evaluation wizard for manual scenario selection, policy setup, and advanced configuration."
              action={
                <Link href="/dashboard/evaluations/new">
                  <Button variant="outline">
                    <Settings className="mr-2 h-4 w-4" />
                    Open evaluation wizard
                  </Button>
                </Link>
              }
            />
          </div>
        ) : (
          <ReportPanel
            title="Recent evaluations"
            description="Latest evaluation activity across your projects."
          >
            <Card variant="ghost" className="shadow-none">
            <CardContent className="p-0">
              <div className="divide-y divide-gray-100">
                {recentEvaluations.map((evaluation) => {
                  const gateDecision = gateByEvaluationId.get(evaluation.id);
                  return (
                  <div
                    key={evaluation.id}
                    className="group rounded-2xl p-5 transition-colors hover:bg-panel-muted/50"
                  >
                    <div className="flex items-center justify-between">
                      <Link
                        href={`/dashboard/evaluations/${evaluation.id}`}
                        className="flex items-center gap-4 flex-1"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-3">
                            <div className="font-medium text-foreground">
                              {evaluation.name || "Untitled Evaluation"}
                            </div>
                            <StatusBadge status={evaluation.status as any} />
                            <GateBadge status={gateDecision?.status || "unavailable"} />
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-foreground-muted">
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5" />
                              {formatDateTime(evaluation.createdAt)}
                            </div>
                            {evaluation.completedAt && (
                              <div className="flex items-center gap-1">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Completed {formatDateTime(evaluation.completedAt)}
                              </div>
                            )}
                            {evaluation.status === "running" && (
                              <div className="flex items-center gap-1 text-accent">
                                <Clock className="h-3.5 w-3.5" />
                                In progress
                              </div>
                            )}
                          </div>
                        </div>
                      </Link>
                      <div className="flex items-center gap-4">
                        {evaluation.safetyScore !== null && (
                          <div className="text-right">
                            <div className="text-xs font-medium uppercase tracking-[0.08em] text-foreground-subtle">
                              Safety score
                            </div>
                            <div className="mt-1 text-xl font-semibold text-foreground">
                              {formatScore(evaluation.safetyScore)}
                            </div>
                          </div>
                        )}
                        <Link href={`/dashboard/evaluations/${evaluation.id}`}>
                          <Button variant="outline" size="sm">
                            View run
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
          </ReportPanel>
        )}
      </div>
    </AppLayout>
  );
}
