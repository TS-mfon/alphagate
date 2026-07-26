import { localAlphaRouterResult, localTradeGuardResult } from "./analysis";
import { deterministicTradeGuard } from "./decision";
import { AlphaGateError } from "./errors";
import { genlayerConfiguration, claimRequest, failRequest, finalizeDeterministic } from "./genlayer";
import { canonicalJson, sha256 } from "./hash";
import { retainedUnits } from "./money";
import { SERVICE_PRICES } from "./pricing";
import type { AlphaRouterInput, TradeGuardInput } from "./schemas";
import {
  gatherAlphaRouterEvidence,
  gatherTradeGuardConfirmation,
  gatherTradeGuardEvidence
} from "./upstreams";
import type { EvidenceItem, GenLayerProof, PaymentTrace, ServiceKind, StoredRequest } from "./types";

function totalCost(evidence: EvidenceItem[]) {
  return evidence.reduce((sum, item) => sum + BigInt(item.costUnits), 0n);
}

function paymentTrace(service: ServiceKind, evidence: EvidenceItem[]): PaymentTrace {
  const gross = SERVICE_PRICES[service];
  const cost = totalCost(evidence);
  return {
    network: "eip155:196",
    asset: "USDT0",
    grossUnits: gross.toString(),
    upstreamCostUnits: cost.toString(),
    retainedUnits: retainedUnits(gross, cost).toString(),
    upstreamPayments: evidence.map(item => ({
      provider: item.provider,
      costUnits: item.costUnits,
      receipt: item.receipt
    }))
  };
}

function proof(stored: StoredRequest, mode: GenLayerProof["mode"]): GenLayerProof {
  const config = genlayerConfiguration();
  const consensusStatus = config.configured
    ? stored.consensusStatus ?? "finalized"
    : "not_used";
  return {
    used: config.configured,
    mode: config.configured ? mode : "local",
    consensusStatus,
    authoritative: config.configured && consensusStatus === "finalized",
    contract: config.contract,
    transactionHash: stored.genlayerTxHash,
    evidenceHash: stored.evidenceHash
  };
}

function priorResponse(request: StoredRequest) {
  if (request.status === "completed") {
    return {
      request_id: request.requestId,
      service: request.service,
      status: request.status,
      result: request.result,
      payment_trace: {
        network: "eip155:196",
        asset: "USDT0",
        grossUnits: request.grossUnits,
        upstreamCostUnits: request.upstreamCostUnits,
        retainedUnits: request.retainedUnits,
        upstreamPayments: []
      },
      genlayer: {
        used: genlayerConfiguration().configured,
        mode: genlayerConfiguration().configured ? "consensus" : "local",
        consensusStatus: request.consensusStatus ?? (genlayerConfiguration().configured ? "finalized" : "not_used"),
        authoritative: genlayerConfiguration().configured && request.consensusStatus !== "undetermined",
        contract: genlayerConfiguration().contract,
        evidenceHash: request.evidenceHash
      },
      replayed: true
    };
  }
  if (request.status === "claimed") {
    throw new AlphaGateError("request_in_progress", "This paid request is already being processed", 409, true);
  }
  throw new AlphaGateError("request_failed", request.error || "This request previously failed", 409, true);
}

export async function runTradeGuard(requestId: string, input: TradeGuardInput, inputHash: string) {
  const claimed = await claimRequest(requestId, "trade_guard", inputHash, SERVICE_PRICES.trade_guard);
  if (claimed.status !== "claimed" || claimed.inputHash !== inputHash) return priorResponse(claimed);

  let evidence: EvidenceItem[] = [];
  try {
    evidence = await gatherTradeGuardEvidence(input);
    const decision = deterministicTradeGuard(input, evidence);
    let result: Record<string, unknown>;
    if (decision.final) {
      result = {
        verdict: decision.verdict,
        risk_score: decision.riskScore,
        max_position_usd: decision.maxPositionUsd,
        reasons: decision.reasons
      };
    } else {
      evidence.push(...await gatherTradeGuardConfirmation(input));
      result = localTradeGuardResult(input, evidence, decision.riskScore);
    }
    const evidenceHash = sha256(evidence);
    const stored = await finalizeDeterministic(
      requestId,
      evidenceHash,
      result,
      totalCost(evidence)
    );

    return {
      request_id: requestId,
      service: "trade_guard",
      status: "completed",
      result: stored.result,
      evidence: evidence.map(item => ({
        provider: item.provider,
        kind: item.kind,
        observed_at: item.observedAt,
        data: item.data
      })),
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      payment_trace: paymentTrace("trade_guard", evidence),
      genlayer: proof(stored, "deterministic"),
      disclaimer: stored.consensusStatus === "undetermined"
        ? "Provisional contract verdict: GenLayer consensus was undetermined, so this result is not authoritative. AlphaGate does not execute trades."
        : "Decision support only. AlphaGate does not execute trades."
    };
  } catch (error) {
    await failRequest(requestId, error instanceof Error ? error.message : "TradeGuard failed");
    throw error;
  }
}

export async function runAlphaRouter(requestId: string, input: AlphaRouterInput, inputHash: string) {
  const claimed = await claimRequest(requestId, "alpha_router", inputHash, SERVICE_PRICES.alpha_router);
  if (claimed.status !== "claimed" || claimed.inputHash !== inputHash) return priorResponse(claimed);

  let evidence: EvidenceItem[] = [];
  try {
    evidence = await gatherAlphaRouterEvidence(input);
    const evidenceHash = sha256(evidence);
    const localResult = localAlphaRouterResult(input, evidence);
    if (input.asset.type === "base_token" && (localResult.action === "WAIT" || localResult.confidence === "low")) {
      throw new AlphaGateError(
        "unsupported_asset",
        "This Base token does not have enough liquid, resolvable history for a trade plan",
        422,
        false
      );
    }

    const stored = await finalizeDeterministic(
      requestId,
      evidenceHash,
      localResult,
      totalCost(evidence)
    );

    return {
      request_id: requestId,
      service: "alpha_router",
      status: "completed",
      result: stored.result,
      evidence: evidence.map(item => ({
        provider: item.provider,
        kind: item.kind,
        observed_at: item.observedAt,
        data: item.data
      })),
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      payment_trace: paymentTrace("alpha_router", evidence),
      genlayer: proof(stored, "deterministic"),
      disclaimer: stored.consensusStatus === "undetermined"
        ? "Provisional contract verdict: GenLayer consensus was undetermined, so this result is not authoritative. AlphaGate does not execute trades."
        : "Decision support only. AlphaGate does not execute trades."
    };
  } catch (error) {
    await failRequest(requestId, error instanceof Error ? error.message : "AlphaRouter failed");
    throw error;
  }
}

export function hashInput(input: unknown) {
  return sha256(canonicalJson(input));
}
