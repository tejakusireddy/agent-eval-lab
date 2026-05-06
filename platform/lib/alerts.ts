import { createHash, createHmac, randomUUID } from "crypto";

import { prisma } from "@/lib/db";

type AuditSeverity = "info" | "warning" | "critical";

type DeliveryChannel = "slack" | "jira";

interface AuditEventPayload {
  eventType: string;
  severity: AuditSeverity;
  title: string;
  lines: string[];
  metadata?: Record<string, unknown>;
  actorUserId?: string | null;
  organizationId?: string | null;
  evaluationId?: string | null;
}

interface SignedAuditEnvelope {
  schema_version: "1.0";
  event_id: string;
  source: "agent-eval-lab";
  event_type: string;
  severity: AuditSeverity;
  title: string;
  lines: string[];
  metadata: Record<string, unknown>;
  occurred_at: string;
  actor_user_id: string | null;
  organization_id: string | null;
  evaluation_id: string | null;
  payload_sha256: string;
  signature: {
    algorithm: "hmac-sha256";
    key_id: string | null;
    value: string;
  } | null;
}

interface SlackAlertPayload {
  title: string;
  lines: string[];
}

interface DeliveryResult {
  channel: DeliveryChannel;
  delivered: boolean;
  statusCode: number | null;
  error: string | null;
  deliveredAt: string;
}

function toSigningKeyConfig(): { key: string | null; keyId: string | null } {
  const key = process.env.AUDIT_SIGNING_KEY || null;
  const keyId = process.env.AUDIT_SIGNING_KEY_ID || null;
  return { key, keyId };
}

function buildSignedEnvelope(payload: AuditEventPayload): SignedAuditEnvelope {
  const baseEvent = {
    schema_version: "1.0" as const,
    event_id: randomUUID(),
    source: "agent-eval-lab" as const,
    event_type: payload.eventType,
    severity: payload.severity,
    title: payload.title,
    lines: payload.lines,
    metadata: payload.metadata || {},
    occurred_at: new Date().toISOString(),
    actor_user_id: payload.actorUserId || null,
    organization_id: payload.organizationId || null,
    evaluation_id: payload.evaluationId || null,
  };

  const canonical = JSON.stringify(baseEvent);
  const payloadSha = createHash("sha256").update(canonical).digest("hex");

  const signing = toSigningKeyConfig();
  const signature =
    signing.key
      ? {
          algorithm: "hmac-sha256" as const,
          key_id: signing.keyId,
          value: createHmac("sha256", signing.key).update(canonical).digest("hex"),
        }
      : null;

  return {
    ...baseEvent,
    payload_sha256: payloadSha,
    signature,
  };
}

async function postWebhook(
  url: string,
  body: unknown,
  envelope: SignedAuditEnvelope,
  channel: DeliveryChannel
): Promise<DeliveryResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Agent-Eval-Event-Id": envelope.event_id,
    "X-Agent-Eval-Payload-SHA256": envelope.payload_sha256,
  };

  if (envelope.signature) {
    headers["X-Agent-Eval-Signature"] = envelope.signature.value;
    headers["X-Agent-Eval-Key-Id"] = envelope.signature.key_id || "default";
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    return {
      channel,
      delivered: response.ok,
      statusCode: response.status,
      error: response.ok ? null : `HTTP ${response.status}`,
      deliveredAt: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error(`Failed to send ${channel} audit event:`, error);
    return {
      channel,
      delivered: false,
      statusCode: null,
      error: error?.message || "webhook delivery failed",
      deliveredAt: new Date().toISOString(),
    };
  }
}

function toSlackText(envelope: SignedAuditEnvelope): string {
  const signatureText = envelope.signature
    ? `${envelope.signature.algorithm}:${envelope.signature.value.slice(0, 12)}...`
    : "unsigned";

  const lines: string[] = [
    envelope.title,
    ...envelope.lines,
    `Event: ${envelope.event_type}`,
    `Severity: ${envelope.severity}`,
    `Event ID: ${envelope.event_id}`,
    `Payload SHA256: ${envelope.payload_sha256}`,
    `Signature: ${signatureText}`,
  ];

  return lines.join("\n");
}

async function persistAuditEvent(
  envelope: SignedAuditEnvelope,
  deliveries: DeliveryResult[]
): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        eventId: envelope.event_id,
        eventType: envelope.event_type,
        severity: envelope.severity,
        title: envelope.title,
        lines: envelope.lines as any,
        metadata: envelope.metadata as any,
        actorUserId: envelope.actor_user_id,
        organizationId: envelope.organization_id,
        evaluationId: envelope.evaluation_id,
        payloadSha256: envelope.payload_sha256,
        signatureAlgorithm: envelope.signature?.algorithm || null,
        signatureKeyId: envelope.signature?.key_id || null,
        signatureValue: envelope.signature?.value || null,
        deliveryStatus: {
          attempted_channels: deliveries.map((entry) => entry.channel),
          deliveries,
        } as any,
      },
    });
  } catch (error: any) {
    console.error(
      "Failed to persist audit event (run `npm run db:push` if schema is behind):",
      error?.message || error
    );
  }
}

export async function sendAuditEvent(payload: AuditEventPayload): Promise<void> {
  const envelope = buildSignedEnvelope(payload);

  const slackWebhook = process.env.SLACK_WEBHOOK_URL;
  const jiraWebhook = process.env.JIRA_WEBHOOK_URL;

  const tasks: Promise<DeliveryResult>[] = [];

  if (slackWebhook) {
    tasks.push(
      postWebhook(
        slackWebhook,
        {
          text: toSlackText(envelope),
          audit_event: envelope,
        },
        envelope,
        "slack"
      )
    );
  }

  if (jiraWebhook) {
    tasks.push(
      postWebhook(
        jiraWebhook,
        {
          audit_event: envelope,
        },
        envelope,
        "jira"
      )
    );
  }

  const deliveries = await Promise.all(tasks);
  await persistAuditEvent(envelope, deliveries);
}

export async function sendSlackAlert(payload: SlackAlertPayload): Promise<void> {
  await sendAuditEvent({
    eventType: "platform.notification",
    severity: "info",
    title: payload.title,
    lines: payload.lines,
  });
}
