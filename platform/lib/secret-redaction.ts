/**
 * Redact sensitive fields from objects for logging/storage
 */

const SENSITIVE_FIELDS = [
  "api_key",
  "apiKey",
  "apikey",
  "secret",
  "password",
  "token",
  "auth",
  "authorization",
  "openai_api_key",
  "OPENAI_API_KEY",
];

export function redactSecrets(obj: any, depth = 0): any {
  if (depth > 10) return "[MAX_DEPTH]"; // Prevent infinite recursion

  if (obj === null || obj === undefined) return obj;

  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSecrets(item, depth + 1));
  }

  const redacted: any = {};

  for (const [key, value] of Object.entries(obj)) {
    const keyLower = key.toLowerCase();

    // Check if this field should be redacted
    if (SENSITIVE_FIELDS.some((field) => keyLower.includes(field))) {
      redacted[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      redacted[key] = redactSecrets(value, depth + 1);
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

export function sanitizeConfigForStorage(config: any): any {
  const sanitized = { ...config };

  // Remove sensitive fields
  if (sanitized.http_agent) {
    sanitized.http_agent = { ...sanitized.http_agent };
    delete (sanitized.http_agent as any).headers;
    delete (sanitized.http_agent as any).auth;
  }

  // Remove any API keys
  delete (sanitized as any).api_key;
  delete (sanitized as any).apiKey;
  delete (sanitized as any).openai_api_key;

  return sanitized;
}
