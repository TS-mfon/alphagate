import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { genlayerConfiguration } from "@/lib/genlayer";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "AlphaGate",
    x402: env.x402Enabled,
    live_upstreams: env.liveUpstreams,
    genlayer: genlayerConfiguration(),
    persistence: "genlayer"
  });
}
