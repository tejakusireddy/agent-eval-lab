"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileCode2,
  FileText,
  RefreshCw,
  Shield,
} from "lucide-react";

import { normalizeReportJson } from "@/app/_utils/report-json";
import { Charts } from "@/components/evaluation/charts";
import { SafetyScoreGauge } from "@/components/evaluation/safety-score-gauge";
import { SeverityBadge } from "@/components/evaluation/severity-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DisclosurePanel,
  EmptyState,
  ErrorState,
  MetadataGrid,
  MetricCard,
  ReportPanel,
} from "@/components/ui/surface";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import {
  formatDateTime,
  formatDurationBetween,
  formatFallback,
  formatInteger,
  formatScore,
  humanizeLabel,
} from "@/lib/formatting";

interface ResultsViewerProps {
  evaluation: {
    id: string;
    name: string | null;
    status: string;
    safetyScore: number | null;
    createdAt: Date;
    completedAt: Date | null;
    reportJson: any;
    reportHtml: string | null;
    reportMarkdown: string | null;
    errorMessage: string | null;
  };
}

export function ResultsViewer({ evaluation }: ResultsViewerProps) {
  const router = useRouter();
  const { addToast } = useToast();
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState("summary");
  const [cancelling, setCancelling] = useState(false);
  const [sortConfig, setSortConfig] = useState<{
    key: string;
    direction: "asc" | "desc";
  } | null>(null);

  const reportJson = useMemo(
    () => (normalizeReportJson(evaluation.reportJson) as any) || {},
    [evaluation.reportJson]
  );
  const scenarios = useMemo(
    () => (Array.isArray(reportJson?.scenarios) ? reportJson.scenarios : []),
    [reportJson]
  );
  const summary = reportJson?.summary || {};
  const inProgressStatuses = new Set(["queued", "pending", "running"]);
  const isInProgress = inProgressStatuses.has(evaluation.status);

  useEffect(() => {
    if (!isInProgress) {
      return;
    }

    const timer = setInterval(() => {
      router.refresh();
    }, 3000);

    return () => clearInterval(timer);
  }, [isInProgress, router]);

  const toggleRow = (scenarioId: string) => {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(scenarioId)) {
        next.delete(scenarioId);
      } else {
        next.add(scenarioId);
      }
      return next;
    });
  };

  const handleSort = (key: string) => {
    setSortConfig((prev) => {
      if (prev?.key === key) {
        return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { key, direction: "asc" };
    });
  };

  const sortedScenarios = useMemo(() => {
    return [...scenarios].sort((a, b) => {
      if (!sortConfig) return 0;

      let aVal: any = a[sortConfig.key];
      let bVal: any = b[sortConfig.key];

      if (sortConfig.key === "severity") {
        const severityOrder = { PASS: 0, FAIL_MINOR: 1, FAIL_CRITICAL: 2 };
        aVal = severityOrder[a.severity as keyof typeof severityOrder] ?? 3;
        bVal = severityOrder[b.severity as keyof typeof severityOrder] ?? 3;
      }

      if (sortConfig.key === "name") {
        aVal = formatFallback(a.name || a.scenario_id, "").toLowerCase();
        bVal = formatFallback(b.name || b.scenario_id, "").toLowerCase();
      }

      if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
  }, [scenarios, sortConfig]);

  const copyToClipboard = async (text: string, label = "Text") => {
    await navigator.clipboard.writeText(text);
    addToast({
      variant: "success",
      title: `${label} copied`,
      description: "Copied to clipboard.",
    });
  };

  const handleCancelEvaluation = async () => {
    setCancelling(true);
    try {
      const response = await fetch(`/api/evaluations/${evaluation.id}/cancel`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || payload?.message || "Failed to cancel evaluation");
      }

      addToast({
        variant: "success",
        title: "Evaluation cancelled",
        description: payload?.message || "The run was cancelled successfully.",
      });
      router.refresh();
    } catch (error: any) {
      addToast({
        variant: "error",
        title: "Cancel failed",
        description: error?.message || "Could not cancel evaluation.",
      });
    } finally {
      setCancelling(false);
    }
  };

  const downloadBlob = (content: string, type: string, filename: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const technicalOverview = [
    {
      label: "Model",
      value: formatFallback(reportJson?.model_name),
    },
    {
      label: "Created",
      value: formatDateTime(evaluation.createdAt),
    },
    {
      label: "Completed",
      value: formatDateTime(evaluation.completedAt, "Still running"),
    },
    {
      label: "Run time",
      value: formatDurationBetween(evaluation.createdAt, evaluation.completedAt),
    },
  ];

  if (isInProgress) {
    const title =
      evaluation.status === "queued"
        ? "Evaluation queued"
        : evaluation.status === "pending"
          ? "Preparing evaluation"
          : "Evaluation in progress";

    const description =
      evaluation.status === "queued"
        ? "This run is waiting for an execution slot. The page refreshes automatically every few seconds."
        : "Scenarios are still running. The page refreshes automatically every few seconds.";

    return (
      <EmptyState
        title={title}
        description={description}
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => router.refresh()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh now
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleCancelEvaluation}
              disabled={cancelling}
            >
              {cancelling ? "Cancelling..." : "Cancel evaluation"}
            </Button>
          </div>
        }
      />
    );
  }

  if (evaluation.status === "cancelled") {
    return (
      <EmptyState
        title="Evaluation cancelled"
        description="This run was manually cancelled before completion."
      />
    );
  }

  if (evaluation.status === "failed") {
    return (
      <ErrorState
        title="Evaluation failed"
        description={evaluation.errorMessage || "An error occurred during evaluation."}
      />
    );
  }

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-xl grid-cols-3">
          <TabsTrigger value="summary">Overview</TabsTrigger>
          <TabsTrigger value="scenarios">Scenario results</TabsTrigger>
          <TabsTrigger value="reports">Artifacts</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <div className="space-y-6">
            <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
              <Card>
                <CardContent className="flex h-full flex-col items-center justify-center">
                  <SafetyScoreGauge score={evaluation.safetyScore || 0} />
                  <div className="mt-4 text-center">
                    <div className="text-sm font-medium text-foreground-muted">Safety score</div>
                    <div className="mt-1 text-sm text-foreground-subtle">
                      Composite result across the executed scenario set
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-4 md:grid-cols-3">
                <MetricCard
                  label="Passed"
                  value={formatInteger(summary.passed || 0)}
                  detail={`${formatInteger(summary.total || 0)} total scenarios`}
                  tone="success"
                />
                <MetricCard
                  label="Minor failures"
                  value={formatInteger(summary.failed_minor || 0)}
                  detail="Recoverable or policy-bound failures"
                  tone="warning"
                />
                <MetricCard
                  label="Critical failures"
                  value={formatInteger(summary.failed_critical || 0)}
                  detail="High-severity failures that require attention"
                  tone="danger"
                />
              </div>
            </div>

            <ReportPanel
              title="Run details"
              description="Core execution metadata and exports for this evaluation."
              actions={
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      window.open(
                        `/api/evaluations/${evaluation.id}/download?format=json`,
                        "_blank"
                      )
                    }
                  >
                    <Download className="mr-2 h-4 w-4" />
                    JSON
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      window.open(
                        `/api/evaluations/${evaluation.id}/download?format=markdown`,
                        "_blank"
                      )
                    }
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Markdown
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      window.open(
                        `/api/evaluations/${evaluation.id}/download?format=evidence`,
                        "_blank"
                      )
                    }
                  >
                    <Shield className="mr-2 h-4 w-4" />
                    Evidence pack
                  </Button>
                </>
              }
            >
              <MetadataGrid items={technicalOverview} columns={4} />
            </ReportPanel>

            {scenarios.length > 0 ? <Charts scenarios={scenarios} summary={summary} /> : null}
          </div>
        </TabsContent>

        <TabsContent value="scenarios">
          <ReportPanel
            title="Scenario results"
            description="Review scenario outcomes, reasoning, and response excerpts."
          >
            {sortedScenarios.length === 0 ? (
              <EmptyState
                title="No scenario results"
                description="This evaluation completed without a scenario breakdown."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12" />
                    <TableHead>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-inherit"
                        onClick={() => handleSort("severity")}
                      >
                        Outcome
                        <ArrowUpDown className="h-3.5 w-3.5" />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-inherit"
                        onClick={() => handleSort("score")}
                      >
                        Score
                        <ArrowUpDown className="h-3.5 w-3.5" />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-inherit"
                        onClick={() => handleSort("name")}
                      >
                        Scenario
                        <ArrowUpDown className="h-3.5 w-3.5" />
                      </button>
                    </TableHead>
                    <TableHead>Category</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedScenarios.map((scenario: any) => {
                    const isExpanded = expandedRows.has(scenario.scenario_id);
                    return (
                      <React.Fragment key={scenario.scenario_id}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => toggleRow(scenario.scenario_id)}
                        >
                          <TableCell>
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-foreground-subtle" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-foreground-subtle" />
                            )}
                          </TableCell>
                          <TableCell>
                            <SeverityBadge severity={scenario.severity} />
                          </TableCell>
                          <TableCell>
                            <div className="font-medium text-foreground">
                              {formatScore(scenario.score, 1)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium text-foreground">
                              {formatFallback(scenario.name || scenario.scenario_id)}
                            </div>
                            <div className="mt-1 text-xs text-foreground-subtle">
                              {scenario.scenario_id}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm text-foreground-muted">
                              {humanizeLabel(formatFallback(scenario.tags?.[0], "General"))}
                            </div>
                          </TableCell>
                        </TableRow>
                        {isExpanded ? (
                          <TableRow>
                            <TableCell colSpan={5} className="bg-panel-muted/40">
                              <div className="grid gap-4 p-2 lg:grid-cols-2">
                                {scenario.reasoning ? (
                                  <div className="rounded-xl border border-border bg-panel p-4">
                                    <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
                                      Reasoning
                                    </div>
                                    <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground-muted">
                                      {scenario.reasoning}
                                    </div>
                                  </div>
                                ) : null}

                                {scenario.failure_reasons?.length > 0 ? (
                                  <div className="rounded-xl border border-border bg-panel p-4">
                                    <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
                                      Failure reasons
                                    </div>
                                    <ul className="mt-3 space-y-2 text-sm leading-6 text-foreground-muted">
                                      {scenario.failure_reasons.map((reason: string, idx: number) => (
                                        <li key={idx}>{reason}</li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : null}

                                {scenario.response_preview ? (
                                  <div className="rounded-xl border border-border bg-panel p-4 lg:col-span-2">
                                    <div className="flex items-center justify-between gap-3">
                                      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
                                        Response excerpt
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          copyToClipboard(scenario.response_preview, "Response excerpt");
                                        }}
                                      >
                                        <Copy className="mr-2 h-3.5 w-3.5" />
                                        Copy
                                      </Button>
                                    </div>
                                    <div className="mt-3 whitespace-pre-wrap rounded-xl bg-panel-muted p-4 font-mono text-xs leading-6 text-foreground-muted">
                                      {scenario.response_preview}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </ReportPanel>
        </TabsContent>

        <TabsContent value="reports">
          <div className="space-y-4">
            <ReportPanel
              title="Generated artifacts"
              description="Use these exports for sharing, evidence review, or deeper technical inspection."
              actions={
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      downloadBlob(
                        JSON.stringify(reportJson, null, 2),
                        "application/json",
                        `evaluation-${evaluation.id}.json`
                      )
                    }
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download JSON
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      window.open(
                        `/api/evaluations/${evaluation.id}/download?format=markdown`,
                        "_blank"
                      )
                    }
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    Download markdown
                  </Button>
                  {evaluation.reportHtml ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        downloadBlob(
                          evaluation.reportHtml || "",
                          "text/html",
                          `evaluation-${evaluation.id}.html`
                        )
                      }
                    >
                      <FileCode2 className="mr-2 h-4 w-4" />
                      Download HTML
                    </Button>
                  ) : null}
                </>
              }
            >
              <MetadataGrid
                columns={3}
                items={[
                  {
                    label: "JSON report",
                    value: scenarios.length > 0 ? `${formatInteger(scenarios.length)} scenarios` : "Available",
                  },
                  {
                    label: "Markdown report",
                    value: evaluation.reportMarkdown ? "Available" : "Not generated",
                  },
                  {
                    label: "HTML report",
                    value: evaluation.reportHtml ? "Available" : "Not generated",
                  },
                ]}
              />
            </ReportPanel>

            <DisclosurePanel
              title="Raw JSON output"
              description="Technical output for debugging, export, and offline analysis."
            >
              <div className="overflow-auto rounded-xl bg-panel-muted p-4">
                <pre className="text-xs leading-6 text-foreground-muted">
                  {JSON.stringify(reportJson, null, 2)}
                </pre>
              </div>
            </DisclosurePanel>

            <DisclosurePanel
              title="Markdown source"
              description="The generated markdown report, preserved for export compatibility."
            >
              <div className="overflow-auto rounded-xl bg-panel-muted p-4">
                <pre className="whitespace-pre-wrap text-xs leading-6 text-foreground-muted">
                  {evaluation.reportMarkdown || "No markdown report available."}
                </pre>
              </div>
            </DisclosurePanel>

            <DisclosurePanel
              title="HTML preview"
              description="The rendered report document used for export and sharing."
            >
              <div className="overflow-hidden rounded-2xl border border-border bg-panel">
                <iframe
                  srcDoc={evaluation.reportHtml || "<p>No HTML report available.</p>"}
                  className="h-[600px] w-full"
                  title="HTML Report"
                />
              </div>
            </DisclosurePanel>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
