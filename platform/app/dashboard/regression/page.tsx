import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

import { RegressionSuppressButton } from "@/components/regression/regression-suppress-button";
import { AppLayout } from "@/components/layout/app-layout";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ensureOrganizationByClerkId } from "@/lib/org";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const sec = Math.abs(diffMs / 1000);
  if (sec < 60) {
    return `${Math.round(sec)}s ago`;
  }
  const min = sec / 60;
  if (min < 60) {
    return `${Math.round(min)}m ago`;
  }
  const hr = min / 60;
  if (hr < 48) {
    return `${Math.round(hr)}h ago`;
  }
  const day = hr / 24;
  return `${Math.round(day)}d ago`;
}

function ScenarioResultBadge({
  value,
}: {
  value: string | null;
}): React.ReactElement {
  if (!value) {
    return <span className="text-gray-400">—</span>;
  }
  const styles: Record<string, string> = {
    PASS: "bg-green-50 text-green-800 border-green-200",
    FAIL_MINOR: "bg-amber-50 text-amber-900 border-amber-200",
    FAIL_CRITICAL: "bg-red-50 text-red-800 border-red-200",
  };
  return (
    <Badge
      variant="outline"
      className={styles[value] ?? "bg-gray-50 text-gray-800 border-gray-200"}
    >
      {value}
    </Badge>
  );
}

function StatusBadge({
  status,
}: {
  status: string;
}): React.ReactElement {
  const styles: Record<string, string> = {
    active: "bg-red-50 text-red-800 border-red-200",
    resolved: "bg-green-50 text-green-800 border-green-200",
    suppressed: "bg-gray-100 text-gray-700 border-gray-200",
  };
  return (
    <Badge
      variant="outline"
      className={styles[status] ?? "bg-gray-50 border-gray-200"}
    >
      {status}
    </Badge>
  );
}

export default async function RegressionCorpusPage(): Promise<React.ReactElement> {
  const { userId, orgId } = getAuth();
  if (!userId || !orgId) {
    redirect("/");
  }

  const organization = await ensureOrganizationByClerkId({ clerkId: orgId });

  const entries = await prisma.regressionEntry.findMany({
    where: { project: { organizationId: organization.id } },
    orderBy: { firstFailedAt: "desc" },
    include: { project: { select: { name: true } } },
  });

  const active = entries.filter((e) => e.status === "active");
  const resolved = entries.filter((e) => e.status === "resolved").length;
  const activeCount = active.length;

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            Regression corpus
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Exploits that succeeded against your agent — automatically replayed
            in every evaluation
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Card
            className={
              activeCount > 0
                ? "border-red-200 bg-red-50/50"
                : "border-green-200 bg-green-50/50"
            }
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-700">
                Active exploits
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p
                className={`text-3xl font-semibold ${
                  activeCount > 0 ? "text-red-700" : "text-green-700"
                }`}
              >
                {activeCount}
              </p>
            </CardContent>
          </Card>
          <Card className="border-green-200 bg-green-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-700">
                Resolved
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold text-green-700">
                {resolved}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-700">
                Auto-injected in next eval
              </CardTitle>
              <CardDescription>
                Per-project active scenarios (sum across projects)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold text-gray-900">
                {activeCount}
              </p>
            </CardContent>
          </Card>
        </div>

        {activeCount === 0 ? (
          <Card className="border-green-200 bg-green-50/30">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <CheckCircle2 className="mb-4 h-12 w-12 text-green-600" />
              <p className="text-lg font-medium text-gray-900">
                No active regressions
              </p>
              <p className="mt-2 max-w-md text-sm text-gray-600">
                Your agent has passed all previously-failing scenarios in the
                regression corpus, or no critical failures have been recorded yet.
              </p>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Corpus entries</CardTitle>
            <CardDescription>
              All regression records for your organization (all projects).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scenario ID</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Attack type</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead>First failed</TableHead>
                  <TableHead>Last tested</TableHead>
                  <TableHead>Last result</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => {
                  const tags = Array.isArray(entry.tags)
                    ? entry.tags.filter((t): t is string => typeof t === "string")
                    : [];
                  const showTags = tags.slice(0, 2);
                  return (
                    <TableRow key={entry.id}>
                      <TableCell className="font-mono text-xs">
                        {entry.scenarioId}
                      </TableCell>
                      <TableCell className="text-sm text-gray-700">
                        {entry.project.name}
                      </TableCell>
                      <TableCell>
                        {entry.attackType ? (
                          <Badge variant="secondary">{entry.attackType}</Badge>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[140px] truncate text-xs text-gray-600">
                        {showTags.length > 0 ? showTags.join(", ") : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {formatRelativeTime(entry.firstFailedAt)}
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {entry.lastTestedAt
                          ? formatRelativeTime(entry.lastTestedAt)
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <ScenarioResultBadge value={entry.lastResult} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={entry.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        {entry.status === "active" ? (
                          <RegressionSuppressButton entryId={entry.id} />
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {entries.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500">
                No regression entries yet.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
