# BundleIQ Architecture

## High-Level Architecture

BundleIQ separates real devnet-safe Solana operations from simulated Jito and failure workflows. It is built from the official public resources provided for the bounty: Jito SDK/docs, Yellowstone gRPC/docs, and Solana RPC/docs.

## Public Architecture Document

[TO BE ADDED: Google Docs/Notion public URL]

```text
Dashboard UI
  -> /api/solana/stream-status
      -> SolInfra Yellowstone gRPC slot stream
      -> Solana devnet RPC fallback
  -> /api/solana/status
      -> Solana devnet Connection
  -> /api/solana/submit-memo
      -> server-only devnet wallet
      -> Solana devnet Memo transaction
  -> /api/jito/bundle
      -> disabled unless JITO_ENABLED=true
      -> Jito testnet sendBundle
  -> /api/jito/bundle-status
      -> separate Jito bundle status check
  -> local simulation helpers
      -> lifecycle tracker
      -> fault injection
      -> retry agent
      -> Jito adapter
```

## Component Responsibilities

Dashboard:

- Displays devnet status, Jito simulation state, AI decisions, lifecycle logs, and failure cases.
- Calls API routes for real devnet operations.
- Runs local mock simulations for Jito and fault injection.

Solana API routes:

- `GET /api/solana/stream-status`: returns SolInfra Yellowstone slot status when a compatible endpoint is configured, or clearly labeled devnet RPC fallback status when streaming is unavailable.
- `GET /api/solana/status`: returns devnet slot, block height, blockhash, last valid block height, and commitment.
- `POST /api/solana/submit-memo`: submits a real devnet Memo transaction and returns lifecycle timing.
- `POST /api/jito/bundle`: constructs base64 signed transactions plus a server-signed Jito tip transaction from the official Jito docs/SDK model, and submits only when explicitly enabled with a usable endpoint/network/wallet.
- `POST /api/jito/bundle-status`: checks bundle status separately from bundle submission.

Yellowstone libraries:

- `yellowstone-client.ts`: server-side gRPC connection, slot subscription, ping keepalive, and reconnect handling.
- `slot-store.ts`: in-memory current, processed, confirmed, finalized, and skipped slot status.
- `commitment-buffer.ts`: processed-to-confirmed and confirmed-to-finalized delta helpers.

Solana libraries:

- `connection.ts`: devnet `Connection`.
- `devnet-wallet.ts`: server-only keypair loading from JSON array env.
- `transaction-submitter.ts`: real devnet Memo transaction lifecycle.
- `lifecycle-tracker.ts`: shared lifecycle shape for real and simulated rows.
- `fault-injection.ts`: simulated failure cases.

Jito libraries:

- `tip-engine.ts`: deterministic dynamic tip decisions from live/recent network inputs and local bundle history.
- `leader-window.ts`: mock leader-window timing.
- `bundle-adapter.ts`: adapter boundary for simulated bundle submission.
- `server-adapter.ts`: server-only Jito testnet boundary following the official Jito sendBundle/status split.

Official resources used conceptually:

- Jito block-engine docs, `jito-ts`, and `jito-rust-rpc` for bundle submission, tips, base64 encoding, and status checks.
- `yellowstone-grpc` and Triton Dragon's Mouth for backend gRPC slot streaming.
- Solana RPC/docs for devnet/testnet RPC usage, commitment semantics, and `lastValidBlockHeight`.

Retry library:

- `retry-agent.ts`: deterministic retry decision logic.

## Lifecycle Flow

Real devnet Memo flow:

1. User clicks `Submit Real Devnet Memo`.
2. Browser calls `POST /api/solana/submit-memo`.
3. Server loads `SOLANA_DEVNET_SECRET_KEY`.
4. Server builds and signs a Memo transaction.
5. Server sends raw transaction to devnet.
6. Server waits for processed, confirmed, and finalized observations.
7. API returns lifecycle timestamps and deltas.
8. Dashboard appends the row as `Real Devnet`.

Simulated lifecycle flow:

1. User clicks `Simulate Bundle Lifecycle`.
2. Dashboard creates a mock lifecycle entry.
3. Entry progresses through processed, confirmed, finalized, or failed.
4. Optional simulated failure is attached.
5. Dashboard updates retry and AI decision output.

## Retry Flow

1. Failure is classified by type.
2. Retry agent receives failure type, blockhash age, current tip, leader distance, and RPC latency.
3. Retry agent decides whether to retry.
4. Retry agent returns new tip, blockhash refresh requirement, reason, and next action.

Expired blockhash response:

- retry required
- refresh blockhash
- recalculate tip
- resubmit

## AI Decision Flow

The AI panel combines three deterministic decision sources:

- Jito tip decision from `calculateDynamicTip()`.
- Leader timing decision from `estimateLeaderWindow()`.
- Retry decision from `decideRetryAction()`.

It displays a concise execution recommendation, visible reasoning, and signal badges for failure, retry, tip, and timing decisions. This is a deterministic decision agent; it does not claim LLM-driven production autonomy or an autonomous production resubmission loop.

## Jito Adapter Flow

Current dashboard simulation flow:

1. Dashboard calculates leader window.
2. Dashboard calculates a dynamic tip recommendation.
3. Dashboard prepares bundle payload with `prepareBundlePayload()`.
4. Dashboard calls `simulateBundleSubmission()`.
5. Adapter returns mock bundle ID, status, tip, submitted timestamp, leader slot, and reason.

Server-side Jito testnet flow:

1. `POST /api/jito/bundle` exits unless `JITO_ENABLED=true`.
2. Server uses the Jito testnet block-engine URL by default.
3. Provided signed transactions must be base64 strings.
4. Server fetches a fresh testnet blockhash and keeps `lastValidBlockHeight`.
5. Server appends a signed System Program transfer to a Jito tip account.
6. Bundle size is validated at no more than five signed transactions.
7. `sendBundle` returns `bundle_id` and the adapter labels it `submitted-not-landed`.
8. `POST /api/jito/bundle-status` checks status separately.

## Yellowstone Integration

Yellowstone gRPC slot monitoring is integrated server-side only. The route uses the Triton Dragon's Mouth backend gRPC model, keeps endpoint/token secrets on the server, and never imports the gRPC client into browser components.

Current integration:

1. `src/lib/grpc/yellowstone-client.ts` opens a server-side SolInfra Yellowstone slot subscription.
2. The stream records processed, confirmed, finalized, and skipped/dead slot updates.
3. Final validation connected to the SolInfra Yellowstone gRPC endpoint in FRA and received live slot updates.
4. Ping keepalive, bounded event-buffer backpressure handling, and reconnect handling preserve the stream when configured.
5. If endpoint/token credentials are absent or the stream is unavailable, `/api/solana/stream-status` returns `source: "rpc-fallback"` with devnet RPC slot data and a direct explanation that streaming is not connected.
6. The final evidence uses 31 landed real Jito bundles, 62 unique status-checked bundles, and 76 total status-check attempts.
7. `npm run lint` and `npm run build` pass for final validation.
8. Account and transaction subscriptions remain a future expansion.
