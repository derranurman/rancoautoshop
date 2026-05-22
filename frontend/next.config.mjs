/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'placehold.co' },
      { protocol: 'https', hostname: '**' },
      { protocol: 'http',  hostname: 'localhost' },
    ],
  },
  async rewrites() {
    const api = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    return [
      // Proxy /api/* → Laravel, so CORS headaches go away in dev
      { source: '/api/:path*', destination: `${api}/api/:path*` },
      // Proxy /storage/* → Laravel public disk (uploaded product images, etc.)
      { source: '/storage/:path*', destination: `${api}/storage/:path*` },
    ];
  },
};

export default nextConfig;
