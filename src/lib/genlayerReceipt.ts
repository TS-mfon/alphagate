import { abi } from "genlayer-js";

function toPlainValue(value: unknown): unknown {
  if (value instanceof Map) {
    return Object.fromEntries([...value.entries()].map(([key, item]) => [String(key), toPlainValue(item)]));
  }
  if (Array.isArray(value)) return value.map(toPlainValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, toPlainValue(item)])
    );
  }
  return value;
}

function isDecision(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.verdict === "string" || typeof candidate.action === "string";
}

function decodeRawResult(value: string): unknown {
  try {
    const bytes = Uint8Array.from(Buffer.from(value, "base64"));
    if (bytes[0] !== 0) return undefined;
    return toPlainValue(abi.calldata.decode(bytes.slice(1)));
  } catch {
    return undefined;
  }
}

function decisionFrom(value: unknown): Record<string, unknown> | undefined {
  const plain = toPlainValue(value);
  if (isDecision(plain)) return plain;

  if (typeof plain === "string") {
    try {
      const parsed = JSON.parse(plain);
      return decisionFrom(parsed);
    } catch {
      return decisionFrom(decodeRawResult(plain));
    }
  }

  if (!plain || typeof plain !== "object") return undefined;
  const object = plain as Record<string, unknown>;
  for (const key of ["readable", "payload", "result", "return_data", "returnData"]) {
    const candidate = decisionFrom(object[key]);
    if (candidate) return candidate;
  }
  return undefined;
}

export function extractUndeterminedContractResult(
  receipt: Record<string, unknown>
): Record<string, unknown> | undefined {
  const data = receipt.data as Record<string, unknown> | undefined;
  const consensus = (
    receipt.consensus_data
    ?? receipt.consensusData
    ?? data?.consensus_data
    ?? data?.consensusData
  ) as Record<string, unknown> | undefined;
  const rawLeaders = consensus?.leader_receipt ?? consensus?.leaderReceipt;
  const leaders = Array.isArray(rawLeaders) ? rawLeaders : rawLeaders ? [rawLeaders] : [];

  for (const rawLeader of leaders) {
    if (!rawLeader || typeof rawLeader !== "object") continue;
    const leader = rawLeader as Record<string, unknown>;
    const result = decisionFrom(leader.result);
    if (result) return result;

    const outputs = (leader.eq_outputs ?? leader.eqOutputs) as Record<string, unknown> | undefined;
    for (const output of Object.values(outputs ?? {})) {
      const candidate = decisionFrom(output);
      if (candidate) return candidate;
    }
  }
  return undefined;
}
