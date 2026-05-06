/**
 * DB-backed ablation resolution (poll + diff persistence) for API and dashboard.
 */

import { Prisma } from "@prisma/client";

import {
  AblationDiff,
  AblationDiffSchema,
  computeAblationDiff,
  extractSummaryFromReport,
  parseScenarioResultsFromReport,
} from "@/lib/ablation";
import { prisma } from "@/lib/db";
import { evaluateGateForEvaluation } from "@/lib/evaluation-gate";
import { z } from "zod";

const DefensesArraySchema = z.array(z.string());

const ActiveStatuses = new Set(["queued", "running", "pending"]);

function firstStringError(a: string | null, b: string | null): string {
  const x = (a || "").trim();
  const y = (b || "").trim();
  if (x) return x;
  if (y) return y;
  return "One or more evaluations failed";
}

export type AblationServiceResult =
  | { kind: "not_found" }
  | { kind: "running"; pollIntervalSeconds: number }
  | { kind: "failed"; error: string }
  | {
      kind: "completed";
      ablationId: string;
      baselineEvaluationId: string;
      defendedEvaluationId: string;
      diff: AblationDiff;
      completedAt: string;
      defensesTested: string[];
    };

/**
 * Load ablation for an organization; compute and persist diff when both evaluations completed.
 */
export async function resolveAblationForOrganization(
  ablationId: string,
  organizationId: string
): Promise<AblationServiceResult> {
  const ablation = await prisma.ablationRun.findFirst({
    where: {
      id: ablationId,
      project: { organizationId },
    },
    include: {
      baselineEvaluation: true,
      defendedEvaluation: true,
    },
  });

  if (!ablation) {
    return { kind: "not_found" };
  }

  const base = ablation.baselineEvaluation;
  const def = ablation.defendedEvaluation;

  if (ActiveStatuses.has(base.status) || ActiveStatuses.has(def.status)) {
    return { kind: "running", pollIntervalSeconds: 5 };
  }

  if (base.status === "failed" || def.status === "failed") {
    try {
      await prisma.ablationRun.update({
        where: { id: ablation.id },
        data: { status: "failed" },
      });
    } catch {
      /* best-effort */
    }
    return {
      kind: "failed",
      error: firstStringError(base.errorMessage, def.errorMessage),
    };
  }

  if (base.status !== "completed" || def.status !== "completed") {
    return { kind: "running", pollIntervalSeconds: 5 };
  }

  const defensesParsed = DefensesArraySchema.safeParse(ablation.defenses);
  const defensesTested = defensesParsed.success ? defensesParsed.data : [];

  if (ablation.diffJson !== null && ablation.diffJson !== undefined) {
    const cached = AblationDiffSchema.safeParse(ablation.diffJson);
    if (cached.success) {
      return {
        kind: "completed",
        ablationId: ablation.id,
        baselineEvaluationId: ablation.baselineEvaluationId,
        defendedEvaluationId: ablation.defendedEvaluationId,
        diff: cached.data,
        completedAt:
          ablation.completedAt?.toISOString() ?? new Date().toISOString(),
        defensesTested,
      };
    }
  }

  const baselineGate = await evaluateGateForEvaluation({
    id: base.id,
    projectId: base.projectId,
    status: base.status,
    createdAt: base.createdAt,
    reportJson: base.reportJson,
    config: base.config,
    scenarios: base.scenarios,
  });
  const defendedGate = await evaluateGateForEvaluation({
    id: def.id,
    projectId: def.projectId,
    status: def.status,
    createdAt: def.createdAt,
    reportJson: def.reportJson,
    config: def.config,
    scenarios: def.scenarios,
  });

  const diff = computeAblationDiff(
    ablation.id,
    defensesTested,
    extractSummaryFromReport(base.reportJson),
    extractSummaryFromReport(def.reportJson),
    parseScenarioResultsFromReport(base.reportJson),
    parseScenarioResultsFromReport(def.reportJson),
    baselineGate.gate,
    defendedGate.gate
  );

  const completedAt = new Date();

  try {
    await prisma.ablationRun.update({
      where: { id: ablation.id },
      data: {
        status: "completed",
        diffJson: diff as unknown as Prisma.InputJsonValue,
        completedAt,
      },
    });
  } catch {
    return {
      kind: "completed",
      ablationId: ablation.id,
      baselineEvaluationId: ablation.baselineEvaluationId,
      defendedEvaluationId: ablation.defendedEvaluationId,
      diff,
      completedAt: completedAt.toISOString(),
      defensesTested,
    };
  }

  return {
    kind: "completed",
    ablationId: ablation.id,
    baselineEvaluationId: ablation.baselineEvaluationId,
    defendedEvaluationId: ablation.defendedEvaluationId,
    diff,
    completedAt: completedAt.toISOString(),
    defensesTested,
  };
}
