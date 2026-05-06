"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Plus, Calendar, Layers } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BatchStatusBadge, deriveBatchStatus } from "@/components/batch/batch-status-badge";

interface BatchSummary {
  batchId: string;
  createdAt: string;
  updatedAt: string;
  totalEvaluations: number;
  statusCounts: Record<string, number>;
  averageSafetyScore: number | null;
  releaseMode: "exploratory" | "release_candidate";
  project: { id: string; name: string };
  agentNames: string[];
}

interface BatchListResponse {
  success: boolean;
  totalBatches: number;
  batches: BatchSummary[];
}

export function BatchList() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchSummary[]>([]);

  const hasInProgress = useMemo(
    () =>
      batches.some((batch) =>
        ["running", "queued", "pending"].some(
          (status) => Number(batch.statusCounts[status] || 0) > 0
        )
      ),
    [batches]
  );

  const fetchBatches = async () => {
    try {
      const response = await fetch("/api/evaluations/batch", {
        cache: "no-store",
      });
      const payload = (await response.json()) as BatchListResponse & { error?: string };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to load batch evaluations");
      }
      setBatches(payload.batches || []);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load batches");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBatches();
  }, []);

  useEffect(() => {
    if (!hasInProgress) {
      return;
    }
    const timer = setInterval(fetchBatches, 3000);
    return () => clearInterval(timer);
  }, [hasInProgress]);

  const avgAcrossBatches = useMemo(() => {
    const values = batches
      .map((batch) => batch.averageSafetyScore)
      .filter((value): value is number => typeof value === "number");
    if (values.length === 0) {
      return null;
    }
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
  }, [batches]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
            Batch Evaluations
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Run candidate bakeoffs and compare safety outcomes side-by-side.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={fetchBatches}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Link href="/dashboard/batches/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Batch
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-6">
            <div className="text-sm font-medium text-gray-500">Total Batches</div>
            <div className="mt-2 text-3xl font-semibold text-gray-900">{batches.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="text-sm font-medium text-gray-500">Avg Safety Score</div>
            <div className="mt-2 text-3xl font-semibold text-gray-900">
              {avgAcrossBatches !== null ? `${avgAcrossBatches.toFixed(1)}%` : "N/A"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="text-sm font-medium text-gray-500">Batches In Progress</div>
            <div className="mt-2 text-3xl font-semibold text-blue-600">
              {
                batches.filter((batch) =>
                  ["running", "queued", "pending"].some(
                    (status) => Number(batch.statusCounts[status] || 0) > 0
                  )
                ).length
              }
            </div>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-gray-500">
            Loading batches...
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-red-600">{error}</CardContent>
        </Card>
      ) : batches.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Layers className="mx-auto h-8 w-8 text-gray-400" />
            <div className="mt-3 text-lg font-semibold text-gray-900">No batch runs yet</div>
            <div className="mt-1 text-sm text-gray-500">
              Create a batch to compare multiple agents on the same scenario set.
            </div>
            <Link href="/dashboard/batches/new" className="mt-5 inline-block">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Create First Batch
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Recent Batches</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {batches.map((batch) => {
              const batchStatus = deriveBatchStatus(batch.statusCounts);
              return (
                <div
                  key={batch.batchId}
                  className="rounded-lg border border-gray-100 p-4 transition-colors hover:bg-gray-50"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium text-gray-900">{batch.batchId}</div>
                        <BatchStatusBadge status={batchStatus} />
                        <Badge variant="secondary">
                          {batch.releaseMode === "release_candidate"
                            ? "release_candidate"
                            : "exploratory"}
                        </Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Created: {new Date(batch.createdAt).toLocaleString()}
                        </span>
                        <span>Project: {batch.project.name}</span>
                        <span>Agents: {batch.totalEvaluations}</span>
                        <span>
                          Avg Safety:{" "}
                          {batch.averageSafetyScore !== null
                            ? `${batch.averageSafetyScore.toFixed(1)}%`
                            : "N/A"}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {batch.agentNames.slice(0, 4).map((agentName) => (
                          <Badge key={agentName} variant="outline">
                            {agentName}
                          </Badge>
                        ))}
                        {batch.agentNames.length > 4 && (
                          <Badge variant="outline">+{batch.agentNames.length - 4} more</Badge>
                        )}
                      </div>
                    </div>
                    <Link href={`/dashboard/batches/${batch.batchId}`}>
                      <Button variant="outline" size="sm">
                        Open
                      </Button>
                    </Link>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
