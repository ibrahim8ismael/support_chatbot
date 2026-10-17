import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The Docker image ships .next/standalone (apps/web/Dockerfile).
  output: 'standalone',
  reactStrictMode: true,
};

export default nextConfig;
