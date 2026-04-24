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
  webpack: (config, { webpack }) => {
    const caveatFontPath = path.resolve(
      __dirname,
      "src/assets/fonts/Caveat-Regular.woff2"
    );

    config.resolve.alias["./fonts/Caveat-Regular.woff2"] = caveatFontPath;
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /Caveat-Regular\.woff2$/,
        caveatFontPath
      )
    );

    return config;
  }
};

export default nextConfig;
