import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ['sequelize', 'pg', 'pg-hstore'],
};

export default nextConfig;
