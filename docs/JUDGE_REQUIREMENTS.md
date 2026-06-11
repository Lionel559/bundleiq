# Judge Requirements

## Checklist

| Requirement | Status | Evidence |
| --- | --- | --- |
| Architecture design document | Completed | `docs/ARCHITECTURE.md` |
| Real bundle submissions | Completed | 31 real Jito testnet bundles landed and were status-checked in `docs/evidence/final-jito-evidence-summary.md`; private raw evidence contains 62 unique bundles with status checks and 76 total status-check attempts |
| 2 failure cases | Simulated | Fault injection includes five simulated cases |
| Lifecycle logs | Completed | Dashboard tracks real devnet Memo and simulated lifecycle rows |
| AI-owned decision | Simulated | AI panel combines tip, leader timing, and retry decisions |
| Autonomous retry | Simulated | `src/lib/retry/retry-agent.ts` returns retry actions |
| Fault injection | Completed / simulated | `src/lib/solana/fault-injection.ts` |
| README questions | Completed | README includes all three answers |

## Requirement Details

### Architecture Design Document

Completed in `docs/ARCHITECTURE.md`.

### Real Bundle Submissions

Exceeded for the final observed run. BundleIQ has server-only Jito testnet routes built from the official Jito docs/SDK model:

- `POST /api/jito/bundle`
- `POST /api/jito/bundle-status`

The route remains disabled unless `JITO_ENABLED=true` and a usable endpoint/network/wallet are configured. It defaults to Jito testnet, rejects mainnet-like URLs, caps bundles at five signed transactions, appends a Jito tip instruction, base64-encodes signed transactions, labels `sendBundle` results as `submitted-not-landed`, and requires a separate status check. Constructed bundles and devnet Memo rows do not count as landed Jito bundles.

Final observed evidence from `.data/jito-evidence.json` was sanitized into:

- `docs/evidence/final-jito-evidence-summary.md`
- `docs/evidence/final-jito-evidence-summary.json`

Observed counts from the final sanitized export and private raw evidence:

- Landed real Jito bundles: 31
- Unique bundles with status checks: 62
- Total status-check attempts: 76
- Landed slots recorded: 31
- Yellowstone: not configured; RPC fallback only

This follows the official Jito block-engine docs plus the Jito SDK/RPC examples conceptually: submission and landing are separate, and a bundle id is not proof of landing.

Bundle ID alone was not treated as success; status was checked separately.

### 2 Failure Cases

Simulated. Current failure types:

- expired blockhash
- insufficient tip
- compute exceeded
- bundle rejected
- leader skipped slot

### Lifecycle Logs

Implemented for:

- real devnet Memo transactions
- simulated lifecycle entries

Real devnet Memo rows are clearly labeled `Real Devnet`. Simulated rows are labeled `Mock Simulation`.

### AI-Owned Decision

Simulated. The AI panel uses deterministic decision helpers:

- `calculateDynamicTip()`
- `estimateLeaderWindow()`
- `decideRetryAction()`

### Autonomous Retry

Simulated. Retry decisions are generated automatically from failure type, blockhash age, current tip, leader distance, and RPC latency. No real resubmission loop runs yet.

### Fault Injection

Implemented as simulation in `src/lib/solana/fault-injection.ts`.

### README Questions

Completed in `README.md`.

## Explicit Non-Claims

- BundleIQ does not count a real Jito bundle as landed until the separate bundle-status route records `landed` evidence.
- BundleIQ treats `network-error` as failed operational evidence, not landed evidence.
- BundleIQ only integrates Yellowstone slot monitoring; transactions and accounts are not subscribed yet.
- BundleIQ does not claim a connected Yellowstone stream in the final public artifacts because credentials are not currently configured; the app reports RPC fallback/missing instead.
- BundleIQ does not use mainnet by default and rejects mainnet-like Jito URLs.
- BundleIQ does not expose private keys in browser code.

## Local Evidence Persistence

Real Jito judge evidence is persisted locally in `.data/jito-evidence.json` so bundle IDs, status checks, landed slots, failure classifications, and lifecycle events survive server refreshes for export and screenshots. The file stores evidence metadata only; secret keys and signed transaction bytes are never stored. Raw `.data/` evidence remains ignored by Git; final review should use the sanitized exports in `docs/evidence/`.
