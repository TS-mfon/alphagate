import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { deterministicTradeGuard } from "../src/lib/decision";
import { GENLAYER_WAIT_POLICY, pendingStored } from "../src/lib/genlayer";
import { canonicalJson, requestId, sha256 } from "../src/lib/hash";
import {
  clearLocalRequests,
  listLocalRequests,
  localMetrics,
  setLocalRequest
} from "../src/lib/localStore";
import { formatUsdc, parseUsdc, retainedUnits } from "../src/lib/money";
import { alphaRouterSchema, tradeGuardSchema, type TradeGuardInput } from "../src/lib/schemas";
import { approvedPaymentRequirements } from "../src/lib/upstreamPolicy";
import { discoveryExtensions, X_LAYER_NETWORK, X_LAYER_USDT0 } from "../src/lib/x402";
import type { EvidenceItem, StoredRequest } from "../src/lib/types";

const pairInput: TradeGuardInput = {
  asset: { type: "pair", value: "BTC-USDT" },
  side: "buy",
  position_usd: "500",
  timeframe: "4h",
  max_loss_pct: "2",
  thesis: "",
  idempotency_key: "guard-test-0001"
};

function evidence(data: unknown): EvidenceItem {
  return {
    provider: "fixture",
    kind: "fixture",
    costUnits: "1000",
    observedAt: "2026-07-22T12:00:00.000Z",
    data
  };
}

function stored(overrides: Partial<StoredRequest> = {}): StoredRequest {
  return {
    requestId: "0x" + "11".repeat(32),
    service: "trade_guard",
    status: "completed",
    inputHash: "0x" + "22".repeat(32),
    evidenceHash: "0x" + "33".repeat(32),
    grossUnits: "100000",
    upstreamCostUnits: "6000",
    retainedUnits: "94000",
    result: { verdict: "ALLOW" },
    error: "",
    createdAt: "2026-07-22T12:00:00.000Z",
    updatedAt: "2026-07-22T12:00:01.000Z",
    ...overrides
  };
}

describe("USDC utilities", () => {
  it("parses and formats six-decimal USDC values exactly", () => {
    assert.equal(parseUsdc("0.10"), 100_000n);
    assert.equal(parseUsdc("12.345678"), 12_345_678n);
    assert.equal(formatUsdc(12_345_678n), "12.345678");
    assert.equal(formatUsdc(-100_000n), "-0.1");
  });

  it("rejects ambiguous or over-precise amounts", () => {
    for (const value of ["", ".1", "01", "1.0000001", "1e3", "abc"]) {
      assert.throws(() => parseUsdc(value));
    }
  });

  it("never reports negative retained revenue", () => {
    assert.equal(retainedUnits(100_000n, 6_000n), 94_000n);
    assert.equal(retainedUnits(5_000n, 6_000n), 0n);
  });
});

describe("canonical hashing", () => {
  it("is stable across object key ordering", () => {
    const left = { asset: "BTC", nested: { z: 2, a: 1 } };
    const right = { nested: { a: 1, z: 2 }, asset: "BTC" };
    assert.equal(canonicalJson(left), canonicalJson(right));
    assert.equal(sha256(left), sha256(right));
  });

  it("binds request ids to service, payment proof, key, and input", () => {
    const first = requestId("trade_guard", "key-0001", "proof-a", pairInput);
    assert.equal(first, requestId("trade_guard", "key-0001", "proof-a", pairInput));
    assert.notEqual(first, requestId("alpha_router", "key-0001", "proof-a", pairInput));
    assert.notEqual(first, requestId("trade_guard", "key-0001", "proof-b", pairInput));
    assert.notEqual(first, requestId("trade_guard", "key-0002", "proof-a", pairInput));
  });
});

describe("request validation", () => {
  it("accepts supported pair symbols and bounded numeric values", () => {
    assert.equal(tradeGuardSchema.parse(pairInput).asset.value, "BTC-USDT");
  });

  it("rejects malformed pairs and unbounded values", () => {
    assert.throws(() => tradeGuardSchema.parse({
      ...pairInput,
      asset: { type: "pair", value: "BTC?redirect=https://example.com" }
    }));
    assert.throws(() => tradeGuardSchema.parse({
      ...pairInput,
      position_usd: "10000000.000001"
    }));
    assert.throws(() => alphaRouterSchema.parse({
      asset: { type: "pair", value: "ETH-USDT" },
      bias: "neutral",
      timeframe: "4h",
      risk_budget_usd: "0",
      portfolio_value_usd: "2500",
      idempotency_key: "router-test-0001"
    }));
  });
});

describe("upstream payment policy", () => {
  const approved = {
    scheme: "exact",
    network: "eip155:8453",
    amount: "5000",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    payTo: "0xc1793B8AA0D25193117EF025f145994e1c02011F",
    extra: { name: "USD Coin", version: "2" }
  };

  it("accepts only the configured provider charge", () => {
    assert.deepEqual(approvedPaymentRequirements("n0brains", [approved]), [approved]);
  });

  it("rejects overspend, recipient changes, and Permit2", () => {
    assert.equal(approvedPaymentRequirements("n0brains", [
      { ...approved, amount: "5000000" },
      { ...approved, payTo: "0x0000000000000000000000000000000000000001" },
      { ...approved, extra: { ...approved.extra, assetTransferMethod: "permit2" } }
    ]).length, 0);
  });
});

describe("x402 discovery metadata", () => {
  it("declares POST for every JSON-body service", () => {
    const method = (extension: typeof discoveryExtensions.trade_guard) =>
      (extension.bazaar.info.input as { method?: string }).method;

    assert.equal(method(discoveryExtensions.trade_guard), "POST");
    assert.equal(method(discoveryExtensions.alpha_router), "POST");
  });

  it("prices incoming services in X Layer USDT0", async () => {
    const scheme = new ExactEvmScheme();
    const tradeGuardPrice = await scheme.parsePrice("$0.10", X_LAYER_NETWORK);
    const alphaRouterPrice = await scheme.parsePrice("$0.25", X_LAYER_NETWORK);

    assert.equal(tradeGuardPrice.amount, "100000");
    assert.equal(tradeGuardPrice.asset, X_LAYER_USDT0);
    assert.equal(tradeGuardPrice.extra?.version, "1");
    assert.equal(alphaRouterPrice.amount, "250000");
    assert.equal(alphaRouterPrice.asset, X_LAYER_USDT0);
    assert.equal(alphaRouterPrice.extra?.version, "1");
  });
});

describe("GenLayer serverless timing policy", () => {
  it("leaves time for upstream calls and failure recording", () => {
    const analysisWait =
      GENLAYER_WAIT_POLICY.analysisRetries * GENLAYER_WAIT_POLICY.intervalMs;
    const failureWait =
      GENLAYER_WAIT_POLICY.failureRetries * GENLAYER_WAIT_POLICY.intervalMs;

    assert.ok(analysisWait <= 60_000);
    assert.ok(failureWait <= 10_000);
    assert.ok(45_000 + 20_000 + analysisWait + failureWait < 150_000);
  });

  it("returns a submitted deterministic verdict instead of a false failure", () => {
    const request = stored({
      status: "claimed",
      grossUnits: "100000",
      upstreamCostUnits: "0",
      retainedUnits: "100000",
      result: {}
    });
    const result = {
      verdict: "SIZE_DOWN",
      risk_score: 55,
      max_position_usd: "525",
      reasons: ["Technical bias is not confirmed."]
    };

    const pending = pendingStored(
      request,
      "0x" + "66".repeat(32),
      "0x" + "77".repeat(32),
      result,
      16_000n
    );

    assert.equal(pending.status, "completed");
    assert.equal(pending.consensusStatus, "pending");
    assert.equal(pending.retainedUnits, "84000");
    assert.deepEqual(pending.result, result);
  });
});

describe("deterministic TradeGuard", () => {
  it("blocks requests above the maximum-loss hard limit", () => {
    const result = deterministicTradeGuard(
      { ...pairInput, max_loss_pct: "10.01" },
      [evidence({ signals: [{ direction: "long", confidence: 0.99 }] })]
    );
    assert.equal(result.final, true);
    assert.equal(result.verdict, "BLOCK");
    assert.equal(result.maxPositionUsd, "0");
  });

  it("sizes down oversized pair positions", () => {
    const result = deterministicTradeGuard(
      { ...pairInput, position_usd: "100000.01" },
      [evidence({ signals: [{ direction: "long", confidence: 0.99 }] })]
    );
    assert.equal(result.final, true);
    assert.equal(result.verdict, "SIZE_DOWN");
    assert.equal(result.maxPositionUsd, "100000");
  });

  it("blocks unsafe Base tokens without invoking consensus", () => {
    const result = deterministicTradeGuard(
      {
        ...pairInput,
        asset: { type: "base_token", value: "0x" + "ab".repeat(20) }
      },
      [
        evidence({ honeypot: true, safety_score: 0, rating: "critical" }),
        evidence({ series: [{ resolved: true }] })
      ]
    );
    assert.equal(result.final, true);
    assert.equal(result.verdict, "BLOCK");
    assert.equal(result.riskScore, 100);
  });

  it("routes conflicting pair signals to consensus", () => {
    const result = deterministicTradeGuard(pairInput, [
      evidence({
        signals: [
          { direction: "long", confidence: 0.9 },
          { direction: "short", confidence: 0.8 }
        ]
      })
    ]);
    assert.equal(result.final, false);
    assert.equal(result.riskScore, 62);
  });
});

describe("database-free local fallback", () => {
  beforeEach(() => clearLocalRequests());

  it("is idempotent by request id", () => {
    const request = stored();
    setLocalRequest(request);
    setLocalRequest({ ...request, result: { verdict: "BLOCK" } });
    assert.equal(listLocalRequests().length, 1);
    assert.deepEqual(listLocalRequests()[0]?.result, { verdict: "BLOCK" });
  });

  it("counts revenue only after successful completion", () => {
    setLocalRequest(stored());
    setLocalRequest(stored({
      requestId: "0x" + "44".repeat(32),
      status: "failed",
      grossUnits: "250000",
      upstreamCostUnits: "50000",
      retainedUnits: "200000"
    }));
    setLocalRequest(stored({
      requestId: "0x" + "55".repeat(32),
      status: "claimed",
      grossUnits: "250000",
      upstreamCostUnits: "0",
      retainedUnits: "250000"
    }));

    assert.deepEqual(localMetrics(), {
      requestCount: 3,
      completedCount: 1,
      failedCount: 1,
      grossUnits: "100000",
      upstreamCostUnits: "6000",
      retainedUnits: "94000"
    });
  });
});
