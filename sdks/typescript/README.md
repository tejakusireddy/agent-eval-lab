# @agent-eval/sdk

Thin, optional trace SDK for [AgentEvalLab](https://app.agenteval.dev). Sends structured events to `POST /api/v1/sdk/events`. **Best-effort only**: if the API key is missing or the network fails, your agent keeps running.

## Installation

```bash
npm install @agent-eval/sdk
```

(Until published, use `npm install file:../sdks/typescript` from your project.)

## Quickstart — 3 lines of code

```typescript
import { EvalTracer } from "@agent-eval/sdk";

const tracer = EvalTracer.fromEnv();
const runId = await tracer.runStarted();
// ... agent runs ...
await tracer.runCompleted();
```

## try / finally

```typescript
const tracer = EvalTracer.fromEnv();
const runId = await tracer.runStarted();
try {
  await tracer.toolCall({ toolName: "search", toolInput: { q: "docs" } });
  await tracer.runCompleted({ durationMs: 500 });
} catch (e) {
  await tracer.runFailed({
    error: e instanceof Error ? e.message : String(e),
    errorType: e instanceof Error ? e.name : undefined,
  });
}
```

## Tool call tracing

```typescript
await tracer.runStarted({
  agentId: "my-bot",
  scenarioId: "safety-001",
  metadata: { version: "1.0" },
});
const spanId = await tracer.toolCall({
  toolName: "retrieval",
  toolInput: { query: "policy" },
});
await tracer.runCompleted({
  durationMs: 1200,
  outputPreview: longString.slice(0, 500),
});
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `AGENT_EVAL_API_KEY` | API key (required for outbound events). If unset, the tracer is disabled. |
| `AGENT_EVAL_BASE_URL` | Optional. Default: `https://app.agenteval.dev` |
| `AGENT_EVAL_EVALUATION_ID` | Optional. Links spans to an evaluation run. |

## Full trace events (Phase 1B)

A **document summarization** agent can emit all eight canonical event types in order: start the run, log the LLM turn, invoke a tool, record the tool outcome, log policy and optional human approval, then finish.

| Step | TypeScript (`EvalTracer`) | Python (`EvalTracer`) |
|------|---------------------------|----------------------|
| 1 | `await tracer.runStarted({ agentId: "summarizer", scenarioId: "doc-sum-001", metadata: { doc_id: "Q4-report" } })` | `tracer.run_started(agent_id="summarizer", scenario_id="doc-sum-001", metadata={"doc_id": "Q4-report"})` |
| 2 | `await tracer.modelCall({ model: "gpt-4o", promptPreview: prompt, responsePreview: answer, durationMs: 842, inputTokens: 1200, outputTokens: 400 })` | `tracer.model_call(model="gpt-4o", prompt_preview=prompt, response_preview=answer, duration_ms=842, input_tokens=1200, output_tokens=400)` |
| 3 | `const spanId = await tracer.toolCall({ toolName: "fetch_document", toolInput: { uri: "s3://bucket/report.pdf" } })` | `span_id = tracer.tool_call("fetch_document", {"uri": "s3://bucket/report.pdf"})` |
| 4 | `await tracer.toolResult({ toolName: "fetch_document", spanId, success: true, resultPreview: text.slice(0, 2000), durationMs: 95 })` | `tracer.tool_result("fetch_document", span_id, success=True, result_preview=text[:2000], duration_ms=95)` |
| 5 | `await tracer.policyDecision({ decision: "allow", reason: "read-only fetch", policyId: "data-access-v2", resource: "report.pdf", spanId })` | `tracer.policy_decision("allow", reason="read-only fetch", policy_id="data-access-v2", resource="report.pdf", span_id=span_id)` |
| 6 | `await tracer.humanApproval({ approved: true, approverId: "user_sha1_a1b2", reason: "PII section redacted", spanId, timeoutSeconds: 300 })` | `tracer.human_approval(True, approver_id="user_sha1_a1b2", reason="PII section redacted", span_id=span_id, timeout_seconds=300)` |
| 7 | `await tracer.runCompleted({ durationMs: 2100, outputPreview: summary })` | `tracer.run_completed(duration_ms=2100, output_preview=summary)` |

Use `runFailed` / `run_failed` instead of completed when the run errors. On the Python side, the same flow works with `a_run_started`, `a_model_call`, `a_tool_call`, `a_tool_result`, `a_policy_decision`, `a_human_approval`, and `a_run_completed` / `a_run_failed`.

## What happens if the SDK can't reach the server?

**Nothing.** Your agent keeps running. Events are best-effort; failures are logged with `console.error` and never thrown.
