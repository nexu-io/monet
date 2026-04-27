import { createHash, randomBytes } from "node:crypto";

export function createConnectorOAuthStateSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function hashConnectorOAuthState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}
