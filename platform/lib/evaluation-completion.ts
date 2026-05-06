import { prisma } from "./db";
import { sendAuditEvent } from "@/lib/alerts";
import { evaluateGateForEvaluation } from "@/lib/evaluation-gate";
import {
  seedCorpusFromEvaluation,
  updateCorpusFromEvaluation,
} from "@/lib/regression-corpus";
import { incrementDailyUsage } from "@/lib/usage-meter";

/**
 * Increment completed-evaluation usage for billing (success, failure, or cancel flows).
 */
export async function incrementEvaluationCompletedUsage(
  organizationId: string | null
): Promise<void> {
  if (!organizationId) {
    return;
  }
  try {
    await incrementDailyUsage({
      organizationId,
      evaluationsCompletedDelta: 1,
    });
  } catch (error) {
    console.error("Daily usage increment failed:", error);
  }
}

/**
 * Release gate audit notification when a release-candidate evaluation is blocked.
 * TODO(Phase 1): consolidate with dashboard polling and add idempotency keys.
 */
async function notifyReleaseBlockIfNeededFromRecord(
  evaluationId: string,
  reportJson: unknown
): Promise<void> {
  const evaluationRecord = await prisma.evaluation.findUnique({
    where: { id: evaluationId },
    include: {
      project: {
        include: {
          organization: true,
        },
      },
    },
  });
  if (!evaluationRecord) {
    return;
  }

  const gateResult = await evaluateGateForEvaluation({
    id: evaluationRecord.id,
    projectId: evaluationRecord.projectId,
    status: evaluationRecord.status,
    createdAt: evaluationRecord.createdAt,
    reportJson: reportJson || evaluationRecord.reportJson,
    config: evaluationRecord.config,
    scenarios: evaluationRecord.scenarios,
  });
  if (gateResult.releaseMode !== "release_candidate") {
    return;
  }
  if (gateResult.gate.status !== "block") {
    return;
  }

  const topViolations = gateResult.gate.violations.slice(0, 5);

  await sendAuditEvent({
    eventType: "release.candidate.blocked",
    severity: "critical",
    title: "Release Candidate Blocked",
    evaluationId,
    organizationId: evaluationRecord.project.organization.clerkId || null,
    lines: [
      `Evaluation ID: ${evaluationId}`,
      `Policy: ${gateResult.gate.policyName || "unknown"} (${gateResult.policyId || "legacy"})`,
      `Safety Score: ${gateResult.gate.metrics.safety_score}%`,
      `Failed Critical: ${gateResult.gate.metrics.failed_critical}`,
      `Failed Minor: ${gateResult.gate.metrics.failed_minor}`,
      `Total Attempts: ${gateResult.gate.metrics.total_attempts}`,
      `Timeout Failures: ${gateResult.gate.metrics.timeout_failures}`,
      `Provider Error Failures: ${gateResult.gate.metrics.provider_error_failures}`,
      gateResult.baselineEvaluationId
        ? `Baseline Evaluation: ${gateResult.baselineEvaluationId}`
        : "Baseline Evaluation: none",
      `Violations: ${topViolations.length > 0 ? topViolations.join(" | ") : "N/A"}`,
    ],
    metadata: {
      release_mode:
        (evaluationRecord.config as { release_mode?: string } | null)
          ?.release_mode || "exploratory",
      policy_id: gateResult.policyId,
      baseline_evaluation_id: gateResult.baselineEvaluationId,
    },
  });
}

/**
 * Runs post-evaluation hooks after the worker has persisted results:
 * usage metering and (on success) release gate audit.
 */
export async function runPostEvaluationHooks(
  evaluationId: string
): Promise<void> {
  const evaluationRecord = await prisma.evaluation.findUnique({
    where: { id: evaluationId },
    include: {
      project: {
        select: { organizationId: true },
      },
    },
  });
  if (!evaluationRecord) {
    return;
  }

  const organizationId = evaluationRecord.project.organizationId;
  await incrementEvaluationCompletedUsage(organizationId);

  if (evaluationRecord.status !== "completed") {
    return;
  }

  await notifyReleaseBlockIfNeededFromRecord(
    evaluationId,
    evaluationRecord.reportJson
  );

  try {
    await seedCorpusFromEvaluation(
      evaluationRecord.projectId,
      evaluationId,
      evaluationRecord.reportJson
    );
    await updateCorpusFromEvaluation(
      evaluationRecord.projectId,
      evaluationId,
      evaluationRecord.reportJson
    );
  } catch (error) {
    console.error("regression corpus update failed:", error);
  }
  // TODO(Phase 2): make corpus seeding transactional with evaluation completion
  // to prevent partial updates.
}
