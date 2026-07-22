import { NextResponse, type NextRequest } from "next/server";
import { errorPayload } from "@/lib/errors";
import { hashInput, runTradeGuard } from "@/lib/service";
import { requestId as buildRequestId } from "@/lib/hash";
import { tradeGuardSchema } from "@/lib/schemas";
import { withRequestLock } from "@/lib/locks";
import { protect } from "@/lib/x402";

export const runtime = "nodejs";
export const maxDuration = 180;

async function handler(request: NextRequest) {
  let requestId: string | undefined;
  try {
    const input = tradeGuardSchema.parse(await request.json());
    const paymentProof = request.headers.get("PAYMENT-SIGNATURE")
      ?? request.headers.get("X-PAYMENT")
      ?? "development-unpaid";
    requestId = buildRequestId("trade_guard", input.idempotency_key, paymentProof, input);
    const inputHash = hashInput(input);
    const result = await withRequestLock(requestId, () => runTradeGuard(requestId!, input, inputHash));
    return NextResponse.json(result);
  } catch (error) {
    const payload = errorPayload(error, requestId);
    return NextResponse.json(payload.body, { status: payload.status });
  }
}

export const POST = protect("trade_guard", handler);
