import type { TradeGuardInput } from "./schemas";
import type { EvidenceItem } from "./types";

export type TradeGuardVerdict = "ALLOW" | "BLOCK" | "SIZE_DOWN";

interface GuardDecision {
  final: boolean;
  verdict: TradeGuardVerdict;
  riskScore: number;
  maxPositionUsd: string;
  reasons: string[];
}

function records(evidence: EvidenceItem[]) {
  return evidence.map(item => item.data as Record<string, any>);
}

export function deterministicTradeGuard(input: TradeGuardInput, evidence: EvidenceItem[]): GuardDecision {
  const data = records(evidence);
  const requested = Number(input.position_usd);
  const maxLoss = Number(input.max_loss_pct);

  if (input.asset.type === "base_token") {
    const safety = data.find(item => "honeypot" in item || "safety_score" in item) ?? {};
    const history = data.find(item => Array.isArray(item.series)) ?? {};
    const score = Number(safety.safety_score ?? 0);
    const liquidity = Number(safety.market?.liquidity_usd ?? 0);
    const flags = Array.isArray(safety.flags) ? safety.flags.map(String) : [];

    if (safety.honeypot === true || String(safety.rating).toLowerCase() === "critical") {
      return {
        final: true,
        verdict: "BLOCK",
        riskScore: 100,
        maxPositionUsd: "0",
        reasons: ["Token safety evidence indicates a honeypot or critical contract risk."]
      };
    }
    if (!history.series?.[0]?.resolved) {
      return {
        final: true,
        verdict: "BLOCK",
        riskScore: 88,
        maxPositionUsd: "0",
        reasons: ["The token has insufficient resolvable price history."]
      };
    }
    if (score < 45 || liquidity < 25_000 || flags.some(flag => /blacklist|cannot_sell|mint/i.test(flag))) {
      return {
        final: true,
        verdict: "BLOCK",
        riskScore: Math.max(75, 100 - score),
        maxPositionUsd: "0",
        reasons: ["Contract or liquidity evidence exceeds the hard risk threshold."]
      };
    }

    const liquidityLimit = liquidity > 0 ? Math.max(25, liquidity * 0.0025) : 100;
    if (requested > liquidityLimit) {
      return {
        final: true,
        verdict: "SIZE_DOWN",
        riskScore: 58,
        maxPositionUsd: liquidityLimit.toFixed(2),
        reasons: ["Requested position is too large relative to observed liquidity."]
      };
    }

    return {
      final: score >= 75 && maxLoss <= 3,
      verdict: "ALLOW",
      riskScore: Math.max(10, 100 - score),
      maxPositionUsd: input.position_usd,
      reasons: score >= 75 ? ["No hard contract or liquidity block was found."] : ["The token requires consensus review."]
    };
  }

  const signalPayload = data.find(item => Array.isArray(item.signals));
  const signals = signalPayload?.signals ?? [];
  const directions = new Set(signals.map((signal: any) => String(signal.direction).toLowerCase()));
  const conflict = directions.has("long") && directions.has("short");
  const confidence = signals.length
    ? signals.reduce((sum: number, signal: any) => sum + Number(signal.confidence ?? 0), 0) / signals.length
    : 0;

  if (maxLoss > 10) {
    return {
      final: true,
      verdict: "BLOCK",
      riskScore: 90,
      maxPositionUsd: "0",
      reasons: ["The requested maximum loss exceeds AlphaGate's hard limit."]
    };
  }
  if (requested > 100_000) {
    return {
      final: true,
      verdict: "SIZE_DOWN",
      riskScore: 70,
      maxPositionUsd: "100000",
      reasons: ["The requested position exceeds the service-level size ceiling."]
    };
  }

  return {
    final: !conflict && confidence >= 0.75 && maxLoss <= 3,
    verdict: "ALLOW",
    riskScore: conflict ? 62 : Math.round(45 - Math.min(confidence, 1) * 30),
    maxPositionUsd: input.position_usd,
    reasons: conflict
      ? ["Paid market signals disagree and require consensus review."]
      : ["No deterministic risk block was found."]
  };
}
