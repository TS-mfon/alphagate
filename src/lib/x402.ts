import { HTTPFacilitatorClient, x402ResourceServer } from "@okxweb3/x402-core/server";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { withX402, type RouteConfig } from "@okxweb3/x402-next";
import type { NextRequest, NextResponse } from "next/server";
import { env } from "./env";

const facilitator = new HTTPFacilitatorClient({ url: env.facilitatorUrl });
const server = new x402ResourceServer(facilitator)
  .register("eip155:196", new ExactEvmScheme());

export const X_LAYER_NETWORK = "eip155:196" as const;
export const X_LAYER_USDT0 = "0x779ded0c9e1022225f8e0630b35a9b54be713736" as const;

const sharedOutputExample = {
  request_id: "0x...",
  status: "completed",
  result: {},
  payment_trace: {
    grossUnits: "100000",
    upstreamCostUnits: "6000",
    retainedUnits: "94000"
  },
  genlayer: {
    used: true,
    consensusStatus: "finalized",
    authoritative: true,
    evidenceHash: "0x..."
  }
};

const tradeGuardDiscovery = declareDiscoveryExtension({
  method: "POST",
  bodyType: "json",
  input: {
    asset: { type: "pair", value: "BTC-USDT" },
    side: "buy",
    position_usd: "500",
    timeframe: "4h",
    max_loss_pct: "2",
    idempotency_key: "agent-order-0001"
  },
  inputSchema: {
    type: "object",
    properties: {
      asset: { type: "object" },
      side: { type: "string", enum: ["buy", "sell"] },
      position_usd: { type: "string" },
      timeframe: { type: "string", enum: ["1h", "4h", "1d"] },
      max_loss_pct: { type: "string" },
      thesis: { type: "string" },
      idempotency_key: { type: "string" }
    },
    required: ["asset", "side", "position_usd", "timeframe", "max_loss_pct", "idempotency_key"]
  },
  output: {
    example: sharedOutputExample,
    schema: { type: "object" }
  }
} as Parameters<typeof declareDiscoveryExtension>[0] & { method: "POST" });

const alphaRouterDiscovery = declareDiscoveryExtension({
  method: "POST",
  bodyType: "json",
  input: {
    asset: { type: "pair", value: "ETH-USDT" },
    bias: "neutral",
    timeframe: "4h",
    risk_budget_usd: "25",
    portfolio_value_usd: "2500",
    idempotency_key: "agent-plan-0001"
  },
  inputSchema: {
    type: "object",
    properties: {
      asset: { type: "object" },
      bias: { type: "string", enum: ["bullish", "bearish", "neutral"] },
      timeframe: { type: "string", enum: ["1h", "4h", "1d"] },
      risk_budget_usd: { type: "string" },
      portfolio_value_usd: { type: "string" },
      idempotency_key: { type: "string" }
    },
    required: [
      "asset",
      "bias",
      "timeframe",
      "risk_budget_usd",
      "portfolio_value_usd",
      "idempotency_key"
    ]
  },
  output: {
    example: sharedOutputExample,
    schema: { type: "object" }
  }
} as Parameters<typeof declareDiscoveryExtension>[0] & { method: "POST" });

export const discoveryExtensions = {
  trade_guard: tradeGuardDiscovery,
  alpha_router: alphaRouterDiscovery
} as const;

const configs: Record<"trade_guard" | "alpha_router", RouteConfig> = {
  trade_guard: {
    accepts: {
      scheme: "exact",
      price: "$0.10",
      network: X_LAYER_NETWORK,
      payTo: env.x402PayTo,
      maxTimeoutSeconds: 180
    },
    description: "Pre-trade risk gate for liquid crypto pairs and Base ERC-20 tokens.",
    mimeType: "application/json",
    extensions: tradeGuardDiscovery
  },
  alpha_router: {
    accepts: {
      scheme: "exact",
      price: "$0.25",
      network: X_LAYER_NETWORK,
      payTo: env.x402PayTo,
      maxTimeoutSeconds: 180
    },
    description: "Consensus-backed trade plan with entry, stop, targets, and risk-bounded position sizing.",
    mimeType: "application/json",
    extensions: alphaRouterDiscovery
  }
};

export function protect(
  service: "trade_guard" | "alpha_router",
  handler: (request: NextRequest) => Promise<NextResponse<any>>
) {
  if (!env.x402Enabled) return handler;
  return withX402(handler, configs[service], server);
}
