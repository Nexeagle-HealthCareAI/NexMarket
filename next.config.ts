import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Enable PWA headers
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },

  // Output: standalone for Docker on e2e Networks VM
  // Switch to 'export' if deploying as pure static shell + separate API
  output: 'standalone',
};

export default nextConfig;
