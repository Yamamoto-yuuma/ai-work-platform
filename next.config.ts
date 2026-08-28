import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 開発時のオーバーレイがサイドナビと重なるため無効化
  devIndicators: false,
};

export default nextConfig;
