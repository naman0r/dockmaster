import crypto from "crypto";

const globalForToken = globalThis as unknown as { __dockmasterToken?: string };

// Per-process token so a restart invalidates every old tab at once.
export function getToken(): string {
  if (!globalForToken.__dockmasterToken) {
    globalForToken.__dockmasterToken = crypto.randomBytes(24).toString("base64url");
  }
  return globalForToken.__dockmasterToken;
}
