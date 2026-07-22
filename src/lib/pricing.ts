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
