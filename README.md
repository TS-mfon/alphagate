# AlphaGate

AlphaGate is a paid agent-to-agent trading intelligence service for the OKX.AI
Genesis Hackathon. It sells risk decisions through x402, spends part of each
payment on paid Bazaar evidence, and records the request lifecycle and accounting
on GenLayer.

AlphaGate provides two services:

- `TradeGuard` costs `0.10 USDC` and returns `ALLOW`, `BLOCK`, or `SIZE_DOWN`.
- `AlphaRouter` costs `0.25 USDC` and returns `LONG`, `SHORT`, or `WAIT` with
  entry, stop, targets, sizing, confidence, and invalidation.

AlphaGate provides decision support only. It never signs or executes a trade.

## Architecture

```text
OKX.AI caller
  -> AlphaGate x402 endpoint on Base
  -> deterministic risk gates
  -> paid x402 Bazaar evidence from the AlphaGate treasury
  -> GenLayer consensus when judgment is required
  -> response with evidence hash, payment trace, and decision
```

There is no database. In production, GenLayer stores request state, results,
evidence hashes, gross revenue, upstream cost, and retained revenue. Process
memory is used only for active-request locks. Local fixture mode includes a
memory-only fallback so the product can be demonstrated without funded wallets;
that state intentionally resets when the process restarts.

## Services

### TradeGuard

`POST /api/v1/trade-guard`

```json
{
  "asset": { "type": "pair", "value": "BTC-USDT" },
  "side": "buy",
  "position_usd": "500",
  "timeframe": "4h",
  "max_loss_pct": "2",
  "thesis": "Optional agent thesis",
  "idempotency_key": "agent-order-0001"
}
```

Hard safety failures are deterministic. Borderline evidence is sent to GenLayer
for comparative consensus.

### AlphaRouter

`POST /api/v1/alpha-router`

```json
{
  "asset": { "type": "pair", "value": "ETH-USDT" },
  "bias": "neutral",
  "timeframe": "4h",
  "risk_budget_usd": "25",
  "portfolio_value_usd": "2500",
  "idempotency_key": "agent-plan-0001"
}
```

Every AlphaRouter plan uses GenLayer consensus in production.

Both services also accept Base ERC-20 contract addresses:

```json
{ "type": "base_token", "value": "0x0000000000000000000000000000000000000000" }
```

## Undetermined Consensus

If GenLayer reaches `UNDETERMINED`, AlphaGate attempts to decode the candidate
decision returned by the contract leader receipt. A recoverable candidate is
returned with:

```json
{
  "genlayer": {
    "consensusStatus": "undetermined",
    "authoritative": false
  }
}
```

This lets an agent inspect the contract-produced verdict without mistaking it
for finalized consensus. The on-chain request remains claimable for a later
retry. If the receipt contains no valid contract decision, AlphaGate returns a
retryable `genlayer_undetermined` error instead of fabricating a fallback.

## Local Development

Requirements:

- Node.js 20 or newer
- Python 3.12 or newer
- A local virtual environment with `genvm-linter`, `genlayer-test`, and `pytest`
  for contract validation

```bash
cp .env.example .env.local
npm install
npm run dev
```

The default configuration uses local upstream fixtures, disables incoming x402,
and uses process memory for demo state. Open `http://localhost:3000`.

Useful checks:

```bash
npm test
npm run test:genlayer
npm run lint
npm run typecheck
npm run lint:genlayer
npm run build
```

## Production Configuration

Set these values in the deployment environment:

```dotenv
NEXT_PUBLIC_APP_URL=https://your-domain.example
X402_ENABLED=true
X402_PAY_TO=0xYourBaseTreasuryAddress
X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402
TREASURY_PRIVATE_KEY=0xBaseTreasurySignerPrivateKey
LIVE_UPSTREAMS=true
REQUIRE_GENLAYER=true
GENLAYER_PRIVATE_KEY=0xGenLayerOperatorPrivateKey
GENLAYER_CONTRACT_ADDRESS=0xDeployedContractAddress
```

The Base treasury needs enough USDC for paid upstream requests. Keep the Base
treasury signer separate from the GenLayer operator when operationally possible.
Never expose either private key through a `NEXT_PUBLIC_` variable.

## Deploy GenLayer

The deployment script uses the configured GenLayer private key as the contract
operator and `X402_PAY_TO` as the recorded treasury:

```bash
set -a
source .env.local
set +a
npm run contract:deploy
```

Copy the emitted contract address into `GENLAYER_CONTRACT_ADDRESS`, redeploy the
web service, then verify:

```bash
curl http://localhost:3000/api/health
```

Production health should report x402 enabled, live upstreams enabled, GenLayer
configured, and persistence set to `genlayer`.

## Bazaar Sources

The current routing uses low-cost specialist services:

| Provider | Purpose | Cost per call |
| --- | --- | ---: |
| n0brains | Directional signals | `0.005 USDC` |
| TradeSnack | Technical analysis | `0.010 USDC` |
| Otto AI | Market news | `0.001 USDC` |
| Token Safety Check | Base token contract risk | `0.050 USDC` |
| ApiToll | Base token price history | `0.001 USDC` |
| Crypto OHLC Candles | Pair candles | `0.005 USDC` |

Endpoint URLs are configurable through the `UPSTREAM_*_URL` environment
variables, so a provider can be replaced without changing orchestration logic.

## OKX.AI Listing

List both paid endpoints as separate ASP services:

- TradeGuard: `/api/v1/trade-guard`
- AlphaRouter: `/api/v1/alpha-router`

The x402 route configuration includes Bazaar input/output metadata for discovery.
Before submission, run one paid request against each production endpoint and
confirm the payment receipt, upstream receipts, GenLayer evidence hash, and
request accounting are all present in the response.
