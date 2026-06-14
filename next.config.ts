import type { NextConfig } from "next";

const config: NextConfig = {
  images: {
    unoptimized: true, // images are pre-optimized by imgforge and served from R2
  },
};

export default config;
