# AlphaGate

AlphaGate is a paid trading-intelligence ASP built for the OKX.AI Genesis
Hackathon. Autonomous agents and browser users can purchase pre-trade risk
decisions and risk-bounded trade plans over x402. AlphaGate uses part of each
payment to buy specialist market evidence from other x402 services, then records
the request lifecycle, verdict, evidence hash, and revenue accounting on
GenLayer.

AlphaGate is decision-support infrastructure. It does not custody user funds,
submit swaps, place orders, or claim that any trade is guaranteed.

## Production Status

Status checked on July 27, 2026.

| Resource | Value | Status |
| --- | --- | --- |
| Web console | `https://alphagate-gen.vercel.app` | Live |
| Health endpoint | `https://alphagate-gen.vercel.app/api/health` | Live |
| TradeGuard | `https://alphagate-gen.vercel.app/api/v1/trade-guard` | Live, x402 protected |
| AlphaRouter | `https://alphagate-gen.vercel.app/api/v1/alpha-router` | Live, x402 protected |
| OKX.AI identity | `#7525` | Resubmitted, under review |
| GenLayer network | StudioNet | Live, gasless |
| GenLayer contract | `0x94706ED905d3A701C448E8B393853787c7D81CA9` | Deployed |
| GenLayer operator | `0x9C8F3AA1CB8EC981713cd2264a19dcA609Da5699` | Dedicated backend signer |
| Treasury EOA | `0x3CEDb3FD7ee98Eae7c4C9D62210E2FbaA23a196D` | Receives X Layer USDT0 and pays upstreams from its Base USDC float |
| Persistence | GenLayer | No database |

The OKX.AI identity is registered but not publicly listed. OKX rejected the
previous Base challenge and requested the CAIP-2 network `eip155:196`. The live
services now expose X Layer USDT0 challenges and identity `#7525` was resubmitted
successfully on July 26, 2026.

## Services

### TradeGuard

TradeGuard is a pre-trade safety gate. It costs `0.10 USDT0` per request and
returns one of:

- `ALLOW`: the supplied evidence does not trigger a configured hard block.
- `BLOCK`: the trade violates a safety constraint or the evidence indicates
  unacceptable risk.
- `SIZE_DOWN`: the trade may proceed only with a smaller maximum position.

TradeGuard evaluates position size, maximum loss, token sellability, contract
risk, liquidity, evidence freshness, conflicting signals, and paid technical
confirmation.

### AlphaRouter

AlphaRouter costs `0.25 USDT0` per request and returns one of:

- `LONG`
- `SHORT`
- `WAIT`

For actionable plans it can include an entry range, stop, targets, position
size, risk/reward, confidence bucket, invalidation condition, and evidence-based
reasons. It returns `WAIT` when the evidence cannot support a defensible plan.

## Architecture

```text
Caller
  |
  | POST request
  v
AlphaGate x402 resource server on X Layer
  |
  | 402 challenge -> caller signs USDT0 authorization -> paid replay
  v
Request validation and deterministic safety gates
  |
  | AlphaGate treasury pays selected x402 providers
  v
Specialist market evidence
  |
  | evidence is normalized and hashed
  v
GenLayer request claim
  |
  +--> contract validates the bounded evidence-derived result
  |
  +--> consensus commits the verdict, evidence hash, and accounting
  v
Verdict + payment trace + GenLayer status
```

### Ownership Boundaries

The browser or calling agent owns:

- Its own X Layer wallet.
- The incoming `0.10 USDT0` or `0.25 USDT0` payment.
- Request construction and idempotency keys.
- The decision to act on or ignore the returned analysis.

The AlphaGate backend owns:

- Incoming x402 verification and settlement orchestration.
- Provider selection and paid upstream requests.
- Deterministic safety gates.
- GenLayer transaction submission.
- Response assembly and retryable error classification.

The GenLayer contract owns:

- Request claims and lifecycle state.
- Final results and evidence hashes.
- Gross revenue, upstream cost, and retained revenue accounting.
- Result-schema validation and consensus-backed finalization.
- The authoritative distinction between finalized and undetermined results.

## No Database

AlphaGate intentionally does not use PostgreSQL, SQLite, Redis, MongoDB, or any
other database.

In production, GenLayer stores:

- Request ID.
- Service name.
- Claim, completion, or failure status.
- Input hash.
- Evidence hash.
- Gross payment units.
- Upstream cost units.
- Retained units.
- Result JSON.
- Error summary.
- Creation and update timestamps.

Process memory is limited to active-request locks and local development fallback
state. Production request history and metrics do not depend on Vercel process
memory.

Local fixture mode uses an in-memory fallback when GenLayer is not configured.
That local state is intentionally ephemeral and resets with the process.

## Wallet Model

AlphaGate uses separate wallets for separate responsibilities.

### Caller Wallet

The caller wallet pays AlphaGate on X Layer using USDT0. In the web console,
AlphaGate requests an injected EVM wallet, switches it to X Layer, asks it to sign
the x402 typed-data authorization, and replays the request automatically.

The caller wallet is never stored by AlphaGate.

### Treasury EOA

Address:

```text
0x3CEDb3FD7ee98Eae7c4C9D62210E2FbaA23a196D
```

The same EOA is used on two networks:

1. On X Layer it receives incoming USDT0 service revenue.
2. On Base it holds USDC used to pay paid upstream x402 providers.

Incoming revenue is not automatically bridged to Base. Production therefore
requires a sufficient Base USDC operating float even when the X Layer side has
received USDT0 revenue. Rebalancing between networks is an explicit treasury
operation.

The upstream flow uses EIP-3009 USDC authorizations, so the treasury does
not normally broadcast the settlement transaction and does not require Base ETH
for standard exact-scheme payments. Keeping a small amount of Base ETH can still
be useful for future integrations that require approvals or direct transactions.

The treasury was bootstrapped with `0.05 USDC` in Base transaction:

```text
0xfe7e40b0389662388e37d9d057e27578556ec8dec86c46b5e96cc139f1c875e5
```

### GenLayer Operator

Address:

```text
0x9C8F3AA1CB8EC981713cd2264a19dcA609Da5699
```

This is a dedicated backend signer for all AlphaGate GenLayer StudioNet
transactions. StudioNet is gasless, so it does not require GEN funding.

The private key is stored outside the repository and is configured as the
production `GENLAYER_PRIVATE_KEY` secret. The contract operator is immutable in
the current contract version; rotating the signer requires deploying a new
contract and updating `GENLAYER_CONTRACT_ADDRESS`.

Never reuse the GenLayer operator as the Base treasury.

## Incoming x402 Flow

Both paid routes use x402 v2 on X Layer:

```text
Network: eip155:196
Asset:   USDT0
Token:   0x779ded0c9e1022225f8e0630b35a9b54be713736
Scheme:  exact
```

An unpaid request receives HTTP `402` and a base64-encoded
`PAYMENT-REQUIRED` response header. The challenge declares:

- Resource URL.
- Service description.
- Exact atomic USDT0 amount.
- X Layer CAIP-2 network identifier.
- USDT0 token address.
- Treasury recipient.
- Payment timeout.
- Bazaar input and output metadata.

After the caller signs the payment authorization, the request is replayed with a
`PAYMENT-SIGNATURE` header. The facilitator verifies and settles the payment
before AlphaGate executes the service handler.

Incoming verification and settlement use the official authenticated OKX
facilitator through:

```text
@okxweb3/x402-core
@okxweb3/x402-evm
@okxweb3/x402-next
```

The seller credentials are server-only Vercel secrets. They are never exposed
to the browser, returned by an API route, or committed to the repository.

## Browser Payment Flow

The production console supports injected EVM wallets such as MetaMask-compatible
providers.

When the user presses a service button:

1. The browser requests wallet access.
2. The wallet switches to X Layer.
3. The first API call receives the x402 challenge.
4. The x402 client constructs the typed-data payment authorization.
5. The wallet asks the user to sign.
6. The client replays the request with the payment signature.
7. AlphaGate runs paid evidence collection and GenLayer finalization.

If no injected wallet is available, the console returns a specific wallet error
instead of a generic `Request failed` message.

The Base treasury private key is never bundled into browser JavaScript.

## Agent API

### TradeGuard Request

`POST /api/v1/trade-guard`

```json
{
  "asset": {
    "type": "pair",
    "value": "BTC-USDT"
  },
  "side": "buy",
  "position_usd": "500",
  "timeframe": "4h",
  "max_loss_pct": "2",
  "thesis": "Optional agent thesis",
  "idempotency_key": "agent-order-0001"
}
```

Required fields:

| Field | Type | Notes |
| --- | --- | --- |
| `asset.type` | string | `pair` or `base_token` |
| `asset.value` | string | Pair symbol or Base ERC-20 contract address |
| `side` | string | `buy` or `sell` |
| `position_usd` | decimal string | Proposed position size |
| `timeframe` | string | `1h`, `4h`, or `1d` |
| `max_loss_pct` | decimal string | Maximum acceptable percentage loss |
| `idempotency_key` | string | Stable unique key for this logical request |

### AlphaRouter Request

`POST /api/v1/alpha-router`

```json
{
  "asset": {
    "type": "pair",
    "value": "ETH-USDT"
  },
  "bias": "neutral",
  "timeframe": "4h",
  "risk_budget_usd": "25",
  "portfolio_value_usd": "2500",
  "idempotency_key": "agent-plan-0001"
}
```

Required fields:

| Field | Type | Notes |
| --- | --- | --- |
| `asset.type` | string | `pair` or `base_token` |
| `asset.value` | string | Pair symbol or Base ERC-20 contract address |
| `bias` | string | `bullish`, `bearish`, or `neutral` |
| `timeframe` | string | `1h`, `4h`, or `1d` |
| `risk_budget_usd` | decimal string | Maximum loss budget |
| `portfolio_value_usd` | decimal string | Portfolio value used for sizing |
| `idempotency_key` | string | Stable unique key for this logical request |

### Base Token Input

Both services accept a Base ERC-20 contract:

```json
{
  "type": "base_token",
  "value": "0x0000000000000000000000000000000000000000"
}
```

Use the actual token contract address. The zero address above only demonstrates
the required JSON shape.

### Response Shape

Successful responses include:

```json
{
  "request_id": "0x...",
  "status": "completed",
  "result": {},
  "payment_trace": {
    "grossUnits": "100000",
    "upstreamCostUnits": "6000",
    "retainedUnits": "94000",
    "asset": "USDC"
  },
  "genlayer": {
    "used": true,
    "contract": "0x...",
    "transactionHash": "0x...",
    "consensusStatus": "finalized",
    "authoritative": true,
    "evidenceHash": "0x..."
  }
}
```

USDC accounting values use six-decimal atomic units. For example:

- `100000` = `0.10 USDC`
- `250000` = `0.25 USDC`
- `5000` = `0.005 USDC`

## Idempotency

The request ID binds:

- Service name.
- Caller-provided idempotency key.
- Incoming payment proof.
- Canonical request input.

This prevents accidental logical collisions while preserving repeatable request
identity for the same paid invocation. Callers should not reuse an idempotency
key for different trade intents.

## Paid Upstream Routing

AlphaGate composes specialist x402 providers instead of relying on a single
general-purpose market API.

| Provider | Purpose | Configured cost |
| --- | --- | ---: |
| n0brains | Directional and event signals | `0.005 USDC` |
| TradeSnack | Multi-indicator technical analysis | `0.010 USDC` |
| Otto AI | Crypto market news and sentiment | `0.001 USDC` |
| Token Safety Check | Base token contract risk | `0.050 USDC` |
| ApiToll | Base token price history | `0.001 USDC` |
| Crypto OHLC Candles | Pair candle history | `0.005 USDC` |

Provider endpoints are configured through `UPSTREAM_*_URL` environment
variables. A provider can be replaced without changing the service contract or
API schema.

### TradeGuard Provider Selection

For liquid pairs, the initial evidence set is:

- n0brains signals.
- Otto AI news.

If deterministic rules cannot finalize the verdict, TradeSnack supplies
technical confirmation before GenLayer analysis.

For Base tokens, the evidence set is:

- Token safety analysis.
- Price history.

### AlphaRouter Provider Selection

For liquid pairs, AlphaRouter collects:

- OHLC candles.
- Technical analysis.
- Directional signals.
- Market news.

For Base tokens, it collects token-safety and price-history evidence.

## GenLayer Consensus

Contract:

```text
0x94706ED905d3A701C448E8B393853787c7D81CA9
```

Deployment transaction:

```text
0x6ef018e442985eb0c26651a274aca05aecd417fececc486bd2957c0ee8de85f4
```

The contract uses the pinned GenVM runner:

```text
py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6
```

The request lifecycle is:

1. `claim_request`
2. `finalize_deterministic`
3. `fail_request` when orchestration fails after a successful claim

Production requests use bounded evidence-derived analysis followed by
`finalize_deterministic`. The contract validates the service-specific result
shape and consensus commits the verdict, evidence hash, cost, and revenue
accounting. This keeps paid HTTP calls inside the serverless response deadline.

The deployed contract also exposes `analyze_request`, which uses GenLayer
comparative AI consensus. It is retained for future asynchronous enrichment and
is intentionally not part of the synchronous paid API path because StudioNet
consensus can exceed a serverless request deadline.

The prompt treats the user intent and paid evidence as untrusted data and tells
validators to ignore instructions embedded in either payload.

## Undetermined Consensus

`UNDETERMINED` is not treated as an ordinary finalized result.

When GenLayer returns `UNDETERMINED`, AlphaGate attempts to recover the
contract-produced candidate verdict from the leader receipt or equivalence
outputs. If a valid result is recoverable, AlphaGate returns it with:

```json
{
  "genlayer": {
    "consensusStatus": "undetermined",
    "authoritative": false
  }
}
```

This preserves the useful contract output while making its status explicit. The
caller must not treat it as finalized consensus.

If no valid contract result is recoverable, AlphaGate returns a retryable
`genlayer_undetermined` error and does not invent a verdict.

## Error Model

Application errors use a structured JSON shape:

```json
{
  "error": "error_code",
  "message": "Human-readable explanation",
  "retryable": true,
  "fields": {},
  "request_id": "0x..."
}
```

Important error classes:

| Code | Meaning | Retry |
| --- | --- | --- |
| `treasury_unavailable` | Base treasury signer is missing | After configuration |
| `upstream_failed` | Paid provider returned a failing HTTP response | Usually yes |
| `upstream_malformed` | Provider returned non-JSON data | Yes or replace provider |
| `genlayer_unavailable` | Required GenLayer configuration is missing | After configuration |
| `genlayer_failed` | GenLayer execution failed | Inspect receipt first |
| `genlayer_undetermined` | No finalized consensus and no recoverable verdict | Yes |
| `request_missing` | The request claim was not found | Check contract and request ID |

An unpaid API request is not an application failure. It correctly returns HTTP
`402 Payment Required`.

## Health and Readiness

`GET /api/health`

Expected production response:

```json
{
  "status": "ok",
  "service": "AlphaGate",
  "x402": true,
  "live_upstreams": true,
  "treasury": {
    "network": "eip155:196",
    "asset": "USDT0",
    "assetAddress": "0x779ded0c9e1022225f8e0630b35a9b54be713736",
    "address": "0x3CEDb3FD7ee98Eae7c4C9D62210E2FbaA23a196D"
  },
  "paymentSdk": {
    "provider": "OKX",
    "corePackage": "@okxweb3/x402-core",
    "evmPackage": "@okxweb3/x402-evm",
    "nextPackage": "@okxweb3/x402-next",
    "authenticatedFacilitator": true
  },
  "genlayer": {
    "configured": true,
    "contract": "0x94706ED905d3A701C448E8B393853787c7D81CA9",
    "operator": "0x9C8F3AA1CB8EC981713cd2264a19dcA609Da5699",
    "mode": "consensus"
  },
  "persistence": "genlayer"
}
```

Health proves that configuration is present. It does not spend USDT0 or USDC and does not
prove a provider has settled a paid call at that exact moment.

### Unpaid Challenge Check

An unpaid service probe should return `402`, not `200`:

```bash
curl -i -X POST \
  https://alphagate-gen.vercel.app/api/v1/trade-guard \
  -H 'content-type: application/json' \
  --data '{
    "asset":{"type":"pair","value":"BTC-USDT"},
    "side":"buy",
    "position_usd":"500",
    "timeframe":"4h",
    "max_loss_pct":"2",
    "idempotency_key":"readiness-check"
  }'
```

Confirm the response contains:

- HTTP `402`.
- `PAYMENT-REQUIRED`.
- `x402Version: 2` after decoding.
- `network: eip155:196`.
- The X Layer USDT0 contract.
- The correct treasury recipient.
- Bazaar input and output metadata.

## Environment Variables

Copy `.env.example` to `.env.local` for development.

### Application and Incoming Payments

| Variable | Required in production | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Yes | Canonical public application URL |
| `X402_ENABLED` | Yes | Enables incoming payment protection |
| `X402_PAY_TO` | Yes | X Layer USDT0 recipient |
| `OKX_API_KEY` | Yes | Official OKX facilitator authentication |
| `OKX_SECRET_KEY` | Yes | Official OKX facilitator request signing |
| `OKX_PASSPHRASE` | Yes | Official OKX facilitator authentication |
| `OKX_BASE_URL` | Optional | OKX API origin; defaults to `https://www.okx.com` |

### Upstream Payments

| Variable | Required in production | Purpose |
| --- | --- | --- |
| `TREASURY_PRIVATE_KEY` | Yes | Signs upstream USDC authorizations |
| `LIVE_UPSTREAMS` | Yes | Uses real paid providers instead of fixtures |
| `UPSTREAM_N0BRAINS_URL` | Optional | Overrides signals provider |
| `UPSTREAM_TA_URL` | Optional | Overrides technical-analysis provider |
| `UPSTREAM_NEWS_URL` | Optional | Overrides news provider |
| `UPSTREAM_TOKEN_SAFETY_URL` | Optional | Overrides token-safety provider |
| `UPSTREAM_PRICE_HISTORY_URL` | Optional | Overrides price-history provider |
| `UPSTREAM_CANDLES_URL` | Optional | Overrides candles provider |

### GenLayer

| Variable | Required in production | Purpose |
| --- | --- | --- |
| `REQUIRE_GENLAYER` | Yes | Fails closed when GenLayer is unavailable |
| `GENLAYER_PRIVATE_KEY` | Yes | Dedicated operator signer |
| `GENLAYER_CONTRACT_ADDRESS` | Yes | Active AlphaGate contract |

Example:

```dotenv
NEXT_PUBLIC_APP_URL=https://alphagate-gen.vercel.app

X402_ENABLED=true
X402_PAY_TO=0x3CEDb3FD7ee98Eae7c4C9D62210E2FbaA23a196D
OKX_API_KEY=server-only
OKX_SECRET_KEY=server-only
OKX_PASSPHRASE=server-only
OKX_BASE_URL=https://www.okx.com

TREASURY_PRIVATE_KEY=0xBaseTreasuryPrivateKey
LIVE_UPSTREAMS=true

REQUIRE_GENLAYER=true
GENLAYER_PRIVATE_KEY=0xDedicatedGenLayerOperatorPrivateKey
GENLAYER_CONTRACT_ADDRESS=0x94706ED905d3A701C448E8B393853787c7D81CA9
```

Never put private keys in variables prefixed with `NEXT_PUBLIC_`. Never commit
`.env.local`, `.env.build`, key files, mnemonics, or Vercel tokens.

## Local Development

Requirements:

- Node.js 20 or newer.
- npm.
- Python 3.12 or newer for GenLayer contract checks.
- A Python virtual environment containing `genvm-linter`, `genlayer-test`, and
  `pytest` when running contract tests.

Install and start:

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

The default example configuration disables incoming x402, uses local evidence
fixtures, and falls back to process memory. This makes local UI development
possible without spending USDC.

## Verification

Run the application checks:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Run the GenLayer checks:

```bash
npm run lint:genlayer
npm run test:genlayer
```

Current application coverage includes:

- Exact USDC parsing and formatting.
- Revenue retention calculations.
- Canonical hashing.
- Payment-bound request IDs.
- Deterministic TradeGuard outcomes.
- Database-free local idempotency and metrics.
- Recovery of contract verdicts from undetermined receipts.
- Rejection of empty undetermined receipts.

## Deploying the GenLayer Contract

Set the dedicated operator key and treasury address:

```bash
set -a
source .env.local
set +a
npm run contract:deploy
```

The deployment script:

1. Reads the pinned contract source.
2. Derives the operator from `GENLAYER_PRIVATE_KEY`.
3. Records `X402_PAY_TO` as the treasury.
4. Deploys to StudioNet.
5. Waits for finalization.
6. Prints the deployment transaction, contract, operator, and treasury.

After deployment:

1. Confirm the receipt execution succeeded.
2. Confirm `genlayer code <address>` returns the expected source.
3. Confirm `genlayer call <address> get_metrics` returns the expected operator
   and treasury.
4. Set `GENLAYER_CONTRACT_ADDRESS` in Vercel.
5. Set the matching `GENLAYER_PRIVATE_KEY` secret.
6. Redeploy the web application.

## Vercel Deployment

The repository is linked to the `alphagate` Vercel project.

Deploy production:

```bash
npx vercel --prod --yes
```

After deployment:

```bash
npx vercel inspect alphagate-gen.vercel.app
curl -sS https://alphagate-gen.vercel.app/api/health
```

Verify the deployment alias points to a `READY` production deployment before
running paid tests.

## Revenue Model

The contract records:

```text
retained = max(gross payment - configured upstream cost, 0)
```

Example TradeGuard routing:

```text
Gross price:       0.100 USDC
n0brains:          0.005 USDC
Otto AI:           0.001 USDC
Potential margin:  0.094 USDC
```

Additional technical confirmation increases upstream spend when the initial
evidence is not sufficient for deterministic finalization.

Configured provider cost is recorded for accounting. A production operator
should periodically compare configured costs with provider challenges and update
pricing when providers change their fees.

## Security

- Incoming payments are verified before service execution.
- The Base treasury and GenLayer operator are separate keys.
- Upstream payment policy locks every provider to Base USDC, an exact configured
  amount, a known recipient, and EIP-3009. Price increases, recipient changes,
  Permit2 challenges, and alternate networks fail closed.
- Private keys are server-only secrets.
- Request IDs bind the payment proof and canonical input.
- Inputs and paid evidence are treated as untrusted data.
- GenLayer result schemas restrict verdict and action enums.
- Upstream requests use timeouts.
- Upstream response bodies are capped at one megabyte.
- Pair symbols and monetary inputs are schema-bounded before provider calls.
- Provider failures are returned as structured retryable errors.
- Retained revenue cannot become negative.
- AlphaGate never signs or broadcasts user trades.

Operational recommendations:

- Keep treasury balance low and refill it as needed.
- Use a dedicated treasury key with no unrelated assets.
- Rotate providers when availability or pricing changes.
- Rotate the GenLayer operator by redeploying the contract.
- Review Vercel secret access.
- Monitor provider settlement receipts and GenLayer failures.
- Never log payment signatures or private keys.

## OKX.AI Listing

Identity:

```text
#7525
```

Current state on July 26, 2026:

```text
Approval: Listing under review
Status:   not listed
```

The listing contains two API services:

- TradeGuard at `/api/v1/trade-guard`.
- AlphaRouter at `/api/v1/alpha-router`.

Both endpoints expose Bazaar discovery metadata through their x402 challenges.
The ASP cannot be considered publicly available inside OKX.AI until OKX approves
the listing.

## Production Readiness Checklist

- [x] No database dependency.
- [x] Production Vercel deployment is live.
- [x] Health endpoint returns the active treasury, contract, and operator.
- [x] TradeGuard returns a valid X Layer USDT0 x402 v2 challenge.
- [x] AlphaRouter returns a valid X Layer USDT0 x402 v2 challenge.
- [x] Bazaar metadata is present in both challenges.
- [x] Dedicated GenLayer operator created.
- [x] Contract redeployed under the dedicated operator.
- [x] Contract source and metrics read verified.
- [x] Browser x402 signing flow implemented.
- [x] Structured undetermined-result handling implemented.
- [x] Application tests, lint, typecheck, and production build pass.
- [x] Execute and record real paid upstream requests from the treasury.
- [x] Execute a paid production TradeGuard request and return its result.
- [x] Verify both deployed unpaid challenges expose `eip155:196` and USDT0.
- [ ] Execute one paid production request for each AlphaGate service.
- [ ] Receive OKX approval and confirm `#7525` becomes listed.

The unchecked items are release verification steps, not hidden implementation
work. Do not mark the service fully end-to-end verified until settlement receipts
and successful paid responses have been observed.

### Verified Production Settlement

Verified on July 26, 2026, before the incoming payment network migrated from
Base USDC to X Layer USDT0:

| Step | Result |
| --- | --- |
| Incoming TradeGuard payment | `0x426b5bd42aa4a6113d9e390998f30f357760fe0d3fa4be2be1d9b73720393395` |
| n0brains upstream payment | `0xcf609456351e851acd5ef4f175a052a4ccd3fe4ba84b01ce6c9d79fe396627d1` |
| Otto AI upstream payment | `0xe0f8a90e0d4136592206ae92f9c1a32472f2e59ad0e590e173004ba980ad71a6` |
| GenLayer finalization | `0xe487d98e389647a01b2caa77fa1b81f7e237b7107205d0558072aec698b3b8bb` |
| Request ID | `0x063c0b82e46f2fb5c1d25af9a3ff95396876c17ad9a98e290785a3e4c99d9ca2` |
| HTTP result | `200`, `BLOCK`, authoritative and finalized |

The request charged `0.10 USDC`, spent `0.006 USDC` on paid evidence, retained
`0.094 USDC`, persisted the complete result on GenLayer, and returned the
verdict, evidence, payment trace, and GenLayer proof to the caller.

## Troubleshooting

### The web console says an EVM wallet is required

Install or enable an injected EVM wallet, unlock it, and retry. The wallet paying
AlphaGate must hold X Layer USDT0.

### The wallet opens but payment fails

Check:

- The wallet is on X Layer.
- It holds enough X Layer USDT0.
- The user approved the typed-data signature.
- The x402 authorization did not expire.
- The facilitator is reachable.

### AlphaGate returns `treasury_unavailable`

Set `TREASURY_PRIVATE_KEY` in the server environment and redeploy. Never expose
the key to browser code.

### An upstream call fails

Inspect the provider HTTP status and response snippet in the structured error.
Then:

1. Recheck the provider's unpaid x402 challenge.
2. Confirm its price, token, network, and scheme.
3. Confirm the treasury has enough Base USDC.
4. Replace the provider URL if it is unavailable or incompatible.

### GenLayer writes fail

Check:

1. `GENLAYER_PRIVATE_KEY` matches the contract operator.
2. `GENLAYER_CONTRACT_ADDRESS` is the active deployment.
3. The transaction receipt execution result, not only lifecycle status.
4. The contract schema and deployed source.
5. StudioNet rate limits.

### GenLayer returns `UNDETERMINED`

Inspect `genlayer.authoritative`. A recovered verdict with
`authoritative: false` is provisional. Retry later if finalized consensus is
required.

### The dashboard has no previous requests

Confirm the application is pointing at the expected GenLayer contract. A newly
deployed contract starts with empty metrics and request history. Vercel process
restarts do not erase on-chain records.

## License

This repository is currently private project code unless a separate license file
states otherwise.
