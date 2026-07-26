import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { genlayerConfiguration } from "@/lib/genlayer";
import { X_LAYER_NETWORK, X_LAYER_USDT0 } from "@/lib/x402";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "AlphaGate",
    x402: env.x402Enabled,
    live_upstreams: env.liveUpstreams,
    treasury: {
      network: X_LAYER_NETWORK,
      asset: "USDT0",
      assetAddress: X_LAYER_USDT0,
      address: env.x402PayTo
    },
    paymentSdk: {
      provider: "OKX",
      corePackage: "@okxweb3/x402-core",
      evmPackage: "@okxweb3/x402-evm",
      nextPackage: "@okxweb3/x402-next",
      authenticatedFacilitator: Boolean(
        env.okxApiKey && env.okxSecretKey && env.okxPassphrase
      )
    },
    genlayer: genlayerConfiguration(),
    persistence: "genlayer"
  });
}
