# BundleIQ

## Project Overview

BundleIQ is a Solana infrastructure dashboard for tracking transaction lifecycle, Jito bundle readiness, failure classification, retry strategy, and AI-assisted execution decisions.

The current implementation is built from the official public resources provided for the bounty: Jito SDK/docs, Yellowstone gRPC/docs, and Solana RPC/docs. It is devnet-safe by default. It supports SolInfra Yellowstone gRPC slot monitoring when a usable endpoint is configured, preserves safe Solana devnet RPC fallback when the stream is unavailable, includes a real devnet Memo transaction lifecycle test, simulated Jito dashboard flows, and a disabled-by-default Jito testnet submission boundary.

## What BundleIQ Does

- Reads Solana devnet slot status through SolInfra Yellowstone gRPC when a compatible endpoint is configured, with RPC fallback when Yellowstone credentials are absent or the stream is unavailable.
- Submits a real devnet Memo transaction when a funded devnet-only keypair is supplied server-side.
- Records submitted, processed, confirmed, and finalized timestamps for real devnet Memo transactions.
- Simulates transaction lifecycle progressions and failure cases.
- Simulates Jito bundle preparation through an adapter pattern without calling Jito endpoints from the dashboard.
- Constructs Jito bundles from the official Jito docs/SDK model and keeps real submission disabled unless `JITO_ENABLED=true` and a usable endpoint/network/wallet are configured.
- Computes Jito tip recommendations from live/recent network inputs, leader distance, recent failures, and base tip.
- Uses retry-agent output to explain whether to refresh blockhash, recalculate tip, and resubmit.

## System Architecture

## Public Architecture Document

https://docs.google.com/document/d/1ZJ-qHyBRev9KLXnZx4vIOM5de4ZFDiXCSVdV1FAb48I/edit?usp=sharing

BundleIQ is organized around clean boundaries:

- `src/app/api/solana/status`: server API route for read-only Solana devnet status.
- `src/app/api/solana/stream-status`: server API route for Yellowstone slot status with devnet RPC fallback.
- `src/app/api/solana/submit-memo`: server API route for real devnet Memo transaction submission.
- `src/app/api/jito/bundle`: server API route for disabled-by-default Jito testnet `sendBundle`.
- `src/app/api/jito/bundle-status`: server API route for separate Jito bundle status checks.
- `src/lib/grpc`: Yellowstone client, slot store, and commitment delta helpers.
- `src/lib/solana`: devnet connection, wallet loading, slot monitoring, lifecycle tracking, fault injection, and transaction submission.
- `src/lib/jito`: mock adapter, testnet server adapter, leader-window estimator, and dynamic tip engine.
- `src/lib/retry`: retry-agent decision logic.
- `src/components/dashboard/DashboardView.tsx`: dashboard UI and client-side orchestration.

Private key handling is server-only. The browser calls API routes and never imports the keypair loader.

## Data Flow

1. The dashboard loads mock bootstrap data from `src/lib/mock-data.ts`.
2. The dashboard fetches `/api/solana/stream-status` for Yellowstone slot status or clearly labeled RPC fallback status.
3. Real devnet Memo submission is triggered by `POST /api/solana/submit-memo`.
4. Simulated lifecycle and failure buttons create local mock entries in the dashboard.
5. Simulated Jito bundle submission uses `prepareBundlePayload()` and `simulateBundleSubmission()`.
6. AI panel output combines dynamic tip, leader-window, and retry-agent decisions.
7. Optional Jito testnet submission happens only through server routes when `JITO_ENABLED=true` and a usable endpoint/network/wallet are configured.

## Transaction Lifecycle Tracking

BundleIQ tracks these lifecycle stages:

- `submitted`
- `processed`
- `confirmed`
- `finalized`
- `failed`

For real devnet Memo transactions, BundleIQ records:

- `signature`
- `slot`
- `submittedAt`
- `processedAt`
- `confirmedAt`
- `finalizedAt`
- latency deltas between stages
- final status

For simulated transactions, BundleIQ uses the same display model but marks rows as mock simulation.

## AI Agent Responsibilities

The AI decision panel is responsible for explaining:

- dynamic tip decision
- leader timing decision
- retry decision
- whether blockhash refresh is required
- whether tip recalculation is recommended
- next action for simulated failures

This is a deterministic decision agent with visible reasoning for failure, retry, tip, and timing decisions. It does not claim production LLM autonomy or an autonomous production resubmission loop.

## Failure Classification

Current simulated failure types:

- expired blockhash
- insufficient tip
- compute exceeded
- bundle rejected

Each failure includes:

- `failureType`
- `reason`
- `recoveryAction`
- `retryRequired`

Real devnet Memo submission can also surface server errors such as missing wallet env, unfunded devnet wallet, or RPC submission failure.

## Retry Strategy

The retry agent evaluates:

- `failureType`
- `blockhashAge`
- `currentTip`
- `leaderDistance`
- `rpcLatency`

It returns:

- `shouldRetry`
- `newTip`
- `refreshBlockhash`
- `reason`
- `nextAction`

For expired blockhash, the recommended action is to refresh blockhash, recalculate tip, and resubmit.

## Dynamic Tip Strategy

The Jito tip engine calculates bundle tip recommendations from:

- network health
- leader distance
- recent failures
- base tip
- recent local bundle status history

Rules:

- Increase tip when the leader distance is low.
- Increase tip after tip-too-low or insufficient-tip failures.
- Reduce pressure when network health is healthy.
- Never return a tip below the base tip.

The engine supports live/recent network inputs from the dashboard and stream-status path. The final landed Jito evidence used the minimum configured tip where applicable, so the evidence does not claim that every landed bundle used a varied dynamic tip.

## Jito Testnet Boundary

The official Jito block-engine flow treats `sendBundle` as submission only: a returned `bundle_id` means the bundle was received, not landed. BundleIQ therefore labels a `sendBundle` result as `submitted-not-landed` and checks bundle status separately through `/api/jito/bundle-status`. A bundle constructed from signed transaction(s) plus a Jito tip is not counted as landed.

During Jito testnet runs, BundleIQ can record `network-error` status checks when RPC, Jito, or local connectivity fails after retry attempts. These records are observed infrastructure behavior and failed operational evidence; they are never counted as landed Jito bundles.

Official-resource alignment:

- Jito block-engine docs and `jito-ts`/`jito-rust-rpc` examples drive the bundle size, base64 transaction encoding, tip instruction, `sendBundle`, and status-check split.
- Triton Dragon's Mouth and `yellowstone-grpc` drive the server-side gRPC-only boundary.
- Solana RPC/docs drive devnet/testnet RPC selection, commitment choices, and `lastValidBlockHeight` tracking from `getLatestBlockhash`.

Strict rules implemented in code:

- Jito is disabled unless `JITO_ENABLED=true`.
- The default block-engine URL is Jito testnet: `https://testnet.block-engine.jito.wtf`.
- The default Solana RPC for Jito signing is testnet: `https://api.testnet.solana.com`.
- Mainnet-like Jito and Solana RPC URLs are rejected.
- Bundles are capped at five signed transactions.
- Signed transactions are sent as base64.
- The server appends a signed System Program transfer tip instruction to a Jito tip account.
- `getLatestBlockhash` output keeps `lastValidBlockHeight` with the signed tip transaction.
- Real submission only runs when a usable endpoint/network/wallet is configured.

Example disabled-by-default request:

```bash
POST /api/jito/bundle
{
  "signedTransactions": ["base64-signed-transaction"],
  "tipLamports": 1000
}
```

Status must be checked separately:

```bash
POST /api/jito/bundle-status
{
  "bundleId": "bundle_id_from_sendBundle"
}
```

## Final Observed Jito Evidence

Final local evidence was summarized from `.data/jito-evidence.json` into a sanitized judge evidence export. Raw `.data/` evidence remains private and ignored by Git.

31 real Jito testnet bundles landed and were status-checked.

- Landed real Jito bundles: 31
- Unique bundles with status checks: 62
- Total status-check attempts: 76
- Landed slots recorded: 31
- SolInfra Yellowstone status: connected during final validation
- SolInfra endpoint region: FRA
- Validation: `npm run lint` passed; `npm run build` passed

Sanitized judge exports are available at:

- `src/data/final-jito-evidence.json`
- `docs/evidence/final-jito-evidence-summary.md`
- `docs/evidence/final-jito-evidence-summary.json`

The deployed `/api/jito/bundle-status` route reads `.data/jito-evidence.json` when it exists. On Vercel or production builds where `.data` is missing or empty, it falls back to `src/data/final-jito-evidence.json`, a sanitized static evidence file containing only public bundle metadata, status timestamps, landed slots, network, tip, transaction count, source, and failure classification when present. Secret keys, raw payloads, signed transactions, and private environment values are not included.

Bundle ID alone was not treated as success; status was checked separately. Only `latestStatus: landed` with `checkedAt` and `landedSlot` is claimed as landed. `network-error` and failed records are observed failed operational evidence from testnet status checks and are not counted as landed.

## Current Implementation Status

Completed:

- Dashboard UI.
- Real Solana devnet status API.
- Real devnet Memo transaction lifecycle test.
- Simulated transaction lifecycle.
- Simulated failure injection.
- Retry-agent decision logic.
- Jito adapter pattern.
- Simulated Jito bundle submission.
- Disabled-by-default Jito testnet submission and separate status route.
- Thirty-one landed real Jito testnet submissions with separate status checks in the sanitized final evidence export.
- Dynamic tip and leader-window logic.
- SolInfra Yellowstone gRPC slot stream adapter, validated with a live slot stream, with safe RPC fallback when endpoint/token credentials are absent or the stream is unavailable.

Not yet implemented:

- Production wallet management.
- Persistent lifecycle storage.

## How to Run Locally

```bash
npm install
npm run dev
```

Open:

```bash
http://localhost:3000
```

Build verification:

```bash
npm run lint
npm run build
```

## Environment Variables

Create `.env.local` from `.env.example`.

```bash
NEXT_PUBLIC_SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_DEVNET_SECRET_KEY=[1,2,3...]
SOLANA_TESTNET_SECRET_KEY=[1,2,3...]
JITO_ENABLED=false
JITO_BLOCK_ENGINE_URL=https://testnet.block-engine.jito.wtf
JITO_SOLANA_RPC_URL=https://api.testnet.solana.com
JITO_TESTNET_SECRET_KEY=[1,2,3...]
JITO_TIP_LAMPORTS=1000
SOLINFRA_GRPC_ENDPOINT=https://your-solinfra-yellowstone-fra-endpoint:443
SOLINFRA_API_KEY=your-solinfra-api-key
YELLOWSTONE_GRPC_ENDPOINT=https://your-yellowstone-endpoint:443
YELLOWSTONE_GRPC_TOKEN=your-yellowstone-token
YELLOWSTONE_COMMITMENT=processed
```

`SOLANA_DEVNET_SECRET_KEY` must be a JSON array of 64 integers. It is used only by the server-side devnet Memo transaction API route.

`JITO_TESTNET_SECRET_KEY` must be a JSON array of 64 integers. It is used only by the server-side Jito testnet bundle route to sign the appended tip transaction. Jito remains off unless `JITO_ENABLED=true`.

## Safe Testnet Wallet Setup

Generate a fresh testnet-only wallet with `@solana/web3.js`. This repo includes `generate-wallet.js`, which calls `Keypair.generate()` and prints the public key plus the JSON secret-key array:

```bash
node generate-wallet.js
```

The output will look like:

```bash
PUBLIC KEY:
YourPublicKeyBase58

SECRET KEY:
[12,34,56,...]
```

Put the JSON array in `.env.local` at the project root:

```bash
SOLANA_TESTNET_SECRET_KEY=[12,34,56,...]
JITO_ENABLED=false
```

For the current Jito testnet route, copy the same testnet-only JSON array into `JITO_TESTNET_SECRET_KEY` only when you are intentionally preparing Jito testnet submission:

```bash
JITO_TESTNET_SECRET_KEY=[12,34,56,...]
```

Never commit `.env.local`. The repo `.gitignore` already ignores `.env*` and only allows `.env.example`, but still check `git status` before committing. Fund only the generated testnet wallet with testnet SOL; never fund it on mainnet, never paste a mainnet wallet here, and never reuse a production keypair. Jito remains disabled unless `JITO_ENABLED=true`.

Yellowstone improves judge-ready slot monitoring because RPC polling alone cannot provide the same low-latency stream ordering, skipped/dead slot signals, or processed-to-confirmed timing from a stream. Triton Dragon's Mouth documents Yellowstone gRPC as a backend stream, so BundleIQ keeps it server-side only. Final validation connected through SolInfra Yellowstone in FRA using server-side endpoint/API-key configuration. If SolInfra/Yellowstone credentials are absent or the stream is unavailable, the app does not crash and does not claim Yellowstone is connected; `/api/solana/stream-status` returns `source: "rpc-fallback"` with devnet RPC slot data and a direct stream status message.

## Deployment Notes

- Jito evidence on Vercel comes from `src/data/final-jito-evidence.json` when `.data/jito-evidence.json` is unavailable or empty. The API still prefers local `.data` evidence in runtime environments where it exists.
- Yellowstone gRPC is loaded server-side through the package's CommonJS export to avoid Vercel/Node parsing the package's ESM `.js` output as CommonJS. Local Node runtime Yellowstone remains supported when SolInfra endpoint/token values are configured.
- If Vercel serverless cannot maintain the Yellowstone stream, `/api/solana/stream-status` returns `source: "rpc-fallback"` and the dashboard/requirement tracker must treat slot streaming as fallback evidence, not Done. Use the SolInfra active connection screenshot from local validation as Yellowstone evidence in that case.

## Devnet Safety Notes

- Devnet only.
- No mainnet endpoint is used.
- No mainnet funds are required.
- No private keys are exposed to client code.
- No private keys are stored in localStorage.
- No private keys are logged.
- Jito bundle submission is disabled by default and testnet-only when enabled.
- Jito `sendBundle` receipts are labeled `submitted-not-landed` until checked separately.
- Jito `network-error` records are failed operational evidence from testnet status checks, not landed bundles.
- Yellowstone slot monitoring is server-side only and falls back to devnet RPC when credentials are absent or the stream is unavailable.
- RPC fallback is Partial evidence only when a live Yellowstone stream is not connected.
- Local Jito judge evidence is stored in `.data/jito-evidence.json` for export and screenshots. It stores bundle/status metadata only; secret keys are never stored.

## Known Limitations

- Dashboard Jito bundle results are simulated unless the server-side testnet route is called directly with `JITO_ENABLED=true`.
- Jito leader windows are estimated, not sourced from a real Jito leader schedule API.
- Failure cases are simulated except for server/RPC errors during real devnet Memo submission.
- Lifecycle rows are held in client state and are not persisted.
- SolInfra Yellowstone slot streaming connected during final validation. Without compatible credentials or during stream outage, the dashboard shows RPC fallback status and does not mark streaming as connected.

## Next Steps

- Add persistent storage for lifecycle logs.
- Add real leader schedule data.
- Expand Yellowstone ingestion beyond slot monitoring when needed.
- Keep future Jito evidence exports sanitized and avoid committing raw `.data/` evidence.

## Final Submission Checklist

- [ ] GitHub repo URL: add final repository link before submission.
- [ ] Deployed dashboard link: add final deployment URL before submission.
- [x] Architecture doc: `docs/ARCHITECTURE.md`.
- [ ] Public Architecture Document: [TO BE ADDED: Google Docs/Notion public URL].
- [x] Evidence export: `docs/evidence/final-jito-evidence-summary.md` and `docs/evidence/final-jito-evidence-summary.json`.
- [ ] Screenshots: capture dashboard/evidence screenshots before final upload.
- [x] README answers: included below.
- [x] SolInfra Yellowstone final validation: connected to live gRPC stream.
- [x] Build and lint: `npm run lint` and `npm run build` pass.

## Judge Questions

### Question 1: What does the delta between processed and confirmed tell you about network health?

The delta between `processed` and `confirmed` shows how long it takes for a transaction to move from initial validator observation to cluster confirmation. A small delta usually indicates healthy propagation, low congestion, and fast vote confirmation. A growing delta suggests congestion, slow validator vote propagation, RPC lag, skipped slots, or degraded leader performance. For latency-sensitive bundle logic, this delta is a useful signal for whether to increase tip, delay submission, or retry through a different path.

### Question 2: Why should you never use finalized commitment when fetching a blockhash for time-sensitive transactions?

Fetching a blockhash at `finalized` commitment gives you an older blockhash because finalized data lags behind the head of the chain. Time-sensitive transactions need as much remaining blockhash validity as possible. If you fetch a finalized blockhash, the transaction has less time before `lastValidBlockHeight`, increasing the chance of blockhash expiration before the transaction is processed or bundled. For time-sensitive transactions, use `processed` or `confirmed` depending on the safety/latency tradeoff.

### Question 3: What happens to your bundle if the Jito leader skips their slot?

If the targeted Jito leader skips their slot, the bundle misses the intended execution window. The bundle may not land, may need to be rebuilt for a later leader window, and may require a fresh blockhash because the original blockhash continues aging while the opportunity is missed. The retry strategy should detect the missed leader window, refresh blockhash if needed, recalculate tip for the next viable leader, and resubmit through the adapter once timing is favorable.
