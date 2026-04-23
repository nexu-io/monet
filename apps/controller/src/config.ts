import { resolve } from "node:path";

const defaultControllerPort = 3030;
const defaultControllerHost = "127.0.0.1";
const defaultDatabasePath = resolve(process.cwd(), "sqlite", "monet.db");
const defaultAllowedOrigins = ["null", "app://monet"] as const;

export interface ControllerConfig {
  readonly allowedOrigins: readonly string[];
  readonly bearerToken: string;
  readonly host: string;
  readonly port: number;
  readonly databasePath: string;
}

export function createControllerConfig(env: NodeJS.ProcessEnv = process.env): ControllerConfig {
  const bearerToken = env.MONET_CONTROLLER_BEARER_TOKEN?.trim();

  if (!bearerToken) {
    throw new Error("MONET_CONTROLLER_BEARER_TOKEN is required to start the controller.");
  }

  const host = parseHost(env.MONET_CONTROLLER_HOST);

  return {
    allowedOrigins: parseAllowedOrigins(env),
    bearerToken,
    host,
    port: parsePort(env.MONET_CONTROLLER_PORT),
    databasePath: env.MONET_DATABASE_PATH?.trim() || defaultDatabasePath
  };
}

function parseAllowedOrigins(env: NodeJS.ProcessEnv): readonly string[] {
  const configuredOrigins = env.MONET_CONTROLLER_ALLOWED_ORIGINS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const rendererOrigin = parseOrigin(env.MONET_DESKTOP_RENDERER_URL);

  return Array.from(new Set([...defaultAllowedOrigins, ...(configuredOrigins ?? []), ...(rendererOrigin ? [rendererOrigin] : [])]));
}

function parseHost(value: string | undefined): string {
  const host = value?.trim() || defaultControllerHost;

  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`MONET_CONTROLLER_HOST must bind to loopback only, received: ${host}`);
  }

  return host;
}

function parsePort(value: string | undefined): number {
  if (!value) {
    return defaultControllerPort;
  }

  const port = Number.parseInt(value, 10);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`MONET_CONTROLLER_PORT must be a valid TCP port, received: ${value}`);
  }

  return port;
}

function parseOrigin(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
