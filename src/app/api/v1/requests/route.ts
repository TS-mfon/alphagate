import { NextResponse } from "next/server";
import { getMetrics, listRequests, genlayerConfiguration } from "@/lib/genlayer";
import { errorPayload } from "@/lib/errors";
import { env } from "@/lib/env";

export const runtime = "nodejs";

export async function GET() {
  try {
    const [requests, metrics] = await Promise.all([listRequests(50), getMetrics()]);
    return NextResponse.json({
      requests,
      metrics,
      genlayer: genlayerConfiguration(),
      treasury: env.x402PayTo
    });
  } catch (error) {
    const payload = errorPayload(error);
    return NextResponse.json(payload.body, { status: payload.status });
  }
}
