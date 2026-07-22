import { decodePaymentResponseHeader, wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { AlphaGateError } from "./errors";
import { env } from "./env";
import { PROVIDER_COSTS } from "./pricing";
import type { AlphaRouterInput, TradeGuardInput } from "./schemas";
import type { EvidenceItem } from "./types";

type ProviderName = keyof typeof PROVIDER_COSTS;

let paidFetch: typeof fetch | undefined;

function treasuryFetch() {
  if (paidFetch) return paidFetch;
  if (!env.treasuryPrivateKey) {
    throw new AlphaGateError(
      "treasury_unavailable",
      "The Base treasury signer is not configured",
      503,
      true
    );
  }

  const account = privateKeyToAccount(env.treasuryPrivateKey);
  paidFetch = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{
      network: "eip155:*",
      client: new ExactEvmScheme(account)
    }]
  });
  return paidFetch;
}

function receiptFrom(response: Response) {
  const header = response.headers.get("PAYMENT-RESPONSE");
  if (!header) return undefined;
  try {
    return JSON.stringify(decodePaymentResponseHeader(header));
  } catch {
    return header;
  }
}

async function paidJson(
  provider: ProviderName,
  url: URL,
  init?: RequestInit
): Promise<EvidenceItem> {
  const response = await treasuryFetch()(url, {
    ...init,
    signal: AbortSignal.timeout(45_000),
    headers: {
      accept: "application/json",
      ...(init?.headers ?? {})
    }
  });

  const text = await response.text();
  if (!response.ok) {
    throw new AlphaGateError(
      "upstream_failed",
      `${provider} returned HTTP ${response.status}`,
      502,
      true,
      { provider, response: text.slice(0, 500) }
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AlphaGateError(
      "upstream_malformed",
      `${provider} returned a non-JSON response`,
      502,
      true,
      { provider }
    );
  }

  return {
    provider,
    kind: provider,
    costUnits: PROVIDER_COSTS[provider].toString(),
    observedAt: new Date().toISOString(),
    receipt: receiptFrom(response),
    data
  };
}

function mockEvidence(provider: ProviderName, data: unknown): EvidenceItem {
  return {
    provider: `${provider} (local fixture)`,
    kind: provider,
    costUnits: PROVIDER_COSTS[provider].toString(),
    observedAt: new Date().toISOString(),
    data
  };
}

function symbolFromPair(pair: string) {
  return pair.split("-")[0].split("/")[0].toUpperCase();
}

function usdPair(pair: string) {
  return `${symbolFromPair(pair)}-USD`;
}

async function marketSignals(pair: string) {
  if (!env.liveUpstreams) {
    return mockEvidence("n0brains", {
      count: 1,
      signals: [{
        asset: symbolFromPair(pair),
        direction: "long",
        confidence: 0.72,
        conviction: "notable",
        score: 2.1,
        urgency: "medium"
      }]
    });
  }
  const url = new URL(env.providers.n0brains);
  url.searchParams.set("asset", symbolFromPair(pair));
  url.searchParams.set("limit", "25");
  url.searchParams.set("proven_only", "true");
  return await paidJson("n0brains", url);
}

async function technicalAnalysis(pair: string, timeframe: string) {
  if (!env.liveUpstreams) {
    return mockEvidence("ta", {
      symbol: pair,
      timeframe,
      price: 65_000,
      summary: { bias: "bullish", score: 35 },
      indicators: { rsi14: 56, sma50: 64_200, sma200: 61_900 },
      supportResistance: [{ support: 63_800, resistance: 67_400 }]
    });
  }
  const url = new URL(env.providers.ta);
  url.searchParams.set("symbol", pair);
  url.searchParams.set("tf", timeframe);
  return await paidJson("ta", url);
}

async function marketNews() {
  if (!env.liveUpstreams) {
    return mockEvidence("news", {
      status: "success",
      data: {
        sentiment: "neutral-positive",
        report: "No critical market-moving event detected in the current window."
      }
    });
  }
  return await paidJson("news", new URL(env.providers.news));
}

async function tokenSafety(address: string) {
  if (!env.liveUpstreams) {
    return mockEvidence("tokenSafety", {
      query: { chain: "base", token: address },
      honeypot: false,
      safety_score: 82,
      rating: "safe",
      buy_tax_pct: 0,
      sell_tax_pct: 0,
      market: { liquidity_usd: 740_000, volume_24h_usd: 260_000 },
      flags: []
    });
  }
  const url = new URL(env.providers.tokenSafety);
  url.searchParams.set("chain", "base");
  url.searchParams.set("token", address);
  return await paidJson("tokenSafety", url);
}

async function priceHistory(asset: string, timeframe: string) {
  if (!env.liveUpstreams) {
    return mockEvidence("priceHistory", {
      period: timeframe === "1d" ? "1d" : "1h",
      span: 30,
      series: [{
        query: asset,
        resolved: true,
        confidence: 0.94,
        points: Array.from({ length: 30 }, (_, index) => ({
          timestamp: 1_785_000_000 + index * 3600,
          price: 1 + index * 0.012 + Math.sin(index / 3) * 0.03
        }))
      }]
    });
  }
  const url = new URL(env.providers.priceHistory);
  url.searchParams.set("coins", asset);
  url.searchParams.set("period", timeframe === "1d" ? "1d" : "1h");
  url.searchParams.set("span", "60");
  return await paidJson("priceHistory", url);
}

async function candles(pair: string, timeframe: string) {
  if (!env.liveUpstreams) {
    return mockEvidence("candles", {
      pair: usdPair(pair),
      granularity: timeframe,
      candles: Array.from({ length: 80 }, (_, index) => {
        const base = 62_000 + index * 42 + Math.sin(index / 5) * 480;
        return { t: 1_784_000_000 + index * 3600, o: base, h: base + 220, l: base - 180, c: base + 70, v: 110 + index };
      })
    });
  }
  const end = new Date();
  const start = new Date(end.getTime() - (timeframe === "1d" ? 90 : 14) * 86_400_000);
  const url = new URL(env.providers.candles);
  url.searchParams.set("pair", usdPair(pair));
  url.searchParams.set("granularity", timeframe);
  url.searchParams.set("start", start.toISOString());
  url.searchParams.set("end", end.toISOString());
  return await paidJson("candles", url);
}

export async function gatherTradeGuardEvidence(input: TradeGuardInput) {
  if (input.asset.type === "base_token") {
    return await Promise.all([
      tokenSafety(input.asset.value),
      priceHistory(`base:${input.asset.value}`, input.timeframe)
    ]);
  }

  const base = await Promise.all([
    marketSignals(input.asset.value),
    marketNews()
  ]);
  return base;
}

export async function gatherTradeGuardConfirmation(input: TradeGuardInput) {
  if (input.asset.type === "base_token") return [];
  return [await technicalAnalysis(input.asset.value, input.timeframe)];
}

export async function gatherAlphaRouterEvidence(input: AlphaRouterInput) {
  if (input.asset.type === "base_token") {
    return await Promise.all([
      tokenSafety(input.asset.value),
      priceHistory(`base:${input.asset.value}`, input.timeframe)
    ]);
  }

  return await Promise.all([
    candles(input.asset.value, input.timeframe),
    technicalAnalysis(input.asset.value, input.timeframe),
    marketSignals(input.asset.value),
    marketNews()
  ]);
}
