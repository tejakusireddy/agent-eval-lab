# Agent Evaluation Lab Platform

Production SaaS platform for automated AI agent evaluation and red-teaming.

## Tech Stack

- **Next.js 14** (App Router)
- **TypeScript**
- **TailwindCSS** + **shadcn/ui**
- **Clerk** (Authentication)
- **Prisma** + **PostgreSQL**
- **Inngest** (Background Jobs)
- **UploadThing** (File Uploads)

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL
- Python 3.11+ (for CLI integration)
- Docker (optional, for local development)

### Installation

1. **Install dependencies:**

```bash
cd platform
npm install
```

2. **Set up environment variables:**

```bash
cp .env.example .env
# Edit .env with your keys
```

3. **Set up database:**

```bash
# Start PostgreSQL (using Docker)
docker-compose up -d postgres

# Run migrations
npm run db:migrate

# Generate Prisma Client
npm run db:generate
```

4. **Start development server:**

```bash
npm run dev
```

Visit `http://localhost:3000`

## Project Structure

```
platform/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   ├── dashboard/        # Dashboard pages
│   ├── scenarios/        # Scenario marketplace
│   └── page.tsx          # Landing page
├── components/           # React components
├── lib/                  # Utilities
│   ├── db.ts            # Prisma client
│   ├── scenario-loader.ts  # YAML scenario loader
│   └── run-eval.ts      # CLI integration
├── prisma/               # Database schema
└── public/              # Static assets
```

## CLI Integration

The platform integrates with the Python CLI by:

1. Generating config YAML files
2. Executing `python3.11 -m agent_eval_lab.cli.main run-all-scenarios`
3. Capturing stdout/stderr and report files
4. Storing results in the database

See `lib/run-eval.ts` for implementation details.

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection string
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` - Clerk public key
- `CLERK_SECRET_KEY` - Clerk secret key
- `UPLOADTHING_SECRET` - UploadThing secret
- `PYTHON_CLI_PATH` - Path to Python executable (default: `python3.11`)
- `AGENT_EVAL_PATH` - Path to agent_eval_lab directory

## Deployment

1. Set up PostgreSQL database
2. Run migrations: `npm run db:migrate`
3. Deploy to Vercel/Netlify
4. Configure environment variables
5. Set up Inngest for background jobs

## License

See LICENSE file in parent directory.

