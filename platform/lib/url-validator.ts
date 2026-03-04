import { URL } from "url";

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateHttpAgentUrl(urlString: string): ValidationResult {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();
    const isDev = process.env.NODE_ENV !== "production";
    const allowLocalhost = process.env.DEV_ALLOW_LOCALHOST === "true" || isDev;
    const allowPrivateIp = process.env.DEV_ALLOW_PRIVATE_IP === "true" || isDev;

    // Reject localhost variants
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname.startsWith("127.")
    ) {
      if (allowLocalhost) {
        return { valid: true };
      }
      return {
        valid: false,
        error: "Localhost URLs are not allowed for security reasons",
      };
    }

    // Reject private IP ranges
    const privateRanges = [
      { start: "10.0.0.0", end: "10.255.255.255" },
      { start: "172.16.0.0", end: "172.31.255.255" },
      { start: "192.168.0.0", end: "192.168.255.255" },
    ];

    // Check if hostname is an IP address
    const ipRegex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipMatch = hostname.match(ipRegex);

    if (ipMatch) {
      const ipParts = ipMatch.slice(1, 5).map(Number);
      const ipNum =
        ipParts[0] * 256 ** 3 +
        ipParts[1] * 256 ** 2 +
        ipParts[2] * 256 +
        ipParts[3];

      for (const range of privateRanges) {
        const [startParts, endParts] = [
          range.start.split(".").map(Number),
          range.end.split(".").map(Number),
        ];
        const startNum =
          startParts[0] * 256 ** 3 +
          startParts[1] * 256 ** 2 +
          startParts[2] * 256 +
          startParts[3];
        const endNum =
          endParts[0] * 256 ** 3 +
          endParts[1] * 256 ** 2 +
          endParts[2] * 256 +
          endParts[3];

        if (ipNum >= startNum && ipNum <= endNum) {
          if (allowPrivateIp) {
            return { valid: true };
          }
          return {
            valid: false,
            error: "Private IP ranges are not allowed for security reasons",
          };
        }
      }
    }

    // Enforce HTTPS unless DEV_ALLOW_HTTP is set
    const allowHttp = process.env.DEV_ALLOW_HTTP === "true";
    if (url.protocol !== "https:" && !allowHttp) {
      return {
        valid: false,
        error: "Only HTTPS URLs are allowed (set DEV_ALLOW_HTTP=true for development)",
      };
    }

    return { valid: true };
  } catch (error: any) {
    return {
      valid: false,
      error: `Invalid URL: ${error.message}`,
    };
  }
}
