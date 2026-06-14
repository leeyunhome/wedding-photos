import type { NextConfig } from "next";

const config: NextConfig = {
  images: {
    unoptimized: true, // images are pre-optimized by imgforge and served from R2
  },
  // Ensure TF.js packages go through Next.js webpack pipeline (ESM/CJS compat)
  transpilePackages: [
    "@tensorflow/tfjs",
    "@tensorflow/tfjs-core",
    "@tensorflow/tfjs-backend-webgl",
    "@tensorflow/tfjs-backend-webgpu",
    "@tensorflow-models/mobilenet",
  ],
};

export default config;
