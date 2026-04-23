import { serve } from "@hono/node-server";

import { createControllerApp } from "./app";
import { createControllerConfig } from "./config";
import { createLogger } from "./logger";

export const controllerAppName = "@monet/controller";

export interface ControllerServerAddress {
  readonly address: string;
  readonly port: number;
}

export interface StartControllerServerOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly onReady?: (address: ControllerServerAddress) => void;
}

export * from "./app";
export * from "./config";
export * from "./openapi";

const controllerStartupLogger = createLogger("controller", {
  component: "startup"
});

export function startControllerServer(options: StartControllerServerOptions = {}) {
  const config = createControllerConfig(options.env);

  controllerStartupLogger.info("controller.starting", {
    address: config.host,
    databasePath: config.databasePath,
    port: config.port
  });

  const app = createControllerApp({
    allowedOrigins: config.allowedOrigins,
    bearerToken: config.bearerToken,
    databasePath: config.databasePath,
    openai: config.openai,
    port: config.port
  });

  return serve(
    {
      fetch: app.fetch,
      hostname: config.host,
      port: config.port
    },
    (address) => {
      controllerStartupLogger.info("controller.listening", {
        address: address.address,
        port: address.port,
        url: `http://${address.address}:${address.port}`
      });
      options.onReady?.({
        address: address.address,
        port: address.port
      });
    }
  );
}

if (require.main === module) {
  startControllerServer();
}
