import { getAuth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { AppLayout } from "@/components/layout/app-layout";
import { ResultsViewer } from "@/components/evaluation/results-viewer";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/evaluation/status-badge";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";

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
        <div className="flex h-96 items-center justify-center">
          <div className="text-center">
            <div className="text-lg font-semibold text-gray-900">
              Evaluation not found
            </div>
            <Link href="/dashboard" className="mt-4 inline-block">
              <Button variant="outline">Back to Dashboard</Button>
            </Link>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
                  {evaluation.name || "Evaluation Results"}
                </h1>
                <StatusBadge status={evaluation.status as any} />
              </div>
              <div className="mt-2 flex items-center gap-4 text-sm text-gray-500">
                <span>Created: {new Date(evaluation.createdAt).toLocaleString()}</span>
                {evaluation.completedAt && (
                  <span>Completed: {new Date(evaluation.completedAt).toLocaleString()}</span>
                )}
              </div>
            </div>
          </div>
          {evaluation.status === "failed" && (
            <form action={`/api/evaluations/${evaluation.id}/retry`} method="POST">
              <Button type="submit" variant="outline" size="sm">
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry
              </Button>
            </form>
          )}
        </div>
        <ResultsViewer evaluation={evaluation} />
      </div>
    </AppLayout>
  );
}
