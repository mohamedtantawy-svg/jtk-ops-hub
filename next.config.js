/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  instrumentationHook: true,
  serverExternalPackages: ["pg"],
  env: {
    // Nexus injects GOOGLE_CLIENT_ID server-side; expose it to the client
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '',
  },
};

module.exports = nextConfig;
