import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { withX402, type RouteConfig } from "@x402/next";
import type { NextRequest, NextResponse } from "next/server";
import { env } from "./env";

const facilitator = new HTTPFacilitatorClient({ url: env.facilitatorUrl });
const server = new x402ResourceServer(facilitator)
  .register("eip155:8453", new ExactEvmScheme());

const sharedOutput = {
  type: "json",
  example: {
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
      evidenceHash: "0x..."
    }
  }
};

const configs: Record<"trade_guard" | "alpha_router", RouteConfig> = {
  trade_guard: {
    accepts: {
      scheme: "exact",
      price: "$0.10",
      network: "eip155:8453",
      payTo: env.x402PayTo,
      maxTimeoutSeconds: 180
    },
    serviceName: "AlphaGate",
    description: "Pre-trade risk gate for liquid crypto pairs and Base ERC-20 tokens.",
    mimeType: "application/json",
    tags: ["trading", "risk", "agents", "base", "genlayer"],
    extensions: {
      bazaar: {
        info: {
          input: {
            type: "http",
            method: "POST",
            bodyType: "json",
            body: {
              asset: { type: "pair", value: "BTC-USDT" },
              side: "buy",
              position_usd: "500",
              timeframe: "4h",
              max_loss_pct: "2",
              idempotency_key: "agent-order-0001"
            }
          },
          output: sharedOutput
        }
      }
    }
  },
  alpha_router: {
    accepts: {
      scheme: "exact",
      price: "$0.25",
      network: "eip155:8453",
      payTo: env.x402PayTo,
      maxTimeoutSeconds: 180
    },
    serviceName: "AlphaGate",
    description: "Consensus-backed trade plan with entry, stop, targets, and risk-bounded position sizing.",
    mimeType: "application/json",
    tags: ["trading", "signals", "technical-analysis", "agents", "genlayer"],
    extensions: {
      bazaar: {
        info: {
          input: {
            type: "http",
            method: "POST",
            bodyType: "json",
            body: {
              asset: { type: "pair", value: "ETH-USDT" },
              bias: "neutral",
              timeframe: "4h",
              risk_budget_usd: "25",
              portfolio_value_usd: "2500",
              idempotency_key: "agent-plan-0001"
            }
          },
          output: sharedOutput
        }
      }
    }
  }
};

export function protect(
  service: "trade_guard" | "alpha_router",
  handler: (request: NextRequest) => Promise<NextResponse<any>>
) {
  if (!env.x402Enabled) return handler;
  return withX402(handler, configs[service], server);
}
