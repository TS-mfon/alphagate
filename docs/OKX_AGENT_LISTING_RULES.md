# OKX AI Agent Build and Listing Rules

Status checked on July 27, 2026. This checklist combines the current OKX agent
identity validation rules, official payment integration requirements, and review
feedback received while listing AlphaGate.

## Non-Negotiable Build Rules

1. Build a real, publicly usable service. Placeholder endpoints, local servers,
   mock URLs, and incomplete demos are not eligible.
2. Host every API service at a permanent public `https://` endpoint. Reject
   `http://`, `localhost`, private IP addresses, `.local`, and `.internal`
   endpoints. Keep endpoint URLs at or below 512 characters.
3. Use the official OKX Payment SDK for paid API services. Do not substitute a
   generic x402 facilitator and do not manually imitate the OKX payment flow.
4. Keep OKX API keys, secret keys, passphrases, wallet private keys, and signing
   material on the server. Never expose them in browser bundles, logs, listing
   descriptions, screenshots, or repositories.
5. For X Layer x402 services, declare the network using the CAIP-2 value
   `eip155:196`. A plain chain ID, `196`, `xlayer`, Base, or another network in
   the payment challenge will fail review.
6. Use the X Layer payment asset and contract expected by the current OKX
   integration. AlphaGate uses USDT0 at
   `0x779ded0c9e1022225f8e0630b35a9b54be713736`.
7. Return a valid unpaid HTTP `402` response with the official payment challenge.
   The challenge must contain the correct network, asset, amount, recipient,
   timeout, resource URL, method, input schema, and output metadata.
8. Use the real HTTP method in discovery metadata. A JSON-body endpoint must
   declare `POST`, `PUT`, or `PATCH` as appropriate rather than relying on a
   default `GET`.
9. Verify and settle payments through the official facilitator. Do not deliver a
   successful paid response when verification or settlement fails.
10. Make paid requests idempotent. Bind the logical request to the service,
    canonical input, caller-provided idempotency key, and payment proof.
11. Return structured JSON with stable result fields, explicit error codes,
    retryability, and the request ID. Do not return a generic `Request failed`
    message.
12. Set bounded timeouts for external providers and blockchain finalization.
    Slow consensus must return a useful pending or provisional result instead of
    converting a submitted transaction into a false permanent failure.
13. Do not claim to execute trades unless the service actually has that
    permission and implementation. Decision-support agents must say they provide
    analysis or plans only.
14. Do not promise profit, guaranteed returns, no-loss outcomes, or exaggerated
    performance in any language.

## Identity Rules

1. Choose the correct role: User, ASP, or Evaluator. A service provider must be
   registered as an ASP.
2. Each wallet can register only one User identity and one Evaluator identity.
   ASP handling depends on the current wallet's existing identities.
3. If a listing is rejected, update the same agent ID and resubmit it. Do not
   create a replacement identity merely to bypass review.
4. Use a brand name:
   - English: 3-25 characters.
   - Chinese: 2-12 characters.
   - No test markers, account labels, celebrity names, or public-figure names.
5. Keep the agent description to one clear sentence, no more than 500
   characters, explaining what the agent does and for whom.
6. Do not include infrastructure details, private configuration, legal
   disclaimers, links, example prompts, or profit guarantees in the listing
   description.

## Avatar Rules

1. An ASP avatar is required.
2. Upload an image file directly through the listing workflow. Pasted image URLs
   are not accepted as the source.
3. Use PNG, JPEG, or WebP and keep the file below 1 MB.
4. Use a square 1:1 image. AlphaGate uses 1024 by 1024 pixels.
5. Use fully opaque square outer corners. Avoid rounded outer backgrounds,
   rounded frames, rounded rectangles, rounded line caps, and rounded joins.
6. Keep the subject readable at small marketplace-thumbnail sizes.
7. Do not silently resize, crop, or convert the user's supplied listing image
   during the identity upload flow.

## Service Rules

1. Service names must be descriptive noun phrases between 5 and 30 characters.
   Do not reuse only the agent name and do not place a price in the service name.
2. Select the correct service type:
   - API service: paid public endpoint with a fixed per-call price.
   - Agent to agent: per-call pricing or monthly subscription pricing.
3. Prices are numeric strings denominated in USDT:
   - Valid: `"0"`, `"0.1"`, `"10"`.
   - Invalid: `"10 USDT"`, `"about 10"`, or an unquoted JSON number.
   - Use no more than six decimal places.
4. API services require one fixed per-call fee and a public HTTPS endpoint. They
   cannot carry subscription or free-trial fields.
5. Agent-to-agent services must use exactly one pricing model:
   - Per-call fee; or
   - Monthly subscription.
6. Monthly subscriptions currently use `month`. A supported free trial is fixed
   at 72 hours, or three days.
7. Non-subscription service descriptions require exactly three numbered parts:
   - `1.` Core capability and intended user.
   - `2.` Inputs the user must provide.
   - `3.` Output and delivery behavior.
8. Subscription signal-service descriptions require exactly two numbered parts:
   - `1.` Core capability and explicitly supported markets.
   - `2.` Delivery behavior and a concrete signal example.
9. Subscription signal services may name only markets they actually support,
   using the full names `DEX`, `Polymarket`, or `Hyperliquid`.
10. Put every description part on its own line. Keep each part at or below 200
    East-Asian display-width characters and the complete description at or below
    600.
11. Do not include tech-stack names, GitHub links, wallet links, example prompts,
    legal disclaimers, or guaranteed financial outcomes in service descriptions.
12. Existing agent-to-agent services cannot switch pricing models in place.
    Create a new service when moving between per-call and subscription pricing.

## Review Readiness Checks

Before submitting or resubmitting:

1. Production homepage returns HTTP `200`.
2. Health endpoint returns HTTP `200` and reports the expected payment network,
   token, recipient, facilitator, and GenLayer configuration.
3. Every unpaid API-service probe returns HTTP `402`.
4. Decode the challenge and confirm:
   - `x402Version: 2`.
   - `network: eip155:196`.
   - Correct X Layer USDT0 contract.
   - Correct treasury recipient.
   - Correct price in atomic units.
   - Correct public resource URL.
   - Correct HTTP method and JSON input schema.
5. Execute a funded end-to-end request from a wallet that is different from the
   treasury. Confirm the payer balance decreases and the treasury balance
   increases.
6. Confirm the successful response contains the service output, payment receipt,
   request ID, evidence information, and GenLayer status.
7. Confirm failed verification or settlement does not appear as revenue.
8. Confirm a GenLayer receipt timeout returns a pending/provisional response with
   a transaction hash rather than a false permanent failure.
9. Validate the final name, description, avatar, services, fees, and endpoints
   together before the one on-chain update.
10. After a rejected listing is corrected, update the existing agent and activate
    it to resubmit. Do not repeatedly create new identities.

## Instructions for Another LLM

Use this block as the minimum execution policy:

```text
Build and list the OKX AI agent using only public production HTTPS endpoints.
Use the official OKX seller/payment SDK. For X Layer payment challenges, use
CAIP-2 network eip155:196 and the approved X Layer USDT0 asset. Keep all
credentials server-side. Return a valid HTTP 402 challenge with accurate Bazaar
method, input, and output metadata. Require idempotency and structured errors.

Register the provider as an ASP with a brand name, one-sentence description,
directly uploaded square avatar under 1 MB, and fully square image corners. Do
not use rounded outer corners. Use descriptive service names, numeric-string
USDT fees, public HTTPS endpoints, and correctly numbered descriptions. Never
include test markers, infrastructure details, links, disclaimers, celebrity
names, or profit guarantees.

Before submission, validate the complete listing once, test the production
health endpoint, decode the unpaid 402 challenge, and perform a funded paid call
from a payer wallet different from the treasury. Confirm on-chain settlement,
result delivery, and GenLayer persistence. If review rejects the listing, update
and resubmit the same agent ID.
```
