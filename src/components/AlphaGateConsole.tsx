"use client";

import { ExactEvmScheme } from "@x402/evm";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import {
  Activity,
  ArrowUpRight,
  Braces,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Copy,
  DatabaseZap,
  ExternalLink,
  Gauge,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Route,
  Send,
  ShieldCheck,
  TriangleAlert,
  WalletCards
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type Service = "trade_guard" | "alpha_router";
type RequestPhase = "idle" | "connecting" | "paying" | "complete";

interface UiError {
  title: string;
  detail: string;
  retryable: boolean;
}

interface RequestRecord {
  requestId: string;
  service: Service;
  status: "claimed" | "completed" | "failed";
  grossUnits: string;
  upstreamCostUnits: string;
  retainedUnits: string;
  result: Record<string, unknown>;
  createdAt: string;
}

interface DashboardData {
  requests: RequestRecord[];
  metrics: {
    requestCount: number;
    completedCount: number;
    failedCount: number;
    grossUnits: string;
    upstreamCostUnits: string;
    retainedUnits: string;
  };
  genlayer: {
    configured: boolean;
    contract?: string;
    operator?: string;
    mode: "consensus" | "local";
  };
  treasury?: string;
}

const emptyDashboard: DashboardData = {
  requests: [],
  metrics: {
    requestCount: 0,
    completedCount: 0,
    failedCount: 0,
    grossUnits: "0",
    upstreamCostUnits: "0",
    retainedUnits: "0"
  },
  genlayer: { configured: false, mode: "local" }
};

function formatUsdc(units: string) {
  const value = BigInt(units || "0");
  const raw = value.toString().padStart(7, "0");
  const whole = raw.slice(0, -6);
  const fraction = raw.slice(-6).replace(/0+$/, "");
  return `$${whole}${fraction ? `.${fraction}` : ""}`;
}

function shortHash(value?: string) {
  if (!value) return "Not configured";
  return `${value.slice(0, 7)}...${value.slice(-5)}`;
}

function nowKey(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}`;
}

interface BrowserEthereum {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const SERVICE_PRICES: Record<Service, string> = {
  trade_guard: "100000",
  alpha_router: "250000"
};

function browserEthereum() {
  return (window as Window & { ethereum?: BrowserEthereum }).ethereum;
}

function jsonTypedData(value: unknown) {
  return JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item);
}

async function connectBasePayer() {
  const ethereum = browserEthereum();
  if (!ethereum) {
    throw new Error("wallet_missing");
  }

  const accounts = await ethereum.request({ method: "eth_requestAccounts" }) as string[];
  const address = accounts[0] as `0x${string}` | undefined;
  if (!address) throw new Error("No wallet account was selected.");

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x2105" }]
    });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 4902) throw error;
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: "0x2105",
        chainName: "Base",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: ["https://mainnet.base.org"],
        blockExplorerUrls: ["https://basescan.org"]
      }]
    });
  }

  return { address, ethereum };
}

function paymentFetch(
  address: `0x${string}`,
  ethereum: BrowserEthereum,
  service: Service,
  treasury: string
) {
  const signer = {
    address,
    async signTypedData(message: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) {
      return await ethereum.request({
        method: "eth_signTypedData_v4",
        params: [address, jsonTypedData(message)]
      }) as `0x${string}`;
    }
  };

  return wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{
      network: "eip155:8453",
      client: new ExactEvmScheme(signer)
    }],
    policies: [(_version, requirements) => requirements.filter(requirement =>
      requirement.scheme === "exact"
      && requirement.network === "eip155:8453"
      && requirement.asset.toLowerCase() === BASE_USDC.toLowerCase()
      && requirement.payTo.toLowerCase() === treasury.toLowerCase()
      && requirement.amount === SERVICE_PRICES[service]
      && (
        requirement.extra?.assetTransferMethod === undefined
        || requirement.extra.assetTransferMethod === "eip3009"
      )
    )]
  });
}

async function responsePayload(result: Response) {
  const text = await result.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text.slice(0, 500) };
  }
}

function readableError(caught: unknown): UiError {
  const error = caught as { code?: number; message?: string };
  const message = error?.message ?? "";

  if (message === "wallet_missing") {
    return {
      title: "Wallet not found",
      detail: "Install or enable an EVM wallet, then reconnect on Base.",
      retryable: true
    };
  }
  if (error?.code === 4001 || /rejected|denied/i.test(message)) {
    return {
      title: "Request cancelled",
      detail: "The wallet signature was not approved. No payment was sent.",
      retryable: true
    };
  }
  if (/insufficient|balance/i.test(message)) {
    return {
      title: "Insufficient USDC",
      detail: "The connected wallet needs enough Base USDC for this service.",
      retryable: true
    };
  }
  return {
    title: "Request failed",
    detail: message || "The service could not complete the paid request.",
    retryable: true
  };
}

function responseError(result: Response, payload: Record<string, unknown>): UiError {
  const header = result.headers.get("PAYMENT-REQUIRED");
  if (header) {
    try {
      const challenge = JSON.parse(atob(header)) as { error?: string };
      if (challenge.error) {
        return {
          title: "Payment was not settled",
          detail: challenge.error,
          retryable: true
        };
      }
    } catch {
      // Fall back to the HTTP status when a proxy returns a malformed challenge.
    }
  }

  return {
    title: typeof payload.error === "string" ? payload.error.replaceAll("_", " ") : "Request failed",
    detail: typeof payload.message === "string"
      ? payload.message
      : `The service returned HTTP ${result.status}.`,
    retryable: payload.retryable !== false
  };
}

function resultLabel(service: Service, result: Record<string, unknown>) {
  if (service === "trade_guard") return String(result.verdict ?? "Completed");
  return String(result.action ?? "Completed");
}

export function AlphaGateConsole() {
  const [service, setService] = useState<Service>("trade_guard");
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboard);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<RequestPhase>("idle");
  const [refreshing, setRefreshing] = useState(false);
  const [response, setResponse] = useState<Record<string, unknown> | null>(null);
  const [responseView, setResponseView] = useState<"summary" | "json">("summary");
  const [error, setError] = useState<UiError | null>(null);
  const [payer, setPayer] = useState("");
  const [guardForm, setGuardForm] = useState({
    assetType: "pair",
    asset: "BTC-USDT",
    side: "buy",
    position: "500",
    timeframe: "4h",
    maxLoss: "2"
  });
  const [routerForm, setRouterForm] = useState({
    assetType: "pair",
    asset: "ETH-USDT",
    bias: "neutral",
    timeframe: "4h",
    riskBudget: "25",
    portfolio: "2500"
  });

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await fetch("/api/v1/requests", { cache: "no-store" });
      if (result.ok) setDashboard(await result.json());
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 12_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const margin = useMemo(() => {
    const gross = BigInt(dashboard.metrics.grossUnits || "0");
    const retained = BigInt(dashboard.metrics.retainedUnits || "0");
    if (gross === 0n) return "0%";
    return `${Number((retained * 10_000n) / gross) / 100}%`;
  }, [dashboard.metrics]);

  async function connectWallet() {
    setError(null);
    setPhase("connecting");
    try {
      const wallet = await connectBasePayer();
      setPayer(wallet.address);
      return wallet;
    } catch (caught) {
      setError(readableError(caught));
      throw caught;
    } finally {
      setPhase(current => current === "connecting" ? "idle" : current);
    }
  }

  async function submit() {
    setLoading(true);
    setPhase("connecting");
    setResponse(null);
    setResponseView("summary");
    setError(null);
    const endpoint = service === "trade_guard" ? "/api/v1/trade-guard" : "/api/v1/alpha-router";
    const body = service === "trade_guard"
      ? {
          asset: { type: guardForm.assetType, value: guardForm.asset },
          side: guardForm.side,
          position_usd: guardForm.position,
          timeframe: guardForm.timeframe,
          max_loss_pct: guardForm.maxLoss,
          idempotency_key: nowKey("guard")
        }
      : {
          asset: { type: routerForm.assetType, value: routerForm.asset },
          bias: routerForm.bias,
          timeframe: routerForm.timeframe,
          risk_budget_usd: routerForm.riskBudget,
          portfolio_value_usd: routerForm.portfolio,
          idempotency_key: nowKey("route")
        };

    try {
      if (!dashboard.treasury) {
        throw new Error("The service treasury is not available. Refresh and try again.");
      }
      const wallet = await connectBasePayer();
      setPayer(wallet.address);
      setPhase("paying");
      const paidFetch = paymentFetch(wallet.address, wallet.ethereum, service, dashboard.treasury);
      const result = await paidFetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await responsePayload(result);
      if (!result.ok) {
        setError(responseError(result, payload));
        return;
      }
      setResponse(payload);
      setPhase("complete");
      await refresh();
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setLoading(false);
      setPhase(current => current === "complete" ? current : "idle");
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><ShieldCheck size={20} /></div>
          <div>
            <strong>AlphaGate</strong>
            <span>Agent trading intelligence</span>
          </div>
        </div>
        <div className="topbar-actions">
          <span className={`status-dot ${dashboard.genlayer.configured ? "live" : "local"}`}>
            {dashboard.genlayer.configured ? "GenLayer live" : "Local mode"}
          </span>
          <button
            className={`wallet-button ${payer ? "connected" : ""}`}
            onClick={() => void connectWallet()}
            disabled={phase === "connecting" || loading}
          >
            {phase === "connecting" ? <LoaderCircle size={16} className="spin" /> : <WalletCards size={16} />}
            {payer ? shortHash(payer) : "Connect wallet"}
          </button>
          <button className="icon-button" onClick={() => void refresh()} title="Refresh dashboard" aria-label="Refresh dashboard">
            <RefreshCw size={17} className={refreshing ? "spin" : ""} />
          </button>
        </div>
      </header>

      <section className="metrics-band">
        <Metric icon={<Activity size={18} />} label="Completed calls" value={String(dashboard.metrics.completedCount)} tone="green" />
        <Metric icon={<CircleDollarSign size={18} />} label="Gross revenue" value={formatUsdc(dashboard.metrics.grossUnits)} tone="blue" />
        <Metric icon={<ArrowUpRight size={18} />} label="Upstream spend" value={formatUsdc(dashboard.metrics.upstreamCostUnits)} tone="amber" />
        <Metric icon={<WalletCards size={18} />} label="Retained margin" value={formatUsdc(dashboard.metrics.retainedUnits)} detail={margin} tone="pink" />
      </section>

      <div className="workspace">
        <section className="service-console">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Service console</p>
              <h1>Price the evidence. Gate the trade.</h1>
            </div>
            <div className="segmented" role="tablist" aria-label="AlphaGate service">
              <button className={service === "trade_guard" ? "active" : ""} onClick={() => setService("trade_guard")}>
                <ShieldCheck size={16} /> TradeGuard
              </button>
              <button className={service === "alpha_router" ? "active" : ""} onClick={() => setService("alpha_router")}>
                <Route size={16} /> AlphaRouter
              </button>
            </div>
          </div>

          <div className="console-grid">
            <div className="form-panel">
              <div className="price-row">
                <span>{service === "trade_guard" ? "Pre-trade risk verdict" : "Consensus-backed trade plan"}</span>
                <strong>{service === "trade_guard" ? "0.10" : "0.25"} USDC</strong>
              </div>

              {service === "trade_guard" ? (
                <GuardForm value={guardForm} onChange={setGuardForm} />
              ) : (
                <RouterForm value={routerForm} onChange={setRouterForm} />
              )}

              <button className="primary-button" onClick={() => void submit()} disabled={loading}>
                {loading ? <LoaderCircle size={17} className="spin" /> : <Send size={17} />}
                {phase === "connecting"
                  ? "Connecting wallet..."
                  : phase === "paying"
                    ? "Authorizing payment and analysis..."
                    : `Run ${service === "trade_guard" ? "TradeGuard" : "AlphaRouter"}`}
              </button>
              <div className="payment-assurance">
                <LockKeyhole size={15} />
                <span>Base USDC only</span>
                <i />
                <span>{service === "trade_guard" ? "0.10" : "0.25"} USDC maximum</span>
                <i />
                <span>AlphaGate treasury only</span>
              </div>
              {payer && <div className="payer-line"><WalletCards size={15} /> Connected <span className="mono">{shortHash(payer)}</span></div>}
              {error && (
                <div className="error-box" role="alert">
                  <TriangleAlert size={18} />
                  <div>
                    <strong>{error.title}</strong>
                    <span>{error.detail}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="response-panel">
              <div className="panel-title">
                <span><Braces size={17} /> Agent response</span>
                {response ? (
                  <div className="response-tabs">
                    <button className={responseView === "summary" ? "active" : ""} onClick={() => setResponseView("summary")}>Summary</button>
                    <button className={responseView === "json" ? "active" : ""} onClick={() => setResponseView("json")}>JSON</button>
                  </div>
                ) : <span className="mono">{loading ? "Processing" : "Awaiting call"}</span>}
              </div>
              {response && responseView === "summary"
                ? <ResponseSummary payload={response} service={service} />
                : <JsonResponse payload={response} service={service} />}
            </div>
          </div>
        </section>

        <aside className="rail">
          <section className="rail-section">
            <div className="rail-heading">
              <span>Infrastructure</span>
              <Gauge size={16} />
            </div>
            <InfraRow icon={<DatabaseZap size={16} />} label="Persistence" value="GenLayer only" state="good" />
            <InfraRow icon={<WalletCards size={16} />} label="Treasury" value={shortHash(dashboard.treasury)} state="good" />
            <InfraRow icon={<ShieldCheck size={16} />} label="Contract" value={shortHash(dashboard.genlayer.contract)} state={dashboard.genlayer.configured ? "good" : "warn"} />
            <InfraRow icon={<ShieldCheck size={16} />} label="Operator" value={shortHash(dashboard.genlayer.operator)} state={dashboard.genlayer.configured ? "good" : "warn"} />
          </section>

          <section className="rail-section">
            <div className="rail-heading">
              <span>Paid sources</span>
              <ExternalLink size={15} />
            </div>
            <Provider name="n0brains" role="Directional signals" price="$0.005" />
            <Provider name="TradeSnack" role="Technical confirmation" price="$0.010" />
            <Provider name="Otto AI" role="Market news" price="$0.001" />
            <Provider name="Token Safety" role="Base contract risk" price="$0.050" />
          </section>
        </aside>
      </div>

      <section className="activity-table">
        <div className="table-heading">
          <div>
            <p className="eyebrow">On-chain activity</p>
            <h2>Recent requests</h2>
          </div>
          <span>{dashboard.metrics.requestCount} total</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Request</th>
                <th>Service</th>
                <th>Status</th>
                <th>Gross</th>
                <th>Upstream</th>
                <th>Retained</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.requests.length === 0 ? (
                <tr><td colSpan={7} className="empty-row">No requests recorded yet.</td></tr>
              ) : dashboard.requests.map(request => (
                <tr key={request.requestId}>
                  <td className="mono">{shortHash(request.requestId)}</td>
                  <td>{request.service === "trade_guard" ? "TradeGuard" : "AlphaRouter"}</td>
                  <td><Status status={request.status} /></td>
                  <td>{formatUsdc(request.grossUnits)}</td>
                  <td>{formatUsdc(request.upstreamCostUnits)}</td>
                  <td className="retained">{formatUsdc(request.retainedUnits)}</td>
                  <td>{request.createdAt ? new Date(request.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function JsonResponse({ payload, service }: { payload: Record<string, unknown> | null; service: Service }) {
  const text = payload
    ? JSON.stringify(payload, null, 2)
    : `{\n  "status": "ready",\n  "service": "${service}"\n}`;

  return (
    <div className="json-wrap">
      {payload && (
        <button
          className="copy-button"
          onClick={() => void navigator.clipboard.writeText(text)}
          title="Copy JSON"
          aria-label="Copy JSON"
        >
          <Copy size={15} />
        </button>
      )}
      <pre>{text}</pre>
    </div>
  );
}

function ResponseSummary({ payload, service }: { payload: Record<string, unknown>; service: Service }) {
  const result = (payload.result ?? {}) as Record<string, unknown>;
  const payment = (payload.payment_trace ?? {}) as Record<string, unknown>;
  const genlayer = (payload.genlayer ?? {}) as Record<string, unknown>;
  const reasons = Array.isArray(result.reasons) ? result.reasons.map(String) : [];
  const verdict = resultLabel(service, result);
  const provisional = genlayer.consensusStatus === "undetermined";
  const tone = verdict === "BLOCK" || verdict === "WAIT"
    ? "danger"
    : verdict === "SIZE_DOWN"
      ? "warning"
      : "success";

  return (
    <div className="result-summary">
      <div className={`verdict-block ${tone}`}>
        <span>{service === "trade_guard" ? "Verdict" : "Action"}</span>
        <strong>{verdict}</strong>
        <small>{provisional ? "Provisional contract output" : "Completed and recorded"}</small>
      </div>

      <div className="result-stats">
        {result.risk_score !== undefined && <ResultStat label="Risk score" value={String(result.risk_score)} />}
        {result.confidence !== undefined && <ResultStat label="Confidence" value={String(result.confidence)} />}
        {result.max_position_usd !== undefined && <ResultStat label="Max position" value={`$${result.max_position_usd}`} />}
        <ResultStat label="Charged" value={formatUsdc(String(payment.grossUnits ?? "0"))} />
        <ResultStat label="Evidence cost" value={formatUsdc(String(payment.upstreamCostUnits ?? "0"))} />
        <ResultStat label="Consensus" value={String(genlayer.consensusStatus ?? "not used")} />
      </div>

      {reasons.length > 0 && (
        <div className="reason-list">
          <span>Decision factors</span>
          {reasons.map(reason => <div key={reason}><CheckCircle2 size={14} />{reason}</div>)}
        </div>
      )}

      <div className="proof-strip">
        <span><LockKeyhole size={14} /> Request</span>
        <code>{shortHash(String(payload.request_id ?? ""))}</code>
        <span><DatabaseZap size={14} /> Evidence</span>
        <code>{shortHash(String(genlayer.evidenceHash ?? ""))}</code>
      </div>
    </div>
  );
}

function ResultStat({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function Metric({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: string; detail?: string; tone: string }) {
  return (
    <div className={`metric ${tone}`}>
      <span className="metric-icon">{icon}</span>
      <div><span>{label}</span><strong>{value}</strong></div>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function GuardForm({ value, onChange }: { value: any; onChange: (value: any) => void }) {
  return (
    <div className="fields">
      <AssetFields value={value} onChange={onChange} />
      <label>Side<select value={value.side} onChange={event => onChange({ ...value, side: event.target.value })}><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
      <label>Position size (USD)<input value={value.position} onChange={event => onChange({ ...value, position: event.target.value })} /></label>
      <label>Timeframe<select value={value.timeframe} onChange={event => onChange({ ...value, timeframe: event.target.value })}><option>1h</option><option>4h</option><option>1d</option></select></label>
      <label>Maximum loss (%)<input value={value.maxLoss} onChange={event => onChange({ ...value, maxLoss: event.target.value })} /></label>
    </div>
  );
}

function RouterForm({ value, onChange }: { value: any; onChange: (value: any) => void }) {
  return (
    <div className="fields">
      <AssetFields value={value} onChange={onChange} />
      <label>Existing bias<select value={value.bias} onChange={event => onChange({ ...value, bias: event.target.value })}><option value="neutral">Neutral</option><option value="bullish">Bullish</option><option value="bearish">Bearish</option></select></label>
      <label>Timeframe<select value={value.timeframe} onChange={event => onChange({ ...value, timeframe: event.target.value })}><option>1h</option><option>4h</option><option>1d</option></select></label>
      <label>Risk budget (USD)<input value={value.riskBudget} onChange={event => onChange({ ...value, riskBudget: event.target.value })} /></label>
      <label>Portfolio value (USD)<input value={value.portfolio} onChange={event => onChange({ ...value, portfolio: event.target.value })} /></label>
    </div>
  );
}

function AssetFields({ value, onChange }: { value: any; onChange: (value: any) => void }) {
  return (
    <>
      <label>Asset type<select value={value.assetType} onChange={event => onChange({ ...value, assetType: event.target.value, asset: event.target.value === "pair" ? "BTC-USDT" : "0x" })}><option value="pair">Liquid pair</option><option value="base_token">Base token</option></select></label>
      <label className="span-two">{value.assetType === "pair" ? "Trading pair" : "Base contract address"}<input value={value.asset} onChange={event => onChange({ ...value, asset: event.target.value })} /></label>
    </>
  );
}

function InfraRow({ icon, label, value, state }: { icon: React.ReactNode; label: string; value: string; state: "good" | "warn" }) {
  return <div className="infra-row"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div><i className={state} /></div>;
}

function Provider({ name, role, price }: { name: string; role: string; price: string }) {
  return <div className="provider"><div><strong>{name}</strong><span>{role}</span></div><code>{price}</code></div>;
}

function Status({ status }: { status: RequestRecord["status"] }) {
  const icon = status === "completed" ? <CheckCircle2 size={14} /> : status === "failed" ? <TriangleAlert size={14} /> : <Clock3 size={14} />;
  return <span className={`request-status ${status}`}>{icon}{status}</span>;
}
