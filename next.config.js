/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Prevent static prerender errors when env vars are absent at build time
  // All pages use Supabase (client-side auth) and must be dynamically rendered
  output: 'standalone',

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
    ]
  },
}

module.exports = nextConfig
