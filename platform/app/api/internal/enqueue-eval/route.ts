import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  evaluationId: z.string().min(1),
  config: z.record(z.unknown()),
  scenarioIds: z.array(z.string()),
  scenariosDir: z.string().min(1),
  webhookUrl: z.string().url(),
});

const ENQUEUE_TIMEOUT_MS = 10_000;

/**
 * Server-only route: forwards evaluation jobs to the Python worker bridge (Celery).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = request.headers.get("X-Internal-Enqueue-Secret");
  const expected = process.env.INTERNAL_ENQUEUE_SECRET ?? "";
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const bridgeBase =
    process.env.WORKER_BRIDGE_URL?.replace(/\/$/, "") ??
    "http://localhost:8001";
  const bridgeSecret = process.env.BRIDGE_SECRET ?? "";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ENQUEUE_TIMEOUT_MS);
  try {
    const res = await fetch(`${bridgeBase}/enqueue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bridge-Secret": bridgeSecret,
      },
      body: JSON.stringify({
        evaluation_id: parsed.data.evaluationId,
        config: parsed.data.config,
        scenario_ids: parsed.data.scenarioIds,
        scenarios_dir: parsed.data.scenariosDir,
        webhook_url: parsed.data.webhookUrl,
      }),
      signal: controller.signal,
    });

    const data = (await res.json().catch(() => null)) as {
      task_id?: string;
      detail?: string;
    } | null;

    if (!res.ok || !data?.task_id) {
      return NextResponse.json(
        {
          error: data?.detail ?? "Bridge enqueue failed",
        },
        { status: res.status >= 400 ? res.status : 502 }
      );
    }

    return NextResponse.json({ taskId: data.task_id });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Enqueue failed";
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
