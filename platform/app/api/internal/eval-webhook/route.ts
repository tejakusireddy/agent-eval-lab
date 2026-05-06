import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runPostEvaluationHooks } from "@/lib/evaluation-completion";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  evaluationId: z.string().min(1),
});

// TODO(Phase 1): add idempotency, signed payloads, and retry/DLQ when webhook fails;
// today failures are logged in the worker only (Phase 0 acceptable).

/**
 * Internal webhook invoked by the worker bridge after an evaluation row is updated.
 * Runs usage metering and release-gate audit in TypeScript.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = request.headers.get("X-Internal-Webhook-Secret");
  const expected = process.env.INTERNAL_WEBHOOK_SECRET ?? "";
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

  try {
    await runPostEvaluationHooks(parsed.data.evaluationId);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Webhook handler failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
