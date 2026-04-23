import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createControllerApp } from "../src/app";

async function main() {
  const app = createControllerApp({
    bearerToken: "openapi-generation-token",
    databasePath: "/tmp/monet-openapi.sqlite"
  });
  const document = app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "Monet Controller API",
      version: "0.1.0",
      description: "Local Hono controller API for the Monet desktop application."
    },
    tags: [
      {
        name: "System",
        description: "Health and controller metadata endpoints."
      },
      {
        name: "Sessions",
        description: "Session lifecycle and history endpoints."
      },
      {
        name: "Providers",
        description: "Provider, model catalog, and validation endpoints."
      }
    ]
  });

  const outputPath = resolve(__dirname, "..", "openapi.json");

  await writeFile(outputPath, JSON.stringify(document, null, 2) + "\n", "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
