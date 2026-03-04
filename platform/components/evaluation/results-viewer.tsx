"use client";

import React, { useState } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SafetyScoreGauge } from "./safety-score-gauge";
import { SeverityBadge } from "./severity-badge";
import { Download, ChevronDown, ChevronRight, Copy, FileText, Code, BarChart3, RefreshCw } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { Charts } from "./charts";
import { normalizeReportJson } from "@/app/_utils/report-json";

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
  };
}

export function ResultsViewer({ evaluation }: ResultsViewerProps) {
  const router = useRouter();
  const { addToast } = useToast();
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState("summary");
  const [activeReportTab, setActiveReportTab] = useState("json");
  const [sortConfig, setSortConfig] = useState<{
    key: string;
    direction: "asc" | "desc";
  } | null>(null);

  const reportJson = (normalizeReportJson(evaluation.reportJson) as any) || {};
  const scenarios = reportJson?.scenarios || [];
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
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(scenarioId)) {
      newExpanded.delete(scenarioId);
    } else {
      newExpanded.add(scenarioId);
    }
    setExpandedRows(newExpanded);
  };

  const handleSort = (key: string) => {
    setSortConfig((prev) => {
      if (prev?.key === key) {
        return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { key, direction: "asc" };
    });
  };

  const sortedScenarios = [...scenarios].sort((a, b) => {
    if (!sortConfig) return 0;

    let aVal: any = a[sortConfig.key];
    let bVal: any = b[sortConfig.key];

    if (sortConfig.key === "severity") {
      const severityOrder = { PASS: 0, FAIL_MINOR: 1, FAIL_CRITICAL: 2 };
      aVal = severityOrder[a.severity as keyof typeof severityOrder] ?? 3;
      bVal = severityOrder[b.severity as keyof typeof severityOrder] ?? 3;
    }

    if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
    if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
    return 0;
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    addToast({
      variant: "success",
      title: "Copied",
      description: "Text copied to clipboard",
    });
  };

  const getSortIcon = (key: string) => {
    if (sortConfig?.key !== key) return null;
    return sortConfig.direction === "asc" ? "↑" : "↓";
  };

  if (isInProgress) {
    const title =
      evaluation.status === "queued"
        ? "Evaluation Queued"
        : evaluation.status === "pending"
        ? "Evaluation Starting"
        : "Evaluation in Progress";

    const description =
      evaluation.status === "queued"
        ? "Your evaluation is waiting for an execution slot. Auto-refreshing every 3 seconds."
        : "Running scenarios... Auto-refreshing every 3 seconds.";

    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center">
          <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-2 border-gray-900 border-t-transparent" />
          <div className="text-lg font-semibold text-gray-900">
            {title}
          </div>
          <div className="mt-2 text-sm text-gray-500">
            {description}
          </div>
          <div className="mt-4">
            <Button variant="outline" size="sm" onClick={() => router.refresh()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh Now
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (evaluation.status === "failed") {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <div className="text-lg font-semibold text-red-600">
            Evaluation Failed
          </div>
          <div className="mt-2 text-sm text-gray-500">
            {evaluation.reportJson?.error || "An error occurred during evaluation"}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="summary">
            <BarChart3 className="mr-2 h-4 w-4" />
            Summary
          </TabsTrigger>
          <TabsTrigger value="scenarios">
            <FileText className="mr-2 h-4 w-4" />
            Scenarios
          </TabsTrigger>
          <TabsTrigger value="reports">
            <Code className="mr-2 h-4 w-4" />
            Reports
          </TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="space-y-6 mt-6">
          <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardContent className="p-6">
            <SafetyScoreGauge score={evaluation.safetyScore || 0} />
            <div className="mt-4 text-center">
              <div className="text-sm font-medium text-gray-500">Safety Score</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Passed</span>
                <Badge variant="success">{summary.passed || 0}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Failed Minor</span>
                <Badge variant="warning">{summary.failed_minor || 0}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Failed Critical</span>
                <Badge variant="destructive">{summary.failed_critical || 0}</Badge>
              </div>
              <div className="flex items-center justify-between border-t border-gray-100 pt-3">
                <span className="text-sm font-medium text-gray-900">Total</span>
                <span className="text-sm font-medium text-gray-900">{summary.total || 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <span className="text-gray-500">Model:</span>{" "}
              <span className="font-medium text-gray-900">
                {reportJson?.model_name || "N/A"}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Created:</span>{" "}
              <span className="font-medium text-gray-900">
                {new Date(evaluation.createdAt).toLocaleString()}
              </span>
            </div>
            {evaluation.completedAt && (
              <div>
                <span className="text-gray-500">Duration:</span>{" "}
                <span className="font-medium text-gray-900">
                  {Math.round(
                    (evaluation.completedAt.getTime() -
                      evaluation.createdAt.getTime()) /
                      1000
                  )}{" "}
                  seconds
                </span>
              </div>
            )}
            <div className="flex gap-2 pt-3 border-t border-gray-100">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  window.open(
                    `/api/evaluations/${evaluation.id}/download?format=json`,
                    "_blank"
                  );
                }}
              >
                <Download className="mr-2 h-4 w-4" />
                JSON
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  window.open(
                    `/api/evaluations/${evaluation.id}/download?format=markdown`,
                    "_blank"
                  );
                }}
              >
                <Download className="mr-2 h-4 w-4" />
                MD
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

          {scenarios.length > 0 && (
            <Charts scenarios={scenarios} summary={summary} />
          )}
        </TabsContent>

        <TabsContent value="scenarios" className="mt-6">
          <Card>
        <CardHeader>
          <CardTitle>Scenario Results</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead
                  className="cursor-pointer hover:text-gray-900"
                  onClick={() => handleSort("severity")}
                >
                  Severity {getSortIcon("severity")}
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:text-gray-900"
                  onClick={() => handleSort("score")}
                >
                  Score {getSortIcon("score")}
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:text-gray-900"
                  onClick={() => handleSort("name")}
                >
                  Scenario {getSortIcon("name")}
                </TableHead>
                <TableHead>Attack Type</TableHead>
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
                          <ChevronDown className="h-4 w-4 text-gray-400" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-gray-400" />
                        )}
                      </TableCell>
                      <TableCell>
                        <SeverityBadge severity={scenario.severity} />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-gray-900">
                          {scenario.score?.toFixed(1) || "N/A"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-gray-900">
                          {scenario.name || scenario.scenario_id}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {scenario.tags?.[0] || "N/A"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={5} className="bg-gray-50">
                          <div className="space-y-4 p-4">
                            {scenario.reasoning && (
                              <div>
                                <div className="mb-2 text-sm font-medium text-gray-900">
                                  Reasoning
                                </div>
                                <div className="rounded-md bg-white p-3 text-sm text-gray-600">
                                  {scenario.reasoning}
                                </div>
                              </div>
                            )}
                            {scenario.failure_reasons &&
                              scenario.failure_reasons.length > 0 && (
                                <div>
                                  <div className="mb-2 text-sm font-medium text-red-600">
                                    Failure Reasons
                                  </div>
                                  <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600">
                                    {scenario.failure_reasons.map(
                                      (reason: string, idx: number) => (
                                        <li key={idx}>{reason}</li>
                                      )
                                    )}
                                  </ul>
                                </div>
                              )}
                            {scenario.response_preview && (
                              <div>
                                <div className="mb-2 flex items-center justify-between">
                                  <div className="text-sm font-medium text-gray-900">
                                    Response Preview
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      copyToClipboard(scenario.response_preview)
                                    }
                                  >
                                    <Copy className="mr-2 h-3 w-3" />
                                    Copy
                                  </Button>
                                </div>
                                <div className="rounded-md bg-white p-3 font-mono text-xs text-gray-600">
                                  {scenario.response_preview}
                                </div>
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="reports" className="mt-6 space-y-4">
          <Tabs value={activeReportTab} onValueChange={setActiveReportTab} className="w-full">
            <TabsList className="grid w-full max-w-2xl grid-cols-3">
              <TabsTrigger value="json">Raw JSON</TabsTrigger>
              <TabsTrigger value="markdown">Markdown Report</TabsTrigger>
              <TabsTrigger value="html">HTML Report</TabsTrigger>
            </TabsList>

            <TabsContent value="json" className="mt-4">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Raw JSON Report</CardTitle>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const blob = new Blob([JSON.stringify(reportJson, null, 2)], {
                          type: "application/json",
                        });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `evaluation-${evaluation.id}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <pre className="max-h-96 overflow-auto rounded-md bg-gray-50 p-4 text-xs">
                    {JSON.stringify(reportJson, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="markdown" className="mt-4">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Markdown Report</CardTitle>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        window.open(
                          `/api/evaluations/${evaluation.id}/download?format=markdown`,
                          "_blank"
                        );
                      }}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="max-h-96 overflow-auto rounded-md bg-gray-50 p-4">
                    <pre className="whitespace-pre-wrap text-xs text-gray-700">
                      {evaluation.reportMarkdown || "No markdown report available"}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="html" className="mt-4">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>HTML Report</CardTitle>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (evaluation.reportHtml) {
                          const blob = new Blob([evaluation.reportHtml], {
                            type: "text/html",
                          });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `evaluation-${evaluation.id}.html`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }
                      }}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border border-gray-200 bg-white">
                    <iframe
                      srcDoc={evaluation.reportHtml || "<p>No HTML report available</p>"}
                      className="h-[600px] w-full rounded-md"
                      title="HTML Report"
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>
    </div>
  );
}
