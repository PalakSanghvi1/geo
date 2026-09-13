import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Served behind nginx at http://<vps-ip>/GEO
  basePath: '/GEO',
  output: 'standalone',
  // better-sqlite3 is a native module; keep it external to the server bundle.
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
