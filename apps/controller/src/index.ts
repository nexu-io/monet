import { serve } from "@hono/node-server";

import { createControllerApp } from "./app";
import { createControllerConfig } from "./config";

export const controllerAppName = "@monet/controller";

export * from "./app";
export * from "./config";
export * from "./openapi";

export function startControllerServer() {
  const config = createControllerConfig();
  const app = createControllerApp({ bearerToken: config.bearerToken });

  return serve(
    {
      fetch: app.fetch,
      hostname: config.host,
      port: config.port
    },
    (address) => {
      console.log(`Monet controller listening on http://${address.address}:${address.port}`);
    }
  );
}

startControllerServer();
