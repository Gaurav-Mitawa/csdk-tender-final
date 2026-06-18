import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit .next/standalone for a minimal production Docker image (no full
  // node_modules at runtime). Served via `node server.js`. See Dockerfile.
  output: "standalone",
  // Allow the dev server to be opened from the LAN (not just localhost) — Next 16
  // blocks cross-origin /_next/* requests by default, which breaks hydration (and
  // every button) when reached via the machine's IP. Add your LAN IP(s) here.
  allowedDevOrigins: ["192.168.29.55"],
};

export default nextConfig;
