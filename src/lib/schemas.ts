import { z } from "zod";

function decimalString(max: number, allowZero = true) {
  return z.string()
    .regex(/^(0|[1-9]\d*)(\.\d{1,6})?$/, "Use a decimal string with at most 6 fractional digits")
    .refine(value => {
      const numeric = Number(value);
      return Number.isFinite(numeric)
        && numeric <= max
        && (allowZero || numeric > 0);
    }, `Use a value ${allowZero ? "between 0 and" : "greater than 0 and at most"} ${max}`);
}

const assetSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("pair"),
    value: z.string()
      .trim()
      .transform(value => value.toUpperCase())
      .pipe(z.string().regex(/^[A-Z0-9]{2,15}[-/][A-Z0-9]{2,15}$/, "Use a pair such as BTC-USDT"))
  }),
  z.object({
    type: z.literal("base_token"),
    value: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Use a Base ERC-20 contract address")
  })
]);

export const tradeGuardSchema = z.object({
  asset: assetSchema,
  side: z.enum(["buy", "sell"]),
  position_usd: decimalString(10_000_000, false),
  timeframe: z.enum(["1h", "4h", "1d"]).default("4h"),
  max_loss_pct: decimalString(100),
  thesis: z.string().trim().max(800).optional().default(""),
  idempotency_key: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/)
});

export const alphaRouterSchema = z.object({
  asset: assetSchema,
  bias: z.enum(["bullish", "bearish", "neutral"]).default("neutral"),
  timeframe: z.enum(["1h", "4h", "1d"]).default("4h"),
  risk_budget_usd: decimalString(1_000_000, false),
  portfolio_value_usd: decimalString(1_000_000_000, false),
  idempotency_key: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/)
});

export type TradeGuardInput = z.infer<typeof tradeGuardSchema>;
export type AlphaRouterInput = z.infer<typeof alphaRouterSchema>;
