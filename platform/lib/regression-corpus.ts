import { existsSync } from "fs";
import { join } from "path";

import { Prisma } from "@prisma/client";

import { loadScenariosFromDirectory } from "@/lib/scenario-loader";
import { prisma } from "@/lib/db";

export interface RegressionEntryShape {
  id: string;
  scenarioId: string;
  evaluationId: string;
  spanId: string | null;
  status: "active" | "resolved" | "suppressed";
  failReasons: string[];
  tags: string[];
  attackType: string | null;
  firstFailedAt: Date;
  lastTestedAt: Date | null;
  lastResult: string | null;
  resolvedAt: Date | null;
  resolvedByEvalId: string | null;
}

function toRegressionShape(row: {
  id: string;
  scenarioId: string;
  evaluationId: string;
  spanId: string | null;
  status: string;
  failReasons: Prisma.JsonValue;
  tags: Prisma.JsonValue;
  attackType: string | null;
  firstFailedAt: Date;
  lastTestedAt: Date | null;
  lastResult: string | null;
  resolvedAt: Date | null;
  resolvedByEvalId: string | null;
}): RegressionEntryShape {
  const failReasons = Array.isArray(row.failReasons)
    ? row.failReasons.filter((x): x is string => typeof x === "string")
    : [];
  const tags = Array.isArray(row.tags)
    ? row.tags.filter((x): x is string => typeof x === "string")
    : [];
  const status = row.status;
  const normalizedStatus: RegressionEntryShape["status"] =
    status === "active" || status === "resolved" || status === "suppressed"
      ? status
      : "active";
  return {
    id: row.id,
    scenarioId: row.scenarioId,
    evaluationId: row.evaluationId,
    spanId: row.spanId,
    status: normalizedStatus,
    failReasons,
    tags,
    attackType: row.attackType,
    firstFailedAt: row.firstFailedAt,
    lastTestedAt: row.lastTestedAt,
    lastResult: row.lastResult,
    resolvedAt: row.resolvedAt,
    resolvedByEvalId: row.resolvedByEvalId,
  };
}

function parseReportJson(reportJson: unknown): Record<string, unknown> | null {
  if (reportJson === null || reportJson === undefined) {
    return null;
  }
  if (typeof reportJson === "string") {
    try {
      return JSON.parse(reportJson) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (typeof reportJson === "object" && !Array.isArray(reportJson)) {
    return reportJson as Record<string, unknown>;
  }
  return null;
}

function scenarioRowsFromReport(
  reportJson: unknown
): Array<Record<string, unknown>> {
  const root = parseReportJson(reportJson);
  if (!root) {
    return [];
  }
  const scenarios = root.scenarios;
  if (!Array.isArray(scenarios)) {
    return [];
  }
  return scenarios.filter(
    (s): s is Record<string, unknown> =>
      s !== null && typeof s === "object" && !Array.isArray(s)
  );
}

function resolveScenariosDirSync(): string | null {
  const possiblePaths = [
    join(process.cwd(), "..", "scenario_definitions"),
    join(process.cwd(), "scenario_definitions"),
    join(process.cwd(), "..", "..", "scenario_definitions"),
  ];
  for (const p of possiblePaths) {
    if (existsSync(p)) {
      return p;
    }
  }
  return null;
}

/**
 * Extract FAIL_CRITICAL scenarios from a completed evaluation and upsert corpus rows.
 */
export async function seedCorpusFromEvaluation(
  projectId: string,
  evaluationId: string,
  reportJson: unknown
): Promise<{ added: number; updated: number }> {
  try {
    const rows = scenarioRowsFromReport(reportJson);
    let added = 0;
    let updated = 0;

    const scenariosDir = resolveScenariosDirSync();
    let definitionsById: Record<string, { tags: string[]; attack_type: string }> =
      {};
    if (scenariosDir) {
      try {
        const defs = await loadScenariosFromDirectory(scenariosDir);
        definitionsById = Object.fromEntries(
          defs.map((d) => [
            d.id,
            { tags: d.tags ?? [], attack_type: d.attack_type ?? "" },
          ])
        );
      } catch {
        definitionsById = {};
      }
    }

    for (const row of rows) {
      const severity =
        typeof row.severity === "string" ? row.severity : "";
      if (severity !== "FAIL_CRITICAL") {
        continue;
      }
      const scenarioId =
        typeof row.scenario_id === "string" ? row.scenario_id : null;
      if (!scenarioId) {
        continue;
      }

      const failRaw = row.failure_reasons;
      const failReasons = Array.isArray(failRaw)
        ? failRaw.filter((x): x is string => typeof x === "string")
        : [];

      const tagsRaw = row.tags;
      const tagsFromReport = Array.isArray(tagsRaw)
        ? tagsRaw.filter((x): x is string => typeof x === "string")
        : [];
      const def = definitionsById[scenarioId];
      const tags =
        tagsFromReport.length > 0 ? tagsFromReport : def?.tags ?? [];
      const attackType =
        def?.attack_type && def.attack_type.length > 0 ? def.attack_type : null;

      const spanId =
        typeof row.metadata === "object" &&
        row.metadata !== null &&
        "span_id" in (row.metadata as object) &&
        typeof (row.metadata as { span_id?: unknown }).span_id === "string"
          ? (row.metadata as { span_id: string }).span_id
          : null;

      const meta =
        typeof row.metadata === "object" && row.metadata !== null
          ? (row.metadata as Prisma.InputJsonValue)
          : undefined;

      const prior = await prisma.regressionEntry.findUnique({
        where: {
          projectId_scenarioId: { projectId, scenarioId },
        },
      });

      const metaPayload =
        meta !== undefined ? meta : Prisma.JsonNull;

      await prisma.regressionEntry.upsert({
        where: {
          projectId_scenarioId: { projectId, scenarioId },
        },
        create: {
          projectId,
          scenarioId,
          evaluationId,
          spanId,
          status: "active",
          failReasons,
          tags,
          attackType,
          lastTestedAt: new Date(),
          lastResult: "FAIL_CRITICAL",
          metadata: metaPayload,
        },
        update: {
          lastTestedAt: new Date(),
          lastResult: "FAIL_CRITICAL",
          failReasons,
          tags,
          attackType: attackType ?? prior?.attackType ?? undefined,
          metadata: metaPayload,
        },
      });

      if (prior) {
        updated += 1;
      } else {
        added += 1;
      }
    }

    return { added, updated };
  } catch (error) {
    console.error("seedCorpusFromEvaluation failed:", error);
    return { added: 0, updated: 0 };
  }
}

/**
 * Update regression rows after an evaluation completes (resolve or refresh last result).
 */
export async function updateCorpusFromEvaluation(
  projectId: string,
  evaluationId: string,
  reportJson: unknown
): Promise<{ resolved: number; still_failing: number }> {
  try {
    const rows = scenarioRowsFromReport(reportJson);
    const byScenarioId = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const sid =
        typeof row.scenario_id === "string" ? row.scenario_id : null;
      if (sid) {
        byScenarioId.set(sid, row);
      }
    }

    const active = await prisma.regressionEntry.findMany({
      where: { projectId, status: "active" },
    });

    let resolved = 0;
    let still_failing = 0;
    const now = new Date();

    for (const entry of active) {
      const scenarioRow = byScenarioId.get(entry.scenarioId);
      if (!scenarioRow) {
        continue;
      }

      const severity =
        typeof scenarioRow.severity === "string" ? scenarioRow.severity : "";

      if (severity === "PASS") {
        await prisma.regressionEntry.update({
          where: { id: entry.id },
          data: {
            status: "resolved",
            resolvedAt: now,
            resolvedByEvalId: evaluationId,
            lastTestedAt: now,
            lastResult: "PASS",
          },
        });
        resolved += 1;
        continue;
      }

      if (severity === "FAIL_MINOR" || severity === "FAIL_CRITICAL") {
        const failRaw = scenarioRow.failure_reasons;
        const failReasons = Array.isArray(failRaw)
          ? failRaw.filter((x): x is string => typeof x === "string")
          : [];
        await prisma.regressionEntry.update({
          where: { id: entry.id },
          data: {
            lastTestedAt: now,
            lastResult: severity,
            failReasons,
          },
        });
        still_failing += 1;
      }
    }

    return { resolved, still_failing };
  } catch (error) {
    console.error("updateCorpusFromEvaluation failed:", error);
    return { resolved: 0, still_failing: 0 };
  }
}

/** Active corpus entries (status === active). */
export async function getActiveCorpus(
  projectId: string
): Promise<RegressionEntryShape[]> {
  try {
    const rows = await prisma.regressionEntry.findMany({
      where: { projectId, status: "active" },
      orderBy: { firstFailedAt: "desc" },
    });
    return rows.map(toRegressionShape);
  } catch (error) {
    console.error("getActiveCorpus failed:", error);
    return [];
  }
}

/** All regression rows for a project (any status), for APIs and dashboards. */
export async function listRegressionEntriesForProject(
  projectId: string
): Promise<RegressionEntryShape[]> {
  try {
    const rows = await prisma.regressionEntry.findMany({
      where: { projectId },
      orderBy: { firstFailedAt: "desc" },
    });
    return rows.map(toRegressionShape);
  } catch (error) {
    console.error("listRegressionEntriesForProject failed:", error);
    return [];
  }
}

/** Aggregate counts and active scenario ids for injection. */
export async function getCorpusSummary(projectId: string): Promise<{
  total: number;
  active: number;
  resolved: number;
  suppressed: number;
  scenario_ids: string[];
}> {
  try {
    const all = await prisma.regressionEntry.findMany({
      where: { projectId },
    });
    const active = all.filter((e) => e.status === "active");
    const resolved = all.filter((e) => e.status === "resolved").length;
    const suppressed = all.filter((e) => e.status === "suppressed").length;
    return {
      total: all.length,
      active: active.length,
      resolved,
      suppressed,
      scenario_ids: active.map((e) => e.scenarioId),
    };
  } catch (error) {
    console.error("getCorpusSummary failed:", error);
    return {
      total: 0,
      active: 0,
      resolved: 0,
      suppressed: 0,
      scenario_ids: [],
    };
  }
}

/** Mark a regression entry suppressed (org-scoped). */
export async function suppressEntry(
  entryId: string,
  projectId: string
): Promise<void> {
  const entry = await prisma.regressionEntry.findFirst({
    where: { id: entryId, projectId },
  });
  if (!entry) {
    throw new Error("Regression entry not found");
  }
  await prisma.regressionEntry.update({
    where: { id: entryId },
    data: { status: "suppressed" },
  });
}

/** Scenario IDs to inject into the next evaluation (active only). */
export async function getCorpusForEvaluation(
  projectId: string
): Promise<string[]> {
  try {
    const rows = await prisma.regressionEntry.findMany({
      where: { projectId, status: "active" },
      select: { scenarioId: true },
    });
    return rows.map((r) => r.scenarioId);
  } catch (error) {
    console.error("getCorpusForEvaluation failed:", error);
    return [];
  }
}

/**
 * Merge user-selected scenarios with corpus, preferring user order then corpus, capped at max.
 */
export function mergeScenariosWithCorpus(
  userScenarioIds: string[],
  corpusScenarioIds: string[],
  max: number
): { allScenarioIds: string[]; corpusInjectedCount: number } {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of userScenarioIds) {
    if (out.length >= max) {
      break;
    }
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  let corpusInjectedCount = 0;
  for (const id of corpusScenarioIds) {
    if (out.length >= max) {
      break;
    }
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
      corpusInjectedCount += 1;
    }
  }
  return { allScenarioIds: out, corpusInjectedCount };
}
