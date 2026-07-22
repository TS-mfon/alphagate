"use client";

import {
  Activity,
  ArrowUpRight,
  Braces,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  DatabaseZap,
  ExternalLink,
  Gauge,
  RefreshCw,
  Route,
  Send,
  ShieldCheck,
  TriangleAlert,
  WalletCards
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type Service = "trade_guard" | "alpha_router";

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
    mode: "consensus" | "local";
  };
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

export function AlphaGateConsole() {
  const [service, setService] = useState<Service>("trade_guard");
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboard);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [response, setResponse] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
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

  async function submit() {
    setLoading(true);
    setResponse(null);
    setError("");
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
      const result = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await result.json();
      if (!result.ok) throw new Error(payload.message ?? "Request failed");
      setResponse(payload);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed");
    } finally {
      setLoading(false);
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
                {loading ? <Clock3 size={17} /> : <Send size={17} />}
                {loading ? "Processing paid evidence..." : `Run ${service === "trade_guard" ? "TradeGuard" : "AlphaRouter"}`}
              </button>
              {error && <div className="error-line"><TriangleAlert size={16} /> {error}</div>}
            </div>

            <div className="response-panel">
              <div className="panel-title">
                <span><Braces size={17} /> Agent response</span>
                <span className="mono">{response ? "200 OK" : "Awaiting call"}</span>
              </div>
              <pre>{response ? JSON.stringify(response, null, 2) : `{\n  "status": "ready",\n  "service": "${service}"\n}`}</pre>
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
            <InfraRow icon={<WalletCards size={16} />} label="Treasury" value="Base USDC" state="good" />
            <InfraRow icon={<ShieldCheck size={16} />} label="Contract" value={shortHash(dashboard.genlayer.contract)} state={dashboard.genlayer.configured ? "good" : "warn"} />
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
