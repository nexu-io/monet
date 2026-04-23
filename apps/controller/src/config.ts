const defaultControllerPort = 3030;
const defaultControllerHost = "127.0.0.1";

export interface ControllerConfig {
  readonly bearerToken: string;
  readonly host: string;
  readonly port: number;
}

export function createControllerConfig(env: NodeJS.ProcessEnv = process.env): ControllerConfig {
  const bearerToken = env.MONET_CONTROLLER_BEARER_TOKEN?.trim();

  if (!bearerToken) {
    throw new Error("MONET_CONTROLLER_BEARER_TOKEN is required to start the controller.");
  }

  return {
    bearerToken,
    host: env.MONET_CONTROLLER_HOST?.trim() || defaultControllerHost,
    port: parsePort(env.MONET_CONTROLLER_PORT)
  };
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
