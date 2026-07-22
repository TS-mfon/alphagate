import { z } from "zod";

const decimalString = z.string().regex(/^(0|[1-9]\d*)(\.\d{1,6})?$/, "Use a positive decimal string");

const assetSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("pair"),
    value: z.string().trim().min(3).max(40).transform(value => value.toUpperCase())
  }),
  z.object({
    type: z.literal("base_token"),
    value: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Use a Base ERC-20 contract address")
  })
]);

export const tradeGuardSchema = z.object({
  asset: assetSchema,
  side: z.enum(["buy", "sell"]),
  position_usd: decimalString,
  timeframe: z.enum(["1h", "4h", "1d"]).default("4h"),
  max_loss_pct: decimalString,
  thesis: z.string().trim().max(800).optional().default(""),
  idempotency_key: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/)
});

export const alphaRouterSchema = z.object({
  asset: assetSchema,
  bias: z.enum(["bullish", "bearish", "neutral"]).default("neutral"),
  timeframe: z.enum(["1h", "4h", "1d"]).default("4h"),
  risk_budget_usd: decimalString,
  portfolio_value_usd: decimalString,
  idempotency_key: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/)
});

export type TradeGuardInput = z.infer<typeof tradeGuardSchema>;
export type AlphaRouterInput = z.infer<typeof alphaRouterSchema>;
