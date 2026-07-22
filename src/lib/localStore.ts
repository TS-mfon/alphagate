import type { Metrics, StoredRequest } from "./types";

const globalStore = globalThis as typeof globalThis & {
  __alphaGateRequests?: Map<string, StoredRequest>;
};

const requests = globalStore.__alphaGateRequests ??= new Map<string, StoredRequest>();

export function getLocalRequest(requestId: string) {
  return requests.get(requestId);
}

export function setLocalRequest(request: StoredRequest) {
  requests.set(request.requestId, request);
}

export function clearLocalRequests() {
  requests.clear();
}

export function listLocalRequests(limit = 50) {
  return [...requests.values()]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}

export function localMetrics(): Metrics {
  let gross = 0n;
  let cost = 0n;
  let completed = 0;
  let failed = 0;

  for (const request of requests.values()) {
    if (request.status === "completed") {
      gross += BigInt(request.grossUnits || "0");
      cost += BigInt(request.upstreamCostUnits || "0");
      completed += 1;
    }
    if (request.status === "failed") failed += 1;
  }

  return {
    requestCount: requests.size,
    completedCount: completed,
    failedCount: failed,
    grossUnits: gross.toString(),
    upstreamCostUnits: cost.toString(),
    retainedUnits: (gross > cost ? gross - cost : 0n).toString()
  };
}
