import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@triton-one/yellowstone-grpc"],
  outputFileTracingIncludes: {
    "/api/solana/stream-status": [
      "./node_modules/@triton-one/yellowstone-grpc/**/*",
      "./node_modules/@grpc/grpc-js/**/*",
      "./node_modules/@grpc/proto-loader/**/*",
      "./node_modules/@js-sdsl/ordered-map/**/*",
      "./node_modules/@protobufjs/**/*",
      "./node_modules/lodash.camelcase/**/*",
      "./node_modules/long/**/*",
      "./node_modules/protobufjs/**/*",
    ],
  },
};

export default nextConfig;
