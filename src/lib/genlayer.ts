import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import type { Hex } from "viem";
import { env } from "./env";
import { AlphaGateError } from "./errors";
import { extractUndeterminedContractResult } from "./genlayerReceipt";
import { getLocalRequest, listLocalRequests, localMetrics, setLocalRequest } from "./localStore";
import { retainedUnits } from "./money";
import type { Metrics, ServiceKind, StoredRequest } from "./types";

type GenLayerHash = Hex & { length: 66 };
type ConsensusStatus = "finalized" | "undetermined";

interface WriteOutcome {
  hash: Hex;
  consensusStatus: ConsensusStatus;
  provisionalResult?: Record<string, unknown>;
}

export const GENLAYER_WAIT_POLICY = {
  intervalMs: 2500,
  defaultRetries: 8,
  analysisRetries: 24,
  failureRetries: 4
} as const;

function configured() {
  return Boolean(env.genlayerPrivateKey && env.genlayerContract);
}

let cachedClient: ReturnType<typeof createClient> | undefined;
let cachedAccount: ReturnType<typeof createAccount> | undefined;

function account() {
  if (!env.genlayerPrivateKey) throw new AlphaGateError("genlayer_unavailable", "GenLayer signer is not configured", 503, true);
  cachedAccount ??= createAccount(env.genlayerPrivateKey);
  return cachedAccount;
}

function client() {
  cachedClient ??= createClient({ chain: studionet, account: account() });
  return cachedClient;
}

async function read<T>(functionName: string, args: unknown[] = []) {
  if (!env.genlayerContract) throw new AlphaGateError("genlayer_unavailable", "GenLayer contract is not configured", 503, true);
  return await client().readContract({
    address: env.genlayerContract,
    functionName,
    args: args as never[],
    jsonSafeReturn: true
  }) as T;
}

async function write(
  functionName: string,
  args: unknown[] = [],
  retries: number = GENLAYER_WAIT_POLICY.defaultRetries
): Promise<WriteOutcome> {
  if (!env.genlayerContract) throw new AlphaGateError("genlayer_unavailable", "GenLayer contract is not configured", 503, true);
  const hash = await client().writeContract({
    account: account(),
    address: env.genlayerContract,
    functionName,
    args: args as never[],
    value: 0n
  }) as Hex;
  let receipt: Record<string, unknown>;
  try {
    receipt = await client().waitForTransactionReceipt({
      hash: hash as GenLayerHash,
      status: TransactionStatus.ACCEPTED,
      retries,
      interval: GENLAYER_WAIT_POLICY.intervalMs
    }) as Record<string, unknown>;
  } catch (error) {
    throw new AlphaGateError(
      "genlayer_pending",
      `GenLayer ${functionName} did not reach a decided state in time`,
      503,
      true,
      {
        transaction_hash: hash,
        cause: error instanceof Error ? error.message : "receipt timeout"
      }
    );
  }

  const resultName = String(receipt.resultName ?? receipt.result_name ?? "");
  const statusName = String(receipt.statusName ?? receipt.status_name ?? "");
  const executionResult = String(receipt.txExecutionResultName ?? receipt.execution_result ?? "");
  if (statusName === "UNDETERMINED" || resultName === "UNDETERMINED") {
    return {
      hash,
      consensusStatus: "undetermined",
      provisionalResult: extractUndeterminedContractResult(receipt)
    };
  }
  if (executionResult.includes("ERROR")) {
    throw new AlphaGateError("genlayer_failed", `GenLayer ${functionName} failed`, 502, true);
  }
  return { hash, consensusStatus: "finalized" };
}

function parseStored(
  raw: Record<string, unknown>,
  transactionHash?: string,
  consensusStatus: StoredRequest["consensusStatus"] = "finalized"
): StoredRequest {
  let result: unknown = {};
  try {
    result = raw.result_json ? JSON.parse(String(raw.result_json)) : {};
  } catch {
    result = {};
  }
  return {
    requestId: String(raw.request_id),
    service: String(raw.service) as ServiceKind,
    status: String(raw.status) as StoredRequest["status"],
    inputHash: String(raw.input_hash ?? ""),
    evidenceHash: String(raw.evidence_hash ?? ""),
    grossUnits: String(raw.gross_units ?? "0"),
    upstreamCostUnits: String(raw.upstream_cost_units ?? "0"),
    retainedUnits: String(raw.retained_units ?? "0"),
    result,
    error: String(raw.error ?? ""),
    createdAt: String(raw.created_at ?? ""),
    updatedAt: String(raw.updated_at ?? ""),
    genlayerTxHash: transactionHash,
    consensusStatus
  };
}

function requireFinalized(outcome: WriteOutcome, operation: string) {
  if (outcome.consensusStatus === "undetermined") {
    throw new AlphaGateError(
      "genlayer_undetermined",
      `GenLayer ${operation} was undetermined and did not finalize state`,
      503,
      true,
      { transaction_hash: outcome.hash }
    );
  }
}

function provisionalStored(
  request: StoredRequest,
  outcome: WriteOutcome,
  evidenceHash: string,
  upstreamCostUnits: bigint
): StoredRequest {
  if (!outcome.provisionalResult) {
    throw new AlphaGateError(
      "genlayer_undetermined",
      "GenLayer consensus was undetermined and no valid contract verdict was recoverable",
      503,
      true,
      { transaction_hash: outcome.hash }
    );
  }
  return {
    ...request,
    status: "completed",
    evidenceHash,
    result: outcome.provisionalResult,
    upstreamCostUnits: upstreamCostUnits.toString(),
    retainedUnits: retainedUnits(BigInt(request.grossUnits), upstreamCostUnits).toString(),
    updatedAt: new Date().toISOString(),
    genlayerTxHash: outcome.hash,
    consensusStatus: "undetermined"
  };
}

function pendingTransactionHash(error: unknown) {
  if (!(error instanceof AlphaGateError) || error.code !== "genlayer_pending") {
    return undefined;
  }
  const hash = error.fields.transaction_hash;
  return typeof hash === "string" ? hash : undefined;
}

export function pendingStored(
  request: StoredRequest,
  transactionHash: string,
  evidenceHash: string,
  result: unknown,
  upstreamCostUnits: bigint
): StoredRequest {
  return {
    ...request,
    status: "completed",
    evidenceHash,
    result,
    upstreamCostUnits: upstreamCostUnits.toString(),
    retainedUnits: retainedUnits(BigInt(request.grossUnits), upstreamCostUnits).toString(),
    updatedAt: new Date().toISOString(),
    genlayerTxHash: transactionHash,
    consensusStatus: "pending"
  };
}

async function recoverCompletedRequest(requestId: string, transactionHash: string) {
  try {
    const stored = parseStored(
      await read<Record<string, unknown>>("get_request", [requestId]),
      transactionHash
    );
    return stored.status === "completed" ? stored : undefined;
  } catch {
    return undefined;
  }
}

export async function getRequest(requestId: string) {
  if (!configured()) return getLocalRequest(requestId);
  try {
    return parseStored(await read<Record<string, unknown>>("get_request", [requestId]));
  } catch {
    return undefined;
  }
}

export async function claimRequest(
  requestId: string,
  service: ServiceKind,
  inputHash: string,
  grossUnits: bigint
) {
  if (!configured()) {
    const existing = getLocalRequest(requestId);
    if (existing) return existing;
    if (env.requireGenLayer) throw new AlphaGateError("genlayer_unavailable", "GenLayer is required in this environment", 503, true);
    const now = new Date().toISOString();
    const request: StoredRequest = {
      requestId,
      service,
      status: "claimed",
      inputHash,
      evidenceHash: "",
      grossUnits: grossUnits.toString(),
      upstreamCostUnits: "0",
      retainedUnits: grossUnits.toString(),
      result: {},
      error: "",
      createdAt: now,
      updatedAt: now,
      consensusStatus: "not_used"
    };
    setLocalRequest(request);
    return request;
  }

  const outcome = await write("claim_request", [requestId, service, inputHash, grossUnits]);
  requireFinalized(outcome, "claim");
  const request = parseStored(await read<Record<string, unknown>>("get_request", [requestId]), outcome.hash);
  return request;
}

function localFinalize(
  requestId: string,
  evidenceHash: string,
  result: unknown,
  upstreamCostUnits: bigint,
  mode: "local" | "deterministic"
) {
  const request = getLocalRequest(requestId);
  if (!request) throw new AlphaGateError("request_missing", "Request claim was not found", 409);
  const updated: StoredRequest = {
    ...request,
    status: "completed",
    evidenceHash,
    result: { ...(result as Record<string, unknown>), _mode: mode },
    upstreamCostUnits: upstreamCostUnits.toString(),
    retainedUnits: retainedUnits(BigInt(request.grossUnits), upstreamCostUnits).toString(),
    updatedAt: new Date().toISOString(),
    consensusStatus: "not_used"
  };
  setLocalRequest(updated);
  return updated;
}

export async function finalizeDeterministic(
  requestId: string,
  evidenceHash: string,
  result: unknown,
  upstreamCostUnits: bigint
) {
  if (!configured()) return localFinalize(requestId, evidenceHash, result, upstreamCostUnits, "deterministic");
  const request = await getRequest(requestId);
  if (!request) throw new AlphaGateError("request_missing", "Request claim was not found", 409);
  let outcome: WriteOutcome;
  try {
    outcome = await write("finalize_deterministic", [
      requestId,
      evidenceHash,
      JSON.stringify(result),
      upstreamCostUnits
    ]);
  } catch (error) {
    const transactionHash = pendingTransactionHash(error);
    if (!transactionHash) throw error;

    const recovered = await recoverCompletedRequest(requestId, transactionHash);
    if (recovered) return recovered;

    return pendingStored(
      request,
      transactionHash,
      evidenceHash,
      result,
      upstreamCostUnits
    );
  }
  if (outcome.consensusStatus === "undetermined") {
    return provisionalStored(request, outcome, evidenceHash, upstreamCostUnits);
  }
  return parseStored(await read<Record<string, unknown>>("get_request", [requestId]), outcome.hash);
}

export async function analyzeRequest(
  requestId: string,
  intent: unknown,
  evidence: unknown,
  evidenceHash: string,
  upstreamCostUnits: bigint,
  localResult: unknown
) {
  if (!configured()) {
    if (env.requireGenLayer) throw new AlphaGateError("genlayer_unavailable", "GenLayer is required in this environment", 503, true);
    return localFinalize(requestId, evidenceHash, localResult, upstreamCostUnits, "local");
  }
  const request = await getRequest(requestId);
  if (!request) throw new AlphaGateError("request_missing", "Request claim was not found", 409);
  const outcome = await write("analyze_request", [
    requestId,
    JSON.stringify(intent),
    JSON.stringify(evidence),
    evidenceHash,
    upstreamCostUnits
  ], GENLAYER_WAIT_POLICY.analysisRetries);
  if (outcome.consensusStatus === "undetermined") {
    return provisionalStored(request, outcome, evidenceHash, upstreamCostUnits);
  }
  return parseStored(await read<Record<string, unknown>>("get_request", [requestId]), outcome.hash);
}

export async function failRequest(requestId: string, error: string) {
  if (!configured()) {
    const request = getLocalRequest(requestId);
    if (request?.status === "claimed") {
      setLocalRequest({ ...request, status: "failed", error, updatedAt: new Date().toISOString() });
    }
    return;
  }
  try {
    await write("fail_request", [requestId, error], GENLAYER_WAIT_POLICY.failureRetries);
  } catch {
    // Preserve the original request failure.
  }
}

export async function listRequests(limit = 50) {
  if (!configured()) return listLocalRequests(limit);
  const raw = await read<Array<Record<string, unknown>>>("list_requests", [BigInt(limit)]);
  return raw.map(item => parseStored(item));
}

export async function getMetrics(): Promise<Metrics> {
  if (!configured()) return localMetrics();
  const raw = await read<Record<string, unknown>>("get_metrics");
  return {
    requestCount: Number(raw.request_count ?? 0),
    completedCount: Number(raw.completed_count ?? 0),
    failedCount: Number(raw.failed_count ?? 0),
    grossUnits: String(raw.gross_units ?? "0"),
    upstreamCostUnits: String(raw.upstream_cost_units ?? "0"),
    retainedUnits: String(raw.retained_units ?? "0")
  };
}

export function genlayerConfiguration() {
  return {
    configured: configured(),
    contract: env.genlayerContract,
    operator: configured() ? account().address : undefined,
    mode: configured() ? "consensus" as const : "local" as const
  };
}
