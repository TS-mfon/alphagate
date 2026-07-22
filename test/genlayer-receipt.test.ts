import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { abi } from "genlayer-js";
import { extractUndeterminedContractResult } from "../src/lib/genlayerReceipt";

describe("GenLayer undetermined receipt handling", () => {
  it("extracts a TradeGuard verdict from a decoded leader result", () => {
    const verdict = {
      verdict: "SIZE_DOWN",
      risk_score: 64,
      max_position_usd: "175",
      reasons: ["Signals conflict."]
    };
    const receipt = {
      statusName: "UNDETERMINED",
      consensus_data: {
        leader_receipt: [{
          result: {
            status: "return",
            payload: { readable: JSON.stringify(verdict) }
          }
        }]
      }
    };

    assert.deepEqual(extractUndeterminedContractResult(receipt), verdict);
  });

  it("extracts an AlphaRouter action from a raw GenVM return payload", () => {
    const action = {
      action: "WAIT",
      confidence: "low",
      entry: null,
      stop: null,
      targets: [],
      position_size_usd: "0",
      risk_reward: "0",
      invalidation: "Wait for fresh evidence.",
      reasons: ["Evidence conflicts."]
    };
    const encoded = abi.calldata.encode(action);
    const raw = Buffer.concat([Buffer.from([0]), Buffer.from(encoded)]).toString("base64");
    const receipt = {
      resultName: "UNDETERMINED",
      consensusData: {
        leaderReceipt: [{ result: raw }]
      }
    };

    assert.deepEqual(extractUndeterminedContractResult(receipt), action);
  });

  it("uses a contract equivalence output when the leader result is unavailable", () => {
    const verdict = { verdict: "ALLOW", risk_score: 18 };
    const receipt = {
      consensus_data: {
        leader_receipt: [{
          result: null,
          eq_outputs: {
            analysis: { payload: { readable: JSON.stringify(verdict) } }
          }
        }]
      }
    };

    assert.deepEqual(extractUndeterminedContractResult(receipt), verdict);
  });

  it("does not fabricate a verdict from an empty receipt", () => {
    assert.equal(extractUndeterminedContractResult({ statusName: "UNDETERMINED" }), undefined);
  });
});
