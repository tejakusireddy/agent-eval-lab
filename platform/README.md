# Agent Evaluation Lab Platform

Production Next.js platform for running automated red-team evaluations against AI agents.

## What This App Does

1. Configure a target agent (`openai` or `http_agent`)
2. Validate connectivity (`/api/agent/ping`)
3. Run scenario bundles (`/api/evaluate`)
4. Track execution state (queued, running, completed, failed)
5. Visualize and download reports (JSON, Markdown, HTML)

## MVP Features Implemented

1. **New Evaluation Wizard** with provider selection, scenario selection, and runtime config
2. **Agent Playground (`/sandbox`)** to test HTTP agents before evaluation
3. **Evaluation Results Auto-Refresh** for queued/pending/running states
4. **Robust report JSON normalization** for consistent summary display
5. **Download endpoints** for JSON and Markdown report artifacts

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

## Recommended Demo Sequence

1. Open `/sandbox`
2. Test HTTP agent health (`/api/agent/ping`)
3. Send a sample prompt (`/api/agent/query`)
4. Run scenario evaluation
5. Open evaluation detail page and show auto-refresh through completion
6. Download JSON/Markdown/HTML artifacts

## Key Routes

UI routes:

- `/` - landing page
- `/dashboard` - evaluation overview
- `/dashboard/evaluations/new` - evaluation wizard
- `/dashboard/evaluations/[id]` - evaluation detail + reports
- `/sandbox` - agent playground + evaluation entry point
- `/scenarios` - scenario catalog

API routes:

- `POST /api/agent/ping` - provider connectivity check
- `POST /api/agent/query` - proxy query to HTTP agent `/agent`
- `POST /api/evaluate` - create + enqueue evaluation
- `GET /api/evaluations/[id]` - evaluation status and result payload
- `GET /api/evaluations/[id]/download?format=json|markdown` - report download

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
rm -rf .next
npm run dev
```

Then hard reload browser cache.

### HTTP agent connection fails

Verify target agent service:

```bash
curl -i http://127.0.0.1:8000/health
```

Use `http://127.0.0.1:8000` in the UI.

## Build and Quality Checks

```bash
npm run lint
npm run build
```
