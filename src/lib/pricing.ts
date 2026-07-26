import type { ServiceKind } from "./types";

export const SERVICE_PRICES: Record<ServiceKind, bigint> = {
  trade_guard: 100_000n,
  alpha_router: 250_000n
};

export const PROVIDER_COSTS = {
  n0brains: 5_000n,
  ta: 10_000n,
  news: 1_000n,
  tokenSafety: 50_000n,
  priceHistory: 1_000n,
  candles: 5_000n
} as const;

export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export const PROVIDER_PAYEES: Record<keyof typeof PROVIDER_COSTS, `0x${string}`> = {
  n0brains: "0xc1793B8AA0D25193117EF025f145994e1c02011F",
  ta: "0x081F8761f68e9387D339bdDaAa0C8Db5d3a72F5e",
  news: "0x0E84dDEdAaE6A779c462C22a59F301EC31B6b808",
  tokenSafety: "0x1D1C81247C407521E2A01F3E21514870dcf1620f",
  priceHistory: "0x3dA40A9aD36640a2C0F533BAC368490095574664",
  candles: "0x217e5Fe265EB78b29067bF8324ef03a7D8e167C4"
};
