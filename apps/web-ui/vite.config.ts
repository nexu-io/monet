import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "/",
  plugins: [react()],
  build: {
    outDir: "out",
    emptyOutDir: true
  },
  resolve: {
    alias: {
      "./fonts/Caveat-Regular.woff2": path.resolve(__dirname, "src/assets/fonts/Caveat-Regular.woff2")
    }
  },
  server: {
    host: "127.0.0.1",
    port: 42832,
    strictPort: true
  }
});
