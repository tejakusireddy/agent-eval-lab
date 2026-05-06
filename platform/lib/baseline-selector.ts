import { prisma } from "@/lib/db";
import { isReleaseCandidate } from "@/lib/release-gate";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toScenarioIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return Array.from(
    new Set(
      raw
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    )
  ).sort();
}

function toScenarioSetKey(raw: unknown): string {
  return toScenarioIdList(raw).join("|");
}

function extractProvider(config: unknown): string | null {
  if (!isRecord(config)) {
    return null;
  }
  const provider = config.provider;
  if (typeof provider !== "string" || provider.trim().length === 0) {
    return null;
  }
  return provider.trim().toLowerCase();
}

export interface BaselineEvaluationSelection {
  id: string;
  createdAt: Date;
  reportJson: unknown;
  safetyScore: number | null;
}

interface BaselineSelectionInput {
  evaluationId: string;
  projectId: string;
  createdAt: Date;
  config: unknown;
  scenarios: unknown;
  requireSameScenarioSet: boolean;
  limit?: number;
}

export async function findBaselineEvaluationForReleaseCandidate(
  input: BaselineSelectionInput
): Promise<BaselineEvaluationSelection | null> {
  const {
    evaluationId,
    projectId,
    createdAt,
    config,
    scenarios,
    requireSameScenarioSet,
    limit = 40,
  } = input;

  const currentProvider = extractProvider(config);
  const currentScenarioSetKey = toScenarioSetKey(scenarios);

  const candidates = await prisma.evaluation.findMany({
    where: {
      projectId,
      status: "completed",
      createdAt: { lt: createdAt },
      NOT: { id: evaluationId },
    },
    select: {
      id: true,
      createdAt: true,
      reportJson: true,
      config: true,
      scenarios: true,
      safetyScore: true,
    },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(100, limit)),
  });

  for (const candidate of candidates) {
    if (!isReleaseCandidate(candidate.config)) {
      continue;
    }

    if (!candidate.reportJson) {
      continue;
    }

    const candidateProvider = extractProvider(candidate.config);
    if (currentProvider && candidateProvider && currentProvider !== candidateProvider) {
      continue;
    }

    if (requireSameScenarioSet) {
      const candidateScenarioSetKey = toScenarioSetKey(candidate.scenarios);
      if (candidateScenarioSetKey !== currentScenarioSetKey) {
        continue;
      }
    }

    return {
      id: candidate.id,
      createdAt: candidate.createdAt,
      reportJson: candidate.reportJson,
      safetyScore: candidate.safetyScore,
    };
  }

  return null;
}
