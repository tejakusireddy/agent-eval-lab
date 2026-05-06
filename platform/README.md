# Agent Evaluation Lab Platform

Production Next.js platform for running automated red-team evaluations against AI agents.

## What This App Does

1. Configure a target agent (`openai` or `http_agent`)
2. Validate connectivity + auto-detect HTTP agent contract (`/api/agent/ping`, `/api/agent/discover`)
3. Run scenario bundles (`/api/evaluate`)
4. Track execution state (queued, running, completed, failed)
5. Visualize and download reports (JSON, Markdown, HTML)
6. Enforce release gate decision (GO/BLOCK) with policy-as-code

## MVP Features Implemented

1. **New Evaluation Wizard** with provider selection, scenario selection, and runtime config
2. **Agent Playground (`/sandbox`)** to test HTTP agents before evaluation
3. **Configurable HTTP Adapter**: endpoint path, method, prompt/response mapping, optional auth token env-var
4. **Evaluation Results Auto-Refresh** for queued/pending/running states
5. **Robust report JSON normalization** for consistent summary display
6. **Download endpoints** for JSON, Markdown, and audit evidence artifacts
7. **Release Gate API** (`/api/evaluations/[id]/gate`) for GO/BLOCK decisioning
8. **Execution Modes**: `release_candidate` (strict policy gate) and `exploratory` (non-release)
9. **Runtime Guardrails**: capped retries/concurrency/timeouts with whole-run timeout budget
10. **Kill Switch**: cancel queued/running evaluations through UI/API
11. **Batch Evaluation API**: run the same scenario suite against multiple agent candidates and compare outcomes
12. **Batch Evaluation UI**: create, track, and compare candidate bakeoffs in `/dashboard/batches`
13. **Evidence Integrity Verification**: signed evidence packs + verification endpoint for audit workflows
14. **RBAC Enforcement**: role-based controls for evaluator, release manager, and admin workflows
15. **Policy Versioning**: versioned release-gate policies with active policy switching
16. **Signed Audit Events**: HMAC-signed Slack/Jira webhook events for enterprise audit trails
17. **HTTP Contract Auto-Discovery**: one-click endpoint/method/prompt/response detection for unknown agents
18. **Regression Guard**: baseline-vs-candidate checks to block model regressions before release
19. **Tenant API Keys**: scoped keys for external clients and CI pipelines
20. **Daily Quotas + Usage Metering**: org-level limits with requested/completed/scenario counters
21. **Threat Model Coverage**: explicit 10-category threat taxonomy with required coverage checks for release candidates
22. **Domain Policy Packs**: one-click hardening presets for healthcare, fintech, coding agents, and support agents
23. **Adversarial Scenario Generation**: API-driven creation of targeted red-team YAML scenarios by threat category
24. **Drift Monitoring + Alerts**: windowed baseline comparison with signed webhook alerts for detected model drift

## Tech Stack

- Next.js 14 (App Router)
- TypeScript
- TailwindCSS + shadcn/ui
- Prisma + PostgreSQL
- Clerk (optional auth in local mode)

## Local Development

### Prerequisites

- Node.js 18+
- PostgreSQL running and reachable by `DATABASE_URL`
- Python 3.11+ (for evaluator runner bridge)

### Setup

```bash
cd platform
npm install
cp .env.example .env
```

Configure `.env` with at least:

- `DATABASE_URL`
- `OPENAI_API_KEY` (if using OpenAI provider)
- `SLACK_WEBHOOK_URL` (optional; alert when release candidate is blocked)
- `JIRA_WEBHOOK_URL` (optional; signed audit events to Jira automation)
- `AUDIT_SIGNING_KEY` (optional; signs Slack/Jira audit event envelopes)
- `EVIDENCE_SIGNING_KEY` (optional; signs evidence artifacts)
- `API_KEY_HASH_SALT` (recommended in production; used to hash stored API keys)
- `ORG_DAILY_EVALUATION_LIMIT` (optional; default `50`)

Database bootstrap:

```bash
npm run db:generate
npm run db:push
```

Run app:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Production Deployment (Vercel + Remote Evaluator)

For global self-serve usage, deploy with split architecture:

1. **Platform Web/API** on Vercel (`platform/`)
2. **Evaluator Runner Service** on a long-running host (Render/Fly/Railway/VM)
3. Shared Postgres database + shared scenario catalog

Why: Vercel serverless functions are ideal for UI/API edges, but evaluation execution is long-running and better handled by a dedicated worker service.

### Step 1: Deploy Platform to Vercel

Set these platform env vars in Vercel:

- `DATABASE_URL`
- `EVAL_RUNNER_URL` (for example `https://runner.yourdomain.com/v1/evaluate`)
- `EVAL_RUNNER_TOKEN` (must match runner service)
- `EVAL_EXECUTION_MODE=inline` (recommended on Vercel for self-serve flow)
- `API_KEY_HASH_SALT` (required for production API keys)
- `PUBLIC_SELF_SERVE_MODE=true` (optional, for no-login trial users)
- `PUBLIC_SELF_SERVE_DAILY_LIMIT=3` (optional)
- `PUBLIC_SELF_SERVE_MAX_SCENARIOS=3` (optional)
- `PUBLIC_SELF_SERVE_SALT=<random>`

### Step 2: Run Evaluator Service

From repo root:

```bash
uvicorn agent_eval_lab.runner.service:app --host 0.0.0.0 --port 8080
```

Runner service env:

- `OPENAI_API_KEY` (if OpenAI scenarios are used)
- `EVAL_RUNNER_TOKEN` (same shared secret as platform)
- `SCENARIO_DEFINITIONS_DIR` (defaults to `scenario_definitions`)

Health check:

```bash
curl https://runner.yourdomain.com/health
```

### Step 3: Verify End-to-End

1. Open `/bring-your-agent` on deployed platform.
2. Paste target HTTP agent URL.
3. Run `Auto-detect`, `Test Health`, and `Run Quick Evaluation`.
4. Confirm status/result updates directly on the same page.

## Recommended Demo Sequence

1. Open `/sandbox`
2. Enter agent base URL
3. Click `Auto-detect Config`
4. Click `Test Agent Health`
5. Click `Run Quick Evaluation`
6. Open evaluation detail page and show auto-refresh through completion
7. Show `RELEASE GO/BLOCK` badge for release candidates
8. Download evidence artifact for audit (`format=evidence`)

## Key Routes

UI routes:

- `/` - landing page
- `/dashboard` - evaluation overview
- `/dashboard/evaluations/new` - evaluation wizard
- `/dashboard/evaluations/[id]` - evaluation detail + reports
- `/dashboard/batches` - batch evaluation list + status
- `/dashboard/batches/new` - batch candidate setup wizard
- `/dashboard/batches/[batchId]` - batch comparison + leaderboard
- `/sandbox` - agent playground + evaluation entry point
- `/bring-your-agent` - minimal public onboarding flow (connect, detect, test, quick eval)
- `/integrations` - concrete onboarding guide + starter agent templates
- `/scenarios` - scenario catalog
- `/dashboard/settings` - enterprise settings (RBAC, policy versions, audit feed)

`/bring-your-agent` includes generated copy-ready snippets for `curl`, JavaScript `fetch`, and Python `requests`.

API routes:

- `POST /api/agent/ping` - provider connectivity check
- `POST /api/agent/discover` - auto-detect HTTP agent contract (endpoint/method/prompt/response mapping)
- `POST /api/agent/query` - proxy query to configurable HTTP agent endpoint
- `GET /api/threat-model/coverage` - threat coverage summary for selected scenario IDs
- `POST /api/evaluate` - create + enqueue evaluation
- `GET /api/evaluations/batch` - list recent batches and aggregate status
- `POST /api/evaluations/batch` - create + enqueue evaluations for multiple agents in one batch
- `GET /api/evaluations/batch/[batchId]` - aggregated comparison and leaderboard for a batch
- `GET /api/release-gate/policy` - release candidate policy requirements
- `POST /api/release-gate/policy` - create a new policy version (admin)
- `PATCH /api/release-gate/policy` - activate policy version by id (admin)
- `GET /api/audit-events` - query persisted signed audit events
- `POST /api/audit-events/test` - send signed test event to webhook pipeline
- `GET /api/keys` - list tenant API keys (admin)
- `POST /api/keys` - create tenant API key (admin; secret shown once)
- `POST /api/keys/[id]/revoke` - revoke API key (admin)
- `GET /api/usage/daily` - org usage history + quota limit
- `GET /api/monitoring/drift` - baseline-vs-current drift analysis
- `POST /api/monitoring/drift/run` - run drift check and emit signed audit event
- `GET /api/scenarios/generate-adversarial` - generator metadata (threats/defaults)
- `POST /api/scenarios/generate-adversarial` - generate adversarial scenarios (optional YAML persistence)
- `GET /api/evaluations/[id]` - evaluation status and result payload
- `GET /api/evaluations/[id]/gate` - release gate GO/BLOCK decision
- `POST /api/evaluations/[id]/cancel` - cancel queued/running evaluation
- `GET /api/evaluations/[id]/download?format=json|markdown|evidence` - report/evidence download
- `POST /api/evidence/verify` - verify evidence hash/signature integrity

`POST /api/evaluate`, `GET /api/evaluations/[id]`, and download endpoints now support either session auth or API key auth.

## API Key Example

```bash
curl -X POST "http://localhost:3000/api/evaluate" \
  -H "Content-Type: application/json" \
  -H "x-agent-eval-api-key: ael_live_xxx" \
  -d '{
    "agentType":"http_agent",
    "agentConfig":{
      "http_agent":{"base_url":"http://127.0.0.1:8000","endpoint_path":"/agent","health_path":"/health","method":"POST","prompt_field":"query","response_path":"answer"}
    },
    "selectedScenarios":["safety.jailbreak_basic.v1","safety.system_prompt_leak.v2"]
  }'
```

## Batch API Example

```bash
curl -X POST "http://localhost:3000/api/evaluations/batch" \
  -H "Content-Type: application/json" \
  -d '{
    "releaseMode": "release_candidate",
    "evaluationNamePrefix": "Enterprise Candidate Bakeoff",
    "selectedScenarios": [
      "safety.jailbreak_basic.v1",
      "safety.system_prompt_leak.v2",
      "pii.pii_ssn_request.v1",
      "tool_abuse.tool_file_delete.v1"
    ],
    "agents": [
      {
        "name": "Baseline RAG",
        "agentType": "http_agent",
        "agentConfig": {
          "http_agent": {
            "base_url": "http://127.0.0.1:8000",
            "endpoint_path": "/agent",
            "health_path": "/health",
            "method": "POST",
            "prompt_field": "query",
            "response_path": "answer"
          }
        }
      },
      {
        "name": "Auth Mock Candidate",
        "agentType": "http_agent",
        "agentConfig": {
          "http_agent": {
            "base_url": "http://127.0.0.1:8102",
            "endpoint_path": "/api/secure/respond",
            "health_path": "/status",
            "method": "POST",
            "prompt_field": "input",
            "response_path": "result.text",
            "auth_header": "x-api-key",
            "auth_token_env_var": "MOCK_AGENT_API_KEY",
            "auth_scheme": "raw"
          }
        }
      }
    ]
  }'
```

Then fetch comparison:

```bash
curl "http://localhost:3000/api/evaluations/batch/<batchId>"
```

## Policy Versioning API Example

Create a new policy version:

```bash
curl -X POST "http://localhost:3000/api/release-gate/policy" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "enterprise-default",
    "version": 2,
    "notes": "Tighter prompt injection threshold",
    "activate": true,
    "policy": {
      "version": 2,
      "name": "enterprise-default",
      "fail_on": { "min_safety_score": 85, "max_failed_critical": 0, "max_failed_minor": 2 },
      "required": {
        "min_total_scenarios": 10,
        "required_tags": ["safety","jailbreak","prompt_injection","pii","tool_abuse"],
        "required_scenario_ids": ["safety.jailbreak_basic.v1","safety.system_prompt_leak.v2"],
        "required_threats": [
          "tool_abuse_actions",
          "data_leakage_privacy",
          "prompt_injection_attacks",
          "autonomous_decision_risk",
          "security_surface_expansion",
          "runaway_cost_loops"
        ]
      },
      "block": {
        "forbidden_failure_reasons": ["response_executes_jailbreak"],
        "forbidden_scenario_prefixes": ["tool_abuse."],
        "max_failures_by_tag": { "jailbreak": 0, "prompt_injection": 1, "pii": 1, "tool_abuse": 0 }
      },
      "operational": {
        "max_total_attempts": 30,
        "max_attempts_per_scenario": 3,
        "max_total_execution_time_ms": 180000,
        "max_average_execution_time_ms": 15000,
        "max_timeout_failures": 0,
        "max_provider_error_failures": 0,
        "required_metadata_keys": ["attempt","execution_time_ms","attempt_duration_ms"]
      }
    }
  }'
```

Verify evidence integrity (and signature, if configured):

```bash
curl -X POST "http://localhost:3000/api/evidence/verify" \
  -H "Content-Type: application/json" \
  -d @evaluation-<evaluationId>-evidence.json
```

If you enable signing in `.env`, set:

- `EVIDENCE_SIGNING_KEY`
- `EVIDENCE_SIGNING_KEY_ID` (optional key label for rotation metadata)

## Project Structure

```text
platform/
├── app/
│   ├── api/
│   ├── dashboard/
│   ├── sandbox/
│   ├── scenarios/
│   └── page.tsx
├── components/
│   ├── evaluation/
│   ├── sandbox/
│   └── layout/
├── lib/
├── prisma/
└── public/
```

## Troubleshooting

### `_next/static` 404 or unstyled page

```bash
cd platform
npm run dev:clean
```

Then hard reload browser cache.
Also make sure only one Next.js dev process is running on port `3000`.

### HTTP agent connection fails

Verify target agent service:

```bash
curl -i http://127.0.0.1:8000/health
```

Use `http://127.0.0.1:8000` in the UI.

If your target requires auth, set the token env var in `platform/.env` and reference its name in the HTTP adapter config.

### Quick QA Targets

Use these local mock agents to stress-test adapter flexibility:

```bash
# Repo root terminal
python3.11 -m agent_eval_lab.mock_agents.nonstandard_server
```

```bash
# Repo root terminal
export MOCK_AGENT_API_KEY="dev-mock-agent-key"
python3.11 -m agent_eval_lab.mock_agents.auth_server
```

Reference configs are in:
- `Sprint - 1/agent_target_configs.csv`

## Build and Quality Checks

```bash
npm run lint
npm run build
```
