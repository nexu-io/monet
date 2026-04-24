import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true
  },
  trailingSlash: true,
  webpack: (config) => {
    config.resolve.alias["./fonts/Caveat-Regular.woff2"] = path.resolve(
      __dirname,
      "src/assets/fonts/Caveat-Regular.woff2"
    );

    return config;
  }
};

export default nextConfig;
