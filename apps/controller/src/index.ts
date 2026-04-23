import { serve } from "@hono/node-server";

import { createControllerApp } from "./app";
import { createControllerConfig } from "./config";

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

export function startControllerServer(options: StartControllerServerOptions = {}) {
  const config = createControllerConfig(options.env);
  const app = createControllerApp({ bearerToken: config.bearerToken });

  return serve(
    {
      fetch: app.fetch,
      hostname: config.host,
      port: config.port
    },
    (address) => {
      console.log(`Monet controller listening on http://${address.address}:${address.port}`);
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
