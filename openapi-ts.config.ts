import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "apps/controller/openapi.json",
  output: {
    path: "apps/web-ui/src/lib/api/generated"
  },
  plugins: [
    "@hey-api/typescript",
    "@hey-api/client-fetch",
    "@hey-api/sdk",
    {
      name: "@tanstack/react-query",
      queryKeys: true,
      queryOptions: true,
      mutationOptions: true
    }
  ]
});
