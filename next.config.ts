import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.DOCKMASTER_BUILD_DIR || ".next",
};

export default nextConfig;
