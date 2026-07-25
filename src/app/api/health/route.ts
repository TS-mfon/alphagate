import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { genlayerConfiguration } from "@/lib/genlayer";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "AlphaGate",
    x402: env.x402Enabled,
    live_upstreams: env.liveUpstreams,
    treasury: {
      network: "eip155:8453",
      asset: "USDC",
      address: env.x402PayTo
    },
    genlayer: genlayerConfiguration(),
    persistence: "genlayer"
  });
}
