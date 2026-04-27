import { resolve } from "node:path";

const defaultControllerPort = 42831;
const defaultControllerHost = "127.0.0.1";
const defaultAllowedOrigins = ["null", "app://monet", "http://127.0.0.1:42832", "http://localhost:42832"] as const;
const defaultAllowedToolDirectories = [process.cwd()] as const;
const defaultAgentMaxStepsPerRun = 8;
const defaultAgentMaxTokensPerRun = 32_768;
const defaultAgentWallClockBudgetMs = 60_000;
const defaultAgentMaxToolCallsPerRun = 16;

export interface ControllerConfig {
  readonly allowedOrigins: readonly string[];
  readonly allowedToolDirectories: readonly string[];
  readonly allowedToolDirectoriesSource: "default" | "env";
  readonly agentRuntime: AgentRuntimeConfig;
  readonly bearerToken: string;
  readonly host: string;
  readonly port: number;
  readonly databasePath: string;
  readonly connectorProvider: ConnectorProviderConfig;
  readonly features: FeatureConfig;
  readonly openai: OpenAIProviderConfig;
  readonly openrouter: OpenRouterProviderConfig;
}

export interface FeatureConfig {
  readonly connectors: boolean;
}

export interface AgentRuntimeConfig {
  readonly maxStepsPerRun: number;
  readonly maxTokensPerRun: number;
  readonly wallClockBudgetMs: number;
  readonly maxToolCallsPerRun: number;
}

export interface OpenAIProviderConfig {
  readonly apiKey: string | null;
  readonly baseUrl: string | null;
  readonly defaultModel: string;
  readonly timeoutMs: number | null;
}

export interface OpenRouterProviderConfig {
  readonly apiKey: string | null;
  readonly baseUrl: string | null;
  readonly defaultModel: string;
  readonly timeoutMs: number | null;
}

export type ConnectorProviderType = "composio";

export interface ConnectorProviderConfig {
  readonly provider: ConnectorProviderType;
  readonly composio: ComposioProviderConfig;
}

export interface ComposioProviderConfig {
  readonly apiKey: string | null;
  readonly baseUrl: string;
  readonly timeoutMs: number | null;
}

export function createControllerConfig(env: NodeJS.ProcessEnv = process.env): ControllerConfig {
  const bearerToken = env.MONET_CONTROLLER_BEARER_TOKEN?.trim();

  if (!bearerToken) {
    throw new Error("MONET_CONTROLLER_BEARER_TOKEN is required to start the controller.");
  }

  const host = parseHost(env.MONET_CONTROLLER_HOST);

  const allowedToolDirectories = parseAllowedToolDirectories(env);

  return {
    allowedOrigins: parseAllowedOrigins(env),
    allowedToolDirectories: allowedToolDirectories.value,
    allowedToolDirectoriesSource: allowedToolDirectories.source,
    agentRuntime: {
      maxStepsPerRun: parseIntegerWithDefault(env.MONET_AGENT_MAX_STEPS_PER_RUN, defaultAgentMaxStepsPerRun),
      maxTokensPerRun: parseIntegerWithDefault(env.MONET_AGENT_MAX_TOKENS_PER_RUN, defaultAgentMaxTokensPerRun),
      wallClockBudgetMs: parseIntegerWithDefault(env.MONET_AGENT_WALL_CLOCK_BUDGET_MS, defaultAgentWallClockBudgetMs),
      maxToolCallsPerRun: parseIntegerWithDefault(env.MONET_AGENT_MAX_TOOL_CALLS_PER_RUN, defaultAgentMaxToolCallsPerRun)
    },
    bearerToken,
    features: {
      connectors: parseBooleanWithDefault(env.MONET_FEATURE_CONNECTORS, false)
    },
    host,
    port: parsePort(env.MONET_CONTROLLER_PORT),
    databasePath: resolveDatabasePath(env),
    connectorProvider: {
      provider: parseConnectorProvider(env.MONET_CONNECTOR_PROVIDER),
      composio: {
        apiKey: parseOptionalString(env.MONET_COMPOSIO_API_KEY) ?? parseOptionalString(env.COMPOSIO_API_KEY),
        baseUrl: parseUrl(env.MONET_COMPOSIO_BASE_URL) ?? parseUrl(env.COMPOSIO_BASE_URL) ?? "https://backend.composio.dev",
        timeoutMs: parseInteger(env.MONET_COMPOSIO_TIMEOUT_MS)
      }
    },
    openai: {
      apiKey: parseOptionalString(env.MONET_OPENAI_API_KEY) ?? parseOptionalString(env.OPENAI_API_KEY),
      baseUrl: parseUrl(env.MONET_OPENAI_BASE_URL) ?? parseUrl(env.OPENAI_BASE_URL),
      defaultModel: parseOptionalString(env.MONET_OPENAI_DEFAULT_MODEL) ?? "gpt-4.1-mini",
      timeoutMs: parseInteger(env.MONET_OPENAI_TIMEOUT_MS)
    },
    openrouter: {
      apiKey: parseOptionalString(env.MONET_OPENROUTER_API_KEY) ?? parseOptionalString(env.OPENROUTER_API_KEY),
      baseUrl: parseUrl(env.MONET_OPENROUTER_BASE_URL) ?? parseUrl(env.OPENROUTER_BASE_URL),
      defaultModel: parseOptionalString(env.MONET_OPENROUTER_DEFAULT_MODEL) ?? "openai/gpt-4.1-mini",
      timeoutMs: parseInteger(env.MONET_OPENROUTER_TIMEOUT_MS)
    }
  };
}

function parseConnectorProvider(value: string | undefined): ConnectorProviderType {
  const normalized = value?.trim().toLowerCase() || "composio";

  if (normalized !== "composio") {
    throw new Error(`MONET_CONNECTOR_PROVIDER must be composio, received: ${value}`);
  }

  return normalized;
}

function resolveDatabasePath(env: NodeJS.ProcessEnv): string {
  const explicitPath = env.MONET_DATABASE_PATH?.trim();

  if (explicitPath) {
    return resolve(explicitPath);
  }

  const userDataDirectory = env.MONET_USER_DATA_DIR?.trim();

  if (userDataDirectory) {
    return resolve(userDataDirectory, "sqlite", "monet.db");
  }

  return resolve(process.cwd(), "sqlite", "monet.db");
}

function parseAllowedToolDirectories(env: NodeJS.ProcessEnv): {
  readonly value: readonly string[];
  readonly source: "default" | "env";
} {
  const configuredDirectories = env.MONET_TOOL_ALLOWED_DIRECTORIES?.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => resolve(value));

  return {
    value: Array.from(new Set(configuredDirectories?.length ? configuredDirectories : defaultAllowedToolDirectories)),
    source: configuredDirectories?.length ? "env" : "default"
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

function parseOptionalString(value: string | undefined): string | null {
  const normalized = value?.trim();

  return normalized ? normalized : null;
}

function parseUrl(value: string | undefined): string | null {
  const normalized = parseOptionalString(value);

  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`Expected a valid URL, received: ${normalized}`);
  }
}

function parseInteger(value: string | undefined): number | null {
  const normalized = parseOptionalString(value);

  if (!normalized) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received: ${normalized}`);
  }

  return parsed;
}

function parseIntegerWithDefault(value: string | undefined, fallback: number): number {
  return parseInteger(value) ?? fallback;
}

function parseBooleanWithDefault(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Expected a boolean feature flag value, received: ${value}`);
}
