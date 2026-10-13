import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the dev server to hydrate and serve internal assets when accessed
  // from the local LAN address used for phone/tablet testing.
  allowedDevOrigins: ["10.0.0.198"],
  async redirects() {
    return [
      { source: "/admin/leads", destination: "/leads", permanent: false },
      { source: "/settings", destination: "/admin", permanent: false },
      { source: "/settings/services", destination: "/admin/services", permanent: false },
      { source: "/settings/staff", destination: "/admin/staff", permanent: false },
      { source: "/settings/audit-log", destination: "/admin/audit-log", permanent: false },
    ];
  },
};

export default nextConfig;
