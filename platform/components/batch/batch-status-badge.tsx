"use client";

import { Badge } from "@/components/ui/badge";
import { formatStatusLabel } from "@/lib/formatting";

export type BatchStatus = "running" | "completed" | "failed" | "mixed";

export function deriveBatchStatus(statusCounts: Record<string, number>): BatchStatus {
  const running =
    (statusCounts.running || 0) + (statusCounts.queued || 0) + (statusCounts.pending || 0);
  if (running > 0) {
    return "running";
  }

  const total = Object.values(statusCounts).reduce((sum, value) => sum + value, 0);
  const completed = statusCounts.completed || 0;
  const failed = statusCounts.failed || 0;
  const cancelled = statusCounts.cancelled || 0;

  if (total > 0 && completed === total) {
    return "completed";
  }
  if (total > 0 && failed + cancelled === total) {
    return "failed";
  }
  return "mixed";
}

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  if (status === "running") {
    return <Badge variant="info">{formatStatusLabel(status)}</Badge>;
  }
  if (status === "completed") {
    return <Badge variant="success">{formatStatusLabel(status)}</Badge>;
  }
  if (status === "failed") {
    return <Badge variant="destructive">{formatStatusLabel(status)}</Badge>;
  }
  return <Badge variant="warning">{formatStatusLabel(status)}</Badge>;
}
