"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";

import { GateBadge } from "@/components/evaluation/gate-badge";
import { SeverityBadge } from "@/components/evaluation/severity-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DisclosurePanel, MetadataGrid, MetricCard, ReportPanel, SectionHeader } from "@/components/ui/surface";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatListSummary } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import type { AblationDiff, SpanDiff } from "@/lib/ablation";
import type { GateStatus } from "@/lib/release-gate";

type TabKey = "all" | "flipped" | "grader";

function outcomeToSeverity(
  o: SpanDiff["baseline_outcome"]
): "PASS" | "FAIL_MINOR" | "FAIL_CRITICAL" | string {
  if (o === "pass") return "PASS";
  if (o === "fail_minor") return "FAIL_MINOR";
  if (o === "fail_critical") return "FAIL_CRITICAL";
  return "ERROR";
}

function formatDeltaFloat(n: number, suffix = ""): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}${suffix}`;
}

function formatDeltaInt(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n}`;
}

function effectivenessColor(score: number): string {
  if (score > 50) return "text-green-600";
  if (score >= 10) return "text-amber-600";
  return "text-red-600";
}

function gateStatusFromString(s: string): GateStatus {
  if (s === "go" || s === "block" || s === "pending" || s === "unavailable") {
    return s;
  }
  return "unavailable";
}

interface AblationReportClientProps {
  diff: AblationDiff;
  baselineEvaluationId: string;
  defendedEvaluationId: string;
}

export function AblationReportClient({
  diff,
  baselineEvaluationId,
  defendedEvaluationId,
}: AblationReportClientProps) {
  const [tab, setTab] = useState<TabKey>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (tab === "flipped") {
      return diff.span_diffs.filter((s) => s.flipped);
    }
    if (tab === "grader") {
      return diff.span_diffs.filter((s) => s.grader_changed);
    }
    return diff.span_diffs;
  }, [diff.span_diffs, tab]);

  const md = diff.metric_diff;
  const gd = diff.gate_diff;

  return (
    <div className="space-y-8">
      <SectionHeader
        title="Ablation comparison"
        description="Compare the baseline run against the defended run and inspect where the defense improved or changed outcomes."
        actions={
          <>
            <Link
              href={`/dashboard/evaluations/${baselineEvaluationId}`}
              className="text-sm font-medium text-accent hover:text-foreground"
            >
              Baseline run
            </Link>
            <Link
              href={`/dashboard/evaluations/${defendedEvaluationId}`}
              className="text-sm font-medium text-accent hover:text-foreground"
            >
              Defended run
            </Link>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Defense effectiveness"
          value={`${diff.defense_effectiveness_score}%`}
          detail="Failures recovered to pass"
          tone={
            diff.defense_effectiveness_score > 50
              ? "success"
              : diff.defense_effectiveness_score >= 10
                ? "warning"
                : "danger"
          }
        />
        <MetricCard
          label="Safety score delta"
          value={`${formatDeltaFloat(md.safety_score_delta)} pts`}
          detail={`${formatDeltaFloat(md.safety_score_delta_pct, "%")} versus baseline`}
          tone={md.safety_score_delta >= 0 ? "success" : "danger"}
        />
        <MetricCard
          label="Flipped scenarios"
          value={diff.flipped_scenarios.length}
          detail="Scenario outcomes changed with the defense enabled"
        />
        <Card>
          <CardContent className="space-y-4">
            <div className="text-sm font-medium text-foreground-muted">Gate status</div>
            <div className="flex flex-wrap items-center gap-2">
              <GateBadge status={gateStatusFromString(gd.baseline_gate_status)} />
              <GateBadge status={gateStatusFromString(gd.defended_gate_status)} />
            </div>
            <div
              className={cn(
                "text-sm font-medium",
                gd.defense_unblocked
                  ? "text-success"
                  : gd.defense_caused_block
                    ? "text-danger"
                    : "text-foreground-muted"
              )}
            >
              {gd.defense_unblocked
                ? "Defense unblocked release"
                : gd.defense_caused_block
                  ? "Defense caused a release block"
                  : gd.gate_changed
                    ? "Gate decision changed"
                    : "No gate change"}
            </div>
          </CardContent>
        </Card>
      </div>

      <ReportPanel
        title="Metric comparison"
        description="Side-by-side metric summary for the baseline and defended runs."
      >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                <TableHead className="text-right">Baseline</TableHead>
                <TableHead className="text-right">Defended</TableHead>
                <TableHead className="text-right">Delta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Safety score</TableCell>
                <TableCell className="text-right">
                  {md.safety_score_baseline.toFixed(1)}%
                </TableCell>
                <TableCell className="text-right">
                  {md.safety_score_defended.toFixed(1)}%
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-medium",
                    md.safety_score_delta >= 0
                      ? "text-green-600"
                      : "text-red-600"
                  )}
                >
                  {formatDeltaFloat(md.safety_score_delta)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Passed</TableCell>
                <TableCell className="text-right">{md.passed_baseline}</TableCell>
                <TableCell className="text-right">{md.passed_defended}</TableCell>
                <TableCell
                  className={cn(
                    "text-right font-medium",
                    md.passed_delta >= 0 ? "text-green-600" : "text-red-600"
                  )}
                >
                  {formatDeltaInt(md.passed_delta)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Failed minor</TableCell>
                <TableCell className="text-right">
                  {md.failed_minor_baseline}
                </TableCell>
                <TableCell className="text-right">
                  {md.failed_minor_defended}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-medium",
                    md.failed_minor_delta <= 0
                      ? "text-green-600"
                      : "text-red-600"
                  )}
                >
                  {formatDeltaInt(md.failed_minor_delta)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Failed critical</TableCell>
                <TableCell className="text-right">
                  {md.failed_critical_baseline}
                </TableCell>
                <TableCell className="text-right">
                  {md.failed_critical_defended}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-medium",
                    md.failed_critical_delta <= 0
                      ? "text-green-600"
                      : "text-red-600"
                  )}
                >
                  {formatDeltaInt(md.failed_critical_delta)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
      </ReportPanel>

      <ReportPanel
        title="Scenario-level diff"
        description="Inspect where outcomes, grader verdicts, and reasoning changed."
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 pt-2">
            {(
              [
                ["all", "All scenarios"],
                ["flipped", "Flipped only"],
                ["grader", "Grader changes"],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                type="button"
                variant={tab === key ? "default" : "outline"}
                size="sm"
                onClick={() => setTab(key)}
              >
                {label}
              </Button>
            ))}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Scenario</TableHead>
                <TableHead>Baseline</TableHead>
                <TableHead>Defended</TableHead>
                <TableHead>Score Δ</TableHead>
                <TableHead>Flip</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-foreground-muted">
                    No rows for this tab.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const expanded = openId === row.scenario_id;
                  return (
                    <Fragment key={row.scenario_id}>
                      <TableRow>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() =>
                              setOpenId(expanded ? null : row.scenario_id)
                            }
                            aria-expanded={expanded}
                          >
                            {expanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {row.scenario_id}
                        </TableCell>
                        <TableCell>
                          <SeverityBadge
                            severity={outcomeToSeverity(row.baseline_outcome)}
                          />
                        </TableCell>
                        <TableCell>
                          <SeverityBadge
                            severity={outcomeToSeverity(row.defended_outcome)}
                          />
                        </TableCell>
                        <TableCell
                          className={cn(
                            "font-medium",
                            row.score_delta >= 0
                              ? "text-green-600"
                              : "text-red-600"
                          )}
                        >
                          {formatDeltaFloat(row.score_delta)}
                        </TableCell>
                        <TableCell>
                          {row.flipped ? (
                            <Badge variant="secondary">
                              {row.flip_direction.replace(/_/g, " ")}
                            </Badge>
                          ) : (
                            <span className="text-foreground-subtle">No change</span>
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded ? (
                        <TableRow>
                          <TableCell colSpan={6} className="bg-panel-muted/40">
                            <div className="grid gap-4 p-4 md:grid-cols-2">
                              <div>
                                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
                                  Baseline reasoning
                                </div>
                                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground-muted">
                                  {row.baseline_reasoning || "No reasoning captured."}
                                </p>
                              </div>
                              <div>
                                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
                                  Defended reasoning
                                </div>
                                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground-muted">
                                  {row.defended_reasoning || "No reasoning captured."}
                                </p>
                              </div>
                              <div className="md:col-span-2">
                                <DisclosurePanel
                                  title="Technical grader verdicts"
                                  description="Raw grader output for baseline and defended runs."
                                >
                                  <div className="grid gap-3 text-xs md:grid-cols-2">
                                    <div>
                                      <div className="mb-2 font-medium text-foreground">Baseline</div>
                                      <div className="overflow-auto rounded-xl bg-panel-muted p-3">
                                        <pre className="leading-6 text-foreground-muted">
                                          {JSON.stringify(row.baseline_grader_verdicts, null, 2)}
                                        </pre>
                                      </div>
                                    </div>
                                    <div>
                                      <div className="mb-2 font-medium text-foreground">Defended</div>
                                      <div className="overflow-auto rounded-xl bg-panel-muted p-3">
                                        <pre className="leading-6 text-foreground-muted">
                                          {JSON.stringify(row.defended_grader_verdicts, null, 2)}
                                        </pre>
                                      </div>
                                    </div>
                                  </div>
                                </DisclosurePanel>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </ReportPanel>

      <MetadataGrid
        columns={2}
        items={[
          { label: "Computed at", value: formatDateTime(diff.computed_at) },
          { label: "Defenses tested", value: formatListSummary(diff.defenses_tested, "None") },
        ]}
      />
    </div>
  );
}
