export type ServiceKind = "trade_guard" | "alpha_router";
export type AssetKind = "pair" | "base_token";
export type RequestStatus = "claimed" | "completed" | "failed";

export interface AssetInput {
  type: AssetKind;
  value: string;
}

export interface EvidenceItem {
  provider: string;
  kind: string;
  costUnits: string;
  observedAt: string;
  receipt?: string;
  data: unknown;
}

export interface PaymentTrace {
  network: "eip155:196";
  asset: "USDT0";
  grossUnits: string;
  upstreamCostUnits: string;
  retainedUnits: string;
  upstreamPayments: Array<{
    provider: string;
    costUnits: string;
    receipt?: string;
  }>;
}

export interface GenLayerProof {
  used: boolean;
  mode: "consensus" | "deterministic" | "local";
  consensusStatus: "finalized" | "undetermined" | "pending" | "not_used";
  authoritative: boolean;
  contract?: string;
  transactionHash?: string;
  evidenceHash: string;
}

export interface StoredRequest {
  requestId: string;
  service: ServiceKind;
  status: RequestStatus;
  inputHash: string;
  evidenceHash: string;
  grossUnits: string;
  upstreamCostUnits: string;
  retainedUnits: string;
  result: unknown;
  error: string;
  createdAt: string;
  updatedAt: string;
  genlayerTxHash?: string;
  consensusStatus?: "finalized" | "undetermined" | "pending" | "not_used";
}

export interface Metrics {
  requestCount: number;
  completedCount: number;
  failedCount: number;
  grossUnits: string;
  upstreamCostUnits: string;
  retainedUnits: string;
}
