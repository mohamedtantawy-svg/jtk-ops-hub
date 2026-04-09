/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  instrumentationHook: true,
  serverExternalPackages: ["pg"],
};

module.exports = nextConfig;
