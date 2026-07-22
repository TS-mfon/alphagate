import type { Address, Hex } from "viem";

function bool(name: string, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === "true" || value === "1";
}

export const env = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  x402Enabled: bool("X402_ENABLED"),
  x402PayTo: (process.env.X402_PAY_TO ?? "0x0000000000000000000000000000000000000000") as Address,
  facilitatorUrl: process.env.X402_FACILITATOR_URL ?? "https://facilitator.payai.network",
  treasuryPrivateKey: process.env.TREASURY_PRIVATE_KEY as Hex | undefined,
  liveUpstreams: bool("LIVE_UPSTREAMS"),
  requireGenLayer: bool("REQUIRE_GENLAYER", process.env.NODE_ENV === "production"),
  genlayerPrivateKey: process.env.GENLAYER_PRIVATE_KEY as Hex | undefined,
  genlayerContract: process.env.GENLAYER_CONTRACT_ADDRESS as Address | undefined,
  providers: {
    n0brains: process.env.UPSTREAM_N0BRAINS_URL ?? "https://api.n0brains.com/x402/signals",
    ta: process.env.UPSTREAM_TA_URL ?? "https://x402.tradesnack.com/ta",
    news: process.env.UPSTREAM_NEWS_URL ?? "https://x402.ottoai.services/crypto-news",
    tokenSafety: process.env.UPSTREAM_TOKEN_SAFETY_URL ?? "https://x402-endpoints.onrender.com/crypto/token-safety",
    priceHistory: process.env.UPSTREAM_PRICE_HISTORY_URL ?? "https://crypto.apitoll.cloud/v1/crypto/chart",
    candles: process.env.UPSTREAM_CANDLES_URL ?? "https://x402.shizu.me/candles"
  }
};
