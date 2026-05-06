import { prisma } from "@/lib/db";

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function getDailyEvaluationLimit(): number {
  const fromEnv = Number(process.env.ORG_DAILY_EVALUATION_LIMIT || 50);
  if (!Number.isFinite(fromEnv)) {
    return 50;
  }
  return Math.max(1, Math.floor(fromEnv));
}

export async function getTodayUsage(params: { organizationId: string }) {
  const usageDate = startOfUtcDay(new Date());
  const usage = await prisma.dailyUsage.findUnique({
    where: {
      organizationId_usageDate: {
        organizationId: params.organizationId,
        usageDate,
      },
    },
  });
  return {
    usageDate,
    usage,
  };
}

export async function checkDailyEvaluationQuota(params: {
  organizationId: string;
  limitOverride?: number;
}) {
  const configuredLimit =
    typeof params.limitOverride === "number"
      ? Math.max(1, Math.floor(params.limitOverride))
      : getDailyEvaluationLimit();
  const { usageDate, usage } = await getTodayUsage({ organizationId: params.organizationId });
  const used = usage?.evaluationsRequested || 0;
  return {
    allowed: used < configuredLimit,
    used,
    limit: configuredLimit,
    remaining: Math.max(0, configuredLimit - used),
    usageDate,
  };
}

export async function incrementDailyUsage(params: {
  organizationId: string;
  evaluationsRequestedDelta?: number;
  evaluationsCompletedDelta?: number;
  scenariosRequestedDelta?: number;
}) {
  const usageDate = startOfUtcDay(new Date());
  const evaluationsRequestedDelta = Math.max(0, Math.floor(params.evaluationsRequestedDelta || 0));
  const evaluationsCompletedDelta = Math.max(0, Math.floor(params.evaluationsCompletedDelta || 0));
  const scenariosRequestedDelta = Math.max(0, Math.floor(params.scenariosRequestedDelta || 0));

  return prisma.dailyUsage.upsert({
    where: {
      organizationId_usageDate: {
        organizationId: params.organizationId,
        usageDate,
      },
    },
    create: {
      organizationId: params.organizationId,
      usageDate,
      evaluationsRequested: evaluationsRequestedDelta,
      evaluationsCompleted: evaluationsCompletedDelta,
      scenariosRequested: scenariosRequestedDelta,
    },
    update: {
      evaluationsRequested: { increment: evaluationsRequestedDelta },
      evaluationsCompleted: { increment: evaluationsCompletedDelta },
      scenariosRequested: { increment: scenariosRequestedDelta },
    },
  });
}

export async function listRecentDailyUsage(params: {
  organizationId: string;
  days: number;
}) {
  const days = Math.max(1, Math.min(90, Math.floor(params.days)));
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  from.setUTCDate(from.getUTCDate() - (days - 1));

  return prisma.dailyUsage.findMany({
    where: {
      organizationId: params.organizationId,
      usageDate: {
        gte: from,
      },
    },
    orderBy: { usageDate: "asc" },
  });
}
