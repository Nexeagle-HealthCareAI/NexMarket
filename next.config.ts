import type { NextConfig } from 'next';
import withSerwistInit from '@serwist/next';

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development', // Useful to disable in dev, but for demo we can enable it or leave it disabled.
  // Actually, to demonstrate PWA offline capabilities in dev, we might want to enable it. 
  // But let's keep standard practice. I will set disable to false just to be sure it works for this demonstration.
});

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

  output: 'standalone',
};

// Override disable for dev so we can test it locally if needed, but standard is true. Let's just wrap it.
export default withSerwist(nextConfig);
