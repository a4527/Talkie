import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  // The former split test pages now live in the single signed-in conversation flow.
  async redirects() {
    return [{ source: "/learn", destination: "/talk", permanent: false }, { source: "/voice", destination: "/talk", permanent: false }];
  },
};
export default config;
