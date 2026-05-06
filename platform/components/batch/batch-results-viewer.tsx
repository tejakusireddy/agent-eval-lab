"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw, Trophy, Gauge, Timer } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BatchStatusBadge, deriveBatchStatus } from "@/components/batch/batch-status-badge";

interface BatchDetailEvaluation {
  id: string;
  name: string | null;
  status: string;
  safetyScore: number | null;
  createdAt: string;
  completedAt: string | null;
  batch: {
    index: number | null;
    total: number | null;
    agentName: string;
  };
  summary: {
    total: number;
    passed: number;
    failed_minor: number;
    failed_critical: number;
  };
}

interface BatchDetailResponse {
  success: boolean;
  batchId: string;
  aggregate: {
    totalEvaluations: number;
    byStatus: Record<string, number>;
    averageSafetyScore: number | null;
    totalFailedCritical: number;
    totalFailedMinor: number;
  };
  leaderboard: {
    highestSafetyScore: {
      evaluationId: string;
      agentName: string;
      safetyScore: number | null;
    } | null;
    fastestCompletion: {
      id: string;
      agentName: string;
      durationMs: number;
    } | null;
  };
  evaluations: BatchDetailEvaluation[];
}

function statusVariant(status: string): "default" | "success" | "warning" | "destructive" {
  if (status === "completed") return "success";
  if (status === "failed" || status === "cancelled") return "destructive";
  if (status === "queued" || status === "pending" || status === "running") return "warning";
  return "default";
}

function formatDuration(ms: number | null): string {
  if (!ms || ms < 0) {
    return "N/A";
  }
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  if (minutes === 0) {
    return `${remSeconds}s`;
  }
  return `${minutes}m ${remSeconds}s`;
}

export function BatchResultsViewer({ batchId }: { batchId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchDetailResponse | null>(null);

  const fetchBatch = useCallback(async () => {
    try {
      const response = await fetch(`/api/evaluations/batch/${batchId}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as BatchDetailResponse & { error?: string };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to load batch details");
      }
      setBatch(payload);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load batch details");
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    fetchBatch();
  }, [fetchBatch]);

  const hasInProgress = useMemo(() => {
    if (!batch) {
      return false;
    }
    const counts = batch.aggregate.byStatus || {};
    return (counts.running || 0) + (counts.queued || 0) + (counts.pending || 0) > 0;
  }, [batch]);

  useEffect(() => {
    if (!hasInProgress) {
      return;
    }

    const timer = setInterval(fetchBatch, 3000);
    return () => clearInterval(timer);
  }, [fetchBatch, hasInProgress]);

  const batchStatus = useMemo(
    () => deriveBatchStatus(batch?.aggregate.byStatus || {}),
    [batch?.aggregate.byStatus]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900">Batch {batchId}</h1>
          <p className="mt-2 text-sm text-gray-500">
            Side-by-side safety and reliability comparison for release decisions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!loading && !error && <BatchStatusBadge status={batchStatus} />}
          <Button variant="outline" onClick={fetchBatch}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {loading ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-gray-500">Loading batch...</CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-red-600">{error}</CardContent>
        </Card>
      ) : !batch ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-gray-500">No batch data available.</CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardContent className="p-6">
                <div className="text-sm font-medium text-gray-500">Candidates</div>
                <div className="mt-2 text-3xl font-semibold text-gray-900">
                  {batch.aggregate.totalEvaluations}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="text-sm font-medium text-gray-500">Average Safety</div>
                <div className="mt-2 text-3xl font-semibold text-gray-900">
                  {batch.aggregate.averageSafetyScore !== null
                    ? `${batch.aggregate.averageSafetyScore.toFixed(1)}%`
                    : "N/A"}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="text-sm font-medium text-gray-500">Critical Failures</div>
                <div className="mt-2 text-3xl font-semibold text-red-600">
                  {batch.aggregate.totalFailedCritical}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="text-sm font-medium text-gray-500">Minor Failures</div>
                <div className="mt-2 text-3xl font-semibold text-yellow-600">
                  {batch.aggregate.totalFailedMinor}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top Safety Score</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-gray-700">
                {batch.leaderboard.highestSafetyScore ? (
                  <>
                    <div className="flex items-center gap-2 font-medium text-gray-900">
                      <Trophy className="h-4 w-4 text-yellow-600" />
                      {batch.leaderboard.highestSafetyScore.agentName}
                    </div>
                    <div>
                      Score: {batch.leaderboard.highestSafetyScore.safetyScore?.toFixed(1) || "N/A"}%
                    </div>
                    <Link href={`/dashboard/evaluations/${batch.leaderboard.highestSafetyScore.evaluationId}`}>
                      <Button variant="outline" size="sm">Open Evaluation</Button>
                    </Link>
                  </>
                ) : (
                  <div className="text-gray-500">No completed score yet.</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Fastest Completion</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-gray-700">
                {batch.leaderboard.fastestCompletion ? (
                  <>
                    <div className="flex items-center gap-2 font-medium text-gray-900">
                      <Timer className="h-4 w-4 text-blue-600" />
                      {batch.leaderboard.fastestCompletion.agentName}
                    </div>
                    <div>Duration: {formatDuration(batch.leaderboard.fastestCompletion.durationMs)}</div>
                    <Link href={`/dashboard/evaluations/${batch.leaderboard.fastestCompletion.id}`}>
                      <Button variant="outline" size="sm">Open Evaluation</Button>
                    </Link>
                  </>
                ) : (
                  <div className="text-gray-500">No completed duration yet.</div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Candidate Results</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {batch.evaluations.map((evaluation) => {
                  const durationMs =
                    evaluation.completedAt && evaluation.createdAt
                      ? new Date(evaluation.completedAt).getTime() -
                        new Date(evaluation.createdAt).getTime()
                      : null;

                  return (
                    <div
                      key={evaluation.id}
                      className="rounded-lg border border-gray-100 p-4 transition-colors hover:bg-gray-50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">#{(evaluation.batch.index || 0) + 1}</Badge>
                            <div className="font-medium text-gray-900">{evaluation.batch.agentName}</div>
                            <Badge variant={statusVariant(evaluation.status)}>
                              {evaluation.status.toUpperCase()}
                            </Badge>
                          </div>

                          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                            <span className="flex items-center gap-1">
                              <Gauge className="h-3 w-3" />
                              Safety: {typeof evaluation.safetyScore === "number"
                                ? `${evaluation.safetyScore.toFixed(1)}%`
                                : "N/A"}
                            </span>
                            <span>Passed: {evaluation.summary.passed}</span>
                            <span>Minor: {evaluation.summary.failed_minor}</span>
                            <span>Critical: {evaluation.summary.failed_critical}</span>
                            <span>Duration: {formatDuration(durationMs)}</span>
                          </div>
                        </div>

                        <Link href={`/dashboard/evaluations/${evaluation.id}`}>
                          <Button variant="outline" size="sm">Open</Button>
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
