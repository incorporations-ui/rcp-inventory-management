/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  images: {
    remotePatterns: [],
  },

  async redirects() {
    return [
      {
        source: '/inventory/packing',
        destination: '/sales/packing',
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;
