import type { ResolvedTracerConfig, ThinTraceEvent } from "./models.js";

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * POST event to the ingest API. Never throws; logs errors with console.error.
 */
export async function sendEvent(
  event: ThinTraceEvent,
  config: ResolvedTracerConfig
): Promise<void> {
  if (!config.enabled || !config.apiKey) {
    return;
  }
  const url = `${normalizeBaseUrl(config.baseUrl)}/api/v1/sdk/events`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), config.timeoutSeconds * 1000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(
        `[agent-eval-sdk] HTTP ${res.status} sending event: ${res.statusText}`
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[agent-eval-sdk] send failed: ${msg}`);
  } finally {
    clearTimeout(t);
  }
}
