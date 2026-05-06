import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AblationReportClient } from "@/components/ablation/ablation-report-client";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAuth } from "@/lib/auth";
import { resolveAblationForOrganization } from "@/lib/ablation-service";
import { prisma } from "@/lib/db";
import { ensureOrganizationByClerkId } from "@/lib/org";
import { hasRoleAtLeast, resolveAppRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PageProps {
  params: Promise<{ id: string }> | { id: string };
}

export default async function AblationDetailPage({ params }: PageProps) {
  const { userId, orgId } = getAuth();
  if (!userId) {
    redirect("/");
  }

  const userRole = await resolveAppRole({ userId, orgId });
  if (!hasRoleAtLeast(userRole, "viewer")) {
    redirect("/dashboard");
  }

  if (!orgId) {
    redirect("/dashboard");
  }

  const organization = await ensureOrganizationByClerkId({ clerkId: orgId });
  const resolvedParams = await Promise.resolve(params);
  const ablationId = resolvedParams.id;

  let ablationMeta;
  try {
    ablationMeta = await prisma.ablationRun.findFirst({
      where: {
        id: ablationId,
        project: { organizationId: organization.id },
      },
      select: {
        id: true,
        status: true,
        baselineEvaluationId: true,
        defendedEvaluationId: true,
      },
    });
  } catch {
    notFound();
  }

  if (!ablationMeta) {
    notFound();
  }

  let resolved;
  try {
    resolved = await resolveAblationForOrganization(
      ablationId,
      organization.id
    );
  } catch {
    notFound();
  }

  if (resolved.kind === "not_found") {
    notFound();
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
              Defense ablation
            </h1>
            <p className="mt-2 text-sm text-gray-500">
              Baseline (defenses off) vs defended run — metrics, scenarios, and
              release gate comparison.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/dashboard">
              <Button variant="outline" size="sm">
                Dashboard
              </Button>
            </Link>
          </div>
        </div>

        {resolved.kind === "running" ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">In progress</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-600">
                One or both evaluations are still running. Refresh this page in
                a few seconds.
              </p>
              <div className="flex flex-wrap gap-4 text-sm">
                <Link
                  href={`/dashboard/evaluations/${ablationMeta.baselineEvaluationId}`}
                  className="text-blue-600 hover:underline"
                >
                  Open baseline evaluation
                </Link>
                <Link
                  href={`/dashboard/evaluations/${ablationMeta.defendedEvaluationId}`}
                  className="text-blue-600 hover:underline"
                >
                  Open defended evaluation
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {resolved.kind === "failed" ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg text-red-700">Failed</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-gray-700">{resolved.error}</p>
              <div className="flex flex-wrap gap-4 text-sm">
                <Link
                  href={`/dashboard/evaluations/${ablationMeta.baselineEvaluationId}`}
                  className="text-blue-600 hover:underline"
                >
                  Baseline evaluation
                </Link>
                <Link
                  href={`/dashboard/evaluations/${ablationMeta.defendedEvaluationId}`}
                  className="text-blue-600 hover:underline"
                >
                  Defended evaluation
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {resolved.kind === "completed" ? (
          <AblationReportClient
            diff={resolved.diff}
            baselineEvaluationId={resolved.baselineEvaluationId}
            defendedEvaluationId={resolved.defendedEvaluationId}
          />
        ) : null}
      </div>
    </AppLayout>
  );
}
