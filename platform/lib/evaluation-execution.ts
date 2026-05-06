export type EvaluationExecutionMode = "queue" | "inline";

export function getEvaluationExecutionMode(): EvaluationExecutionMode {
  const raw = (process.env.EVAL_EXECUTION_MODE || "queue").trim().toLowerCase();
  if (raw === "inline") {
    return "inline";
  }
  return "queue";
}

export function isInlineEvaluationExecution(): boolean {
  return getEvaluationExecutionMode() === "inline";
}
