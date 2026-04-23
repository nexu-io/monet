import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createControllerApp } from "../src/app";

async function main() {
  const app = createControllerApp({
    allowedOrigins: ["null"],
    allowedToolDirectories: [process.cwd()],
    allowedToolDirectoriesSource: "env",
    agentRuntime: {
      maxStepsPerRun: 8,
      maxTokensPerRun: 32_768,
      wallClockBudgetMs: 60_000,
      maxToolCallsPerRun: 16
    },
    bearerToken: "openapi-generation-token",
    databasePath: "/tmp/monet-openapi.sqlite",
    openai: {
      apiKey: null,
      baseUrl: null,
      defaultModel: "gpt-4.1-mini",
      timeoutMs: null
    },
    openrouter: {
      apiKey: null,
      baseUrl: null,
      defaultModel: "openai/gpt-4.1-mini",
      timeoutMs: null
    },
    port: 3030
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
      },
      {
        name: "Runs",
        description: "Run lifecycle endpoints such as interruption."
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
