# agent-eval-sdk

Thin, optional trace SDK for [AgentEvalLab](https://app.agenteval.dev). Emits structured events to `POST /api/v1/sdk/events`. **Best-effort only**: if the API key is missing or the network fails, your agent keeps running.

## Installation

```bash
pip install agent-eval-sdk
```

(Until published, install from this repo: `pip install ./sdks/python`.)

## Quickstart — 3 lines of code

```python
from agent_eval_sdk import EvalTracer, TracerConfig

tracer = EvalTracer.from_env()  # reads AGENT_EVAL_API_KEY; alias: EvalTracer.fromEnv
run_id = tracer.run_started()
# ... agent runs ...
tracer.run_completed()
```

## Context manager

```python
with EvalTracer.from_env() as tracer:
    # run_started() is called on enter
    tracer.tool_call("search", {"q": "docs"})
# run_completed() or run_failed() on exit
```

## Tool call tracing

```python
tracer.run_started(agent_id="my-bot", scenario_id="safety-001")
span_id = tracer.tool_call("retrieval", {"query": "policy"})
tracer.run_completed(duration_ms=1200, output_preview="...")
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `AGENT_EVAL_API_KEY` | API key (required for outbound events). If unset, the tracer is disabled (no network). |
| `AGENT_EVAL_BASE_URL` | Optional. Default: `https://app.agenteval.dev` |
| `AGENT_EVAL_EVALUATION_ID` | Optional. Links spans to an evaluation run. |

## Async usage

```python
run_id = await tracer.a_run_started()
await tracer.a_tool_call("search", {"q": "docs"})
await tracer.a_run_completed()
```

## Full trace events (Phase 1B)

A **document summarization** agent can emit all eight canonical event types in order: start the run, log the LLM turn, invoke a tool, record the tool outcome, log policy and optional human approval, then finish.

| Step | Python (`EvalTracer`) | TypeScript (`EvalTracer`) |
|------|----------------------|---------------------------|
| 1 | `tracer.run_started(agent_id="summarizer", scenario_id="doc-sum-001", metadata={"doc_id": "Q4-report"})` | `await tracer.runStarted({ agentId: "summarizer", scenarioId: "doc-sum-001", metadata: { doc_id: "Q4-report" } })` |
| 2 | `tracer.model_call(model="gpt-4o", prompt_preview=prompt, response_preview=answer, duration_ms=842, input_tokens=1200, output_tokens=400, metadata={})` | `await tracer.modelCall({ model: "gpt-4o", promptPreview: prompt, responsePreview: answer, durationMs: 842, inputTokens: 1200, outputTokens: 400 })` |
| 3 | `span_id = tracer.tool_call("fetch_document", {"uri": "s3://bucket/report.pdf"})` | `const spanId = await tracer.toolCall({ toolName: "fetch_document", toolInput: { uri: "s3://bucket/report.pdf" } })` |
| 4 | `tracer.tool_result("fetch_document", span_id, success=True, result_preview=text[:2000], duration_ms=95)` | `await tracer.toolResult({ toolName: "fetch_document", spanId, success: true, resultPreview: text.slice(0, 2000), durationMs: 95 })` |
| 5 | `tracer.policy_decision("allow", reason="read-only fetch", policy_id="data-access-v2", resource="report.pdf", span_id=span_id)` | `await tracer.policyDecision({ decision: "allow", reason: "read-only fetch", policyId: "data-access-v2", resource: "report.pdf", spanId })` |
| 6 | `tracer.human_approval(True, approver_id="user_sha1_a1b2", reason="PII section redacted", span_id=span_id, timeout_seconds=300)` | `await tracer.humanApproval({ approved: true, approverId: "user_sha1_a1b2", reason: "PII section redacted", spanId, timeoutSeconds: 300 })` |
| 7 | `tracer.run_completed(duration_ms=2100, output_preview=summary)` | `await tracer.runCompleted({ durationMs: 2100, outputPreview: summary })` |

Use `run_failed` instead of `run_completed` when the run errors. Async Python uses the same sequence with `a_run_started`, `a_model_call`, `a_tool_call`, `a_tool_result`, `a_policy_decision`, `a_human_approval`, and `a_run_completed` / `a_run_failed`.

## What happens if the SDK can't reach the server?

**Nothing.** Your agent keeps running. Events are best-effort; failures are logged to stderr and swallowed.
