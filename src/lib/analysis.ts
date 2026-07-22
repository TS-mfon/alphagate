import type { AlphaRouterInput, TradeGuardInput } from "./schemas";
import type { EvidenceItem } from "./types";

function allData(evidence: EvidenceItem[]) {
  return evidence.map(item => item.data as Record<string, any>);
}

export function localTradeGuardResult(
  input: TradeGuardInput,
  evidence: EvidenceItem[],
  defaultRiskScore: number
) {
  const data = allData(evidence);
  const safety = data.find(item => "safety_score" in item);
  const technical = data.find(item => item.summary?.bias);
  const signals = data.flatMap(item => Array.isArray(item.signals) ? item.signals : []);
  const desired = input.side === "buy" ? "long" : "short";
  const aligned = signals.filter(signal => String(signal.direction).toLowerCase() === desired).length;
  const opposed = signals.filter(signal => String(signal.direction).toLowerCase() !== desired).length;
  const technicalBias = String(technical?.summary?.bias ?? "").toLowerCase();

  let verdict: "ALLOW" | "BLOCK" | "SIZE_DOWN" = "ALLOW";
  let riskScore = defaultRiskScore;
  const reasons: string[] = [];

  if (safety) {
    riskScore = Math.max(0, 100 - Number(safety.safety_score ?? 50));
    reasons.push(`Token safety score: ${Number(safety.safety_score ?? 0)}/100.`);
  }
  if (opposed > aligned) {
    verdict = "SIZE_DOWN";
    riskScore = Math.max(riskScore, 58);
    reasons.push("Paid directional signals oppose the requested side.");
  } else if (aligned > 0) {
    reasons.push("Paid directional signals support the requested side.");
  }
  if (technicalBias && !technicalBias.includes(input.side === "buy" ? "bull" : "bear")) {
    verdict = "SIZE_DOWN";
    riskScore = Math.max(riskScore, 55);
    reasons.push("Technical bias does not confirm the requested side.");
  }

  const requested = Number(input.position_usd);
  const maxPosition = verdict === "SIZE_DOWN" ? Math.max(10, requested * 0.35) : requested;
  return {
    verdict,
    risk_score: Math.min(100, Math.round(riskScore)),
    max_position_usd: maxPosition.toFixed(2),
    reasons: reasons.length ? reasons : ["No hard safety or liquidity block was found."]
  };
}

export function localAlphaRouterResult(input: AlphaRouterInput, evidence: EvidenceItem[]) {
  const data = allData(evidence);
  const technical = data.find(item => item.summary?.bias);
  const candles = data.find(item => Array.isArray(item.candles));
  const history = data.find(item => Array.isArray(item.series));
  const signals = data.flatMap(item => Array.isArray(item.signals) ? item.signals : []);

  const prices: number[] = candles?.candles?.map((item: any) => Number(item.c ?? item.close)).filter(Number.isFinite)
    ?? history?.series?.[0]?.points?.map((item: any) => Number(item.price)).filter(Number.isFinite)
    ?? [];
  const current = Number(technical?.price ?? prices.at(-1) ?? 0);
  const recent = prices.slice(-20);
  const low = recent.length ? Math.min(...recent) : current * 0.985;
  const high = recent.length ? Math.max(...recent) : current * 1.015;
  const longSignals = signals.filter(signal => String(signal.direction).toLowerCase() === "long").length;
  const shortSignals = signals.filter(signal => String(signal.direction).toLowerCase() === "short").length;
  const bias = String(technical?.summary?.bias ?? input.bias).toLowerCase();

  let action: "LONG" | "SHORT" | "WAIT" = "WAIT";
  if ((bias.includes("bull") || input.bias === "bullish") && longSignals >= shortSignals) action = "LONG";
  if ((bias.includes("bear") || input.bias === "bearish") && shortSignals >= longSignals) action = "SHORT";

  const riskBudget = Number(input.risk_budget_usd);
  const portfolio = Number(input.portfolio_value_usd);
  const positionSize = Math.min(portfolio * 0.1, riskBudget > 0 ? riskBudget / 0.02 : 0);

  if (!Number.isFinite(current) || current <= 0 || prices.length < 10) action = "WAIT";
  const entryLow = action === "SHORT" ? current * 0.997 : Math.max(low, current * 0.992);
  const entryHigh = action === "SHORT" ? Math.min(high, current * 1.008) : current * 1.003;
  const stop = action === "SHORT" ? entryHigh * 1.02 : entryLow * 0.98;
  const targetOne = action === "SHORT" ? entryLow * 0.97 : entryHigh * 1.03;
  const targetTwo = action === "SHORT" ? entryLow * 0.94 : entryHigh * 1.06;

  return {
    action,
    confidence: action === "WAIT" ? "low" : signals.length > 1 ? "high" : "medium",
    entry: action === "WAIT" ? null : {
      low: Number(entryLow.toFixed(8)),
      high: Number(entryHigh.toFixed(8))
    },
    stop: action === "WAIT" ? null : Number(stop.toFixed(8)),
    targets: action === "WAIT" ? [] : [
      Number(targetOne.toFixed(8)),
      Number(targetTwo.toFixed(8))
    ],
    position_size_usd: action === "WAIT" ? "0" : positionSize.toFixed(2),
    risk_reward: action === "WAIT" ? "0" : "1.5",
    invalidation: action === "WAIT"
      ? "Evidence is insufficient or conflicting; wait for a fresh request."
      : "Invalidate when price closes beyond the stop or paid evidence becomes stale.",
    reasons: [
      "Plan uses paid candle or history data, technical indicators, directional signals, and current news context.",
      action === "WAIT" ? "Evidence did not support defensible executable levels." : "Position size is capped by the supplied risk budget."
    ]
  };
}
