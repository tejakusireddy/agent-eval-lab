import { getAuth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/evaluation/status-badge";
import { Plus, Clock, Calendar, CheckCircle2 } from "lucide-react";
import { EvaluationListSkeleton } from "@/components/evaluation/evaluation-list-skeleton";
import { Suspense } from "react";
import { normalizeReportJson } from "@/app/_utils/report-json";

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

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
              Dashboard
            </h1>
            <p className="mt-2 text-sm text-gray-500">
              Monitor and manage your evaluation projects
            </p>
          </div>
          <Link href="/dashboard/evaluations/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Evaluation
            </Button>
          </Link>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <Card>
            <CardContent className="p-6">
              <div className="text-sm font-medium text-gray-500">Safety Score</div>
              <div className="mt-2 text-3xl font-semibold text-gray-900">
                {avgSafetyScore.toFixed(1)}%
              </div>
              <div className="mt-1 text-xs text-gray-400">
                Last 7 days
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="text-sm font-medium text-gray-500">Critical Failures</div>
              <div className="mt-2 text-3xl font-semibold text-red-600">
                {totalCriticalFailures}
              </div>
              <div className="mt-1 text-xs text-gray-400">
                Across all evaluations
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="text-sm font-medium text-gray-500">Total Evaluations</div>
              <div className="mt-2 text-3xl font-semibold text-gray-900">
                {allEvaluations.length}
              </div>
              <div className="mt-1 text-xs text-gray-400">
                {projects.length} project{projects.length !== 1 ? "s" : ""}
              </div>
            </CardContent>
          </Card>
        </div>

        {recentEvaluations.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <div className="text-lg font-semibold text-gray-900">
                No evaluations yet
              </div>
              <p className="mt-2 text-sm text-gray-500">
                Get started by creating your first evaluation
              </p>
              <Link href="/dashboard/evaluations/new" className="mt-6 inline-block">
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  New Evaluation
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <Card className="shadow-sm">
            <CardContent className="p-0">
              <div className="divide-y divide-gray-100">
                {recentEvaluations.map((evaluation) => (
                  <div
                    key={evaluation.id}
                    className="group p-6 transition-colors hover:bg-gray-50"
                  >
                    <div className="flex items-center justify-between">
                      <Link
                        href={`/dashboard/evaluations/${evaluation.id}`}
                        className="flex items-center gap-4 flex-1"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-3">
                            <div className="font-medium text-gray-900">
                              {evaluation.name || "Untitled Evaluation"}
                            </div>
                            <StatusBadge status={evaluation.status as any} />
                          </div>
                          <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              Created: {new Date(evaluation.createdAt).toLocaleString()}
                            </div>
                            {evaluation.completedAt && (
                              <div className="flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3" />
                                Completed: {new Date(evaluation.completedAt).toLocaleString()}
                              </div>
                            )}
                            {evaluation.status === "running" && (
                              <div className="flex items-center gap-1 text-blue-600">
                                <Clock className="h-3 w-3" />
                                Running...
                              </div>
                            )}
                          </div>
                        </div>
                      </Link>
                      <div className="flex items-center gap-4">
                        {evaluation.safetyScore !== null && (
                          <div className="text-right">
                            <div className="text-xs font-medium text-gray-500">Safety Score</div>
                            <div className="mt-0.5 text-lg font-semibold text-gray-900">
                              {evaluation.safetyScore.toFixed(1)}%
                            </div>
                          </div>
                        )}
                        <Link href={`/dashboard/evaluations/${evaluation.id}`}>
                          <Button variant="outline" size="sm">
                            View
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
