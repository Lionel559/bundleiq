import {
  calculateStageDeltas,
  type SimulatedLifecycleEntry,
} from "@/lib/solana/lifecycle-tracker";
import type { SimulatedFailure } from "@/lib/solana/fault-injection";
import type { RetryDecision } from "@/lib/retry/retry-agent";
import type { YellowstoneStreamStatusResponse } from "@/lib/grpc/slot-store";
import type {
  RealJitoBundleEvidenceRecord,
  RealJitoStatusCheckEvidence,
} from "@/lib/jito/evidence-store";
import type {
  BundleSubmissionResult,
  BundleTipDecision,
  JitoLeaderWindow,
} from "@/types/jito";
import type { JudgeRequirementCheck } from "@/lib/requirements/evaluate-requirements";

export interface EvidenceAIDecisionInput {
  decision: string;
  reason: string;
  tipDecision: BundleTipDecision;
  leaderWindow: JitoLeaderWindow;
  retryDecision: RetryDecision | null;
  signals: string[];
  activeBundle: BundleSubmissionResult;
}

function tableCell(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "n/a";
  }

  return String(value).replace(/\|/g, "/");
}

function lifecycleSource(entry: SimulatedLifecycleEntry) {
  if (
    entry.source === "real-devnet-memo" ||
    entry.source === "real-devnet"
  ) {
    return "real-devnet-memo";
  }

  return "mock simulation";
}

function formatTimestamp(timestamp?: string) {
  return timestamp ?? "n/a";
}

const NETWORK_ERROR_RECOVERY_RECOMMENDATION =
  "Retry the bundle-status check after RPC/Jito connectivity recovers; keep the bundle submitted-not-landed until a separate status check returns landed.";
const SYNTHETIC_NETWORK_ERROR_BUNDLE_PREFIX = "biq-network-error-";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringifyUnknown(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function nonEmptyString(value: unknown) {
  const stringValue = stringifyUnknown(value).trim();

  return stringValue.length > 0 ? stringValue : null;
}

function payloadString(payload: unknown, key: string) {
  if (!isRecord(payload)) {
    return null;
  }

  return nonEmptyString(payload[key]);
}

function payloadNumber(payload: unknown, key: string) {
  if (!isRecord(payload)) {
    return null;
  }

  const value = payload[key];

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function exportedNetworkErrorBundleId(bundleId: string) {
  return bundleId.startsWith(SYNTHETIC_NETWORK_ERROR_BUNDLE_PREFIX)
    ? "n/a"
    : bundleId;
}

function networkErrorMessage(
  record: RealJitoBundleEvidenceRecord,
  check?: RealJitoStatusCheckEvidence,
) {
  return (
    nonEmptyString(check?.error) ??
    nonEmptyString(record.error) ??
    payloadString(check?.rawStatusPayload, "reason") ??
    payloadString(record.rawStatusPayload, "reason") ??
    "n/a"
  );
}

function networkErrorRetryAttempts(
  record: RealJitoBundleEvidenceRecord,
  check?: RealJitoStatusCheckEvidence,
) {
  const retryAttempts =
    payloadNumber(check?.rawStatusPayload, "retryAttempts") ??
    payloadNumber(record.rawStatusPayload, "retryAttempts");
  const pollAttempt =
    payloadNumber(check?.rawStatusPayload, "pollAttempt") ??
    payloadNumber(record.rawStatusPayload, "pollAttempt");

  if (retryAttempts !== null && pollAttempt !== null) {
    return `fetch retries ${retryAttempts}; status poll ${pollAttempt}`;
  }

  if (retryAttempts !== null) {
    return retryAttempts;
  }

  if (pollAttempt !== null) {
    return `status poll ${pollAttempt}`;
  }

  const retryMatch = networkErrorMessage(record, check).match(
    /after\s+(\d+)\s+retr(?:y|ies)/i,
  );

  return retryMatch?.[1] ?? "n/a";
}

function networkErrorRecoveryRecommendation(
  record: RealJitoBundleEvidenceRecord,
  check?: RealJitoStatusCheckEvidence,
) {
  return (
    payloadString(check?.rawStatusPayload, "recoveryRecommendation") ??
    payloadString(record.rawStatusPayload, "recoveryRecommendation") ??
    NETWORK_ERROR_RECOVERY_RECOMMENDATION
  );
}

function networkErrorExportRows(records: RealJitoBundleEvidenceRecord[]) {
  return records.flatMap((record) => {
    const networkErrorChecks = record.statusChecks.filter(
      (check) => check.status === "network-error",
    );

    if (networkErrorChecks.length === 0 && record.latestStatus === "network-error") {
      return [
        [
          tableCell(exportedNetworkErrorBundleId(record.bundleId)),
          tableCell(record.submittedAt),
          tableCell(record.checkedAt ?? record.statusCheckedAt),
          tableCell(networkErrorMessage(record)),
          tableCell(networkErrorRetryAttempts(record)),
          tableCell(networkErrorRecoveryRecommendation(record)),
        ].join(" | "),
      ];
    }

    return networkErrorChecks.map((check) =>
      [
        tableCell(exportedNetworkErrorBundleId(check.bundleId)),
        tableCell(record.submittedAt),
        tableCell(check.checkedAt),
        tableCell(networkErrorMessage(record, check)),
        tableCell(networkErrorRetryAttempts(record, check)),
        tableCell(networkErrorRecoveryRecommendation(record, check)),
      ].join(" | "),
    );
  });
}

export function exportLifecycleAsJson(
  entries: SimulatedLifecycleEntry[],
  generatedAt = new Date().toISOString(),
) {
  return JSON.stringify(
    {
      projectName: "BundleIQ",
      generatedAt,
      note: "Lifecycle evidence only. Real devnet memo rows are marked real-devnet-memo; simulated rows are marked mock-simulation. Devnet memo rows are not Jito bundle submissions.",
      lifecycle: entries.map((entry) => ({
        id: entry.id,
        signature: entry.signature,
        slot: entry.slot,
        stage: entry.stage,
        source: lifecycleSource(entry),
        route: entry.route,
        tipLamports: entry.tipLamports,
        submittedAt: entry.submittedAt,
        processedAt: entry.processedAt ?? null,
        confirmedAt: entry.confirmedAt ?? null,
        finalizedAt: entry.finalizedAt ?? null,
        failedAt: entry.failedAt ?? null,
        latency: calculateStageDeltas(entry),
        failureType: entry.failure?.failureType ?? null,
        failureReason: entry.failure?.reason ?? null,
      })),
    },
    null,
    2,
  );
}

export function exportLifecycleAsMarkdown(entries: SimulatedLifecycleEntry[]) {
  const rows = entries.map((entry) => {
    const deltas = calculateStageDeltas(entry);

    return [
      tableCell(entry.signature),
      tableCell(entry.slot),
      tableCell(entry.stage),
      tableCell(lifecycleSource(entry)),
      tableCell(entry.route),
      tableCell(formatTimestamp(entry.submittedAt)),
      tableCell(formatTimestamp(entry.processedAt)),
      tableCell(formatTimestamp(entry.confirmedAt)),
      tableCell(formatTimestamp(entry.finalizedAt)),
      tableCell(`${deltas.totalLatencyMs}ms`),
      tableCell(entry.failure?.failureType ?? "none"),
    ].join(" | ");
  });

  return [
    "## Transaction Lifecycle Logs",
    "",
    "| Signature | Slot | Stage | Evidence Source | Route | Submitted | Processed | Confirmed | Finalized | Total Latency | Failure |",
    "| --- | ---: | --- | --- | --- | --- | --- | --- | --- | ---: | --- |",
    ...rows.map((row) => `| ${row} |`),
  ].join("\n");
}

export function exportFailureCasesAsMarkdown(failures: SimulatedFailure[]) {
  const rows = failures.map((failure) =>
    [
      tableCell(failure.id),
      tableCell(failure.failureType),
      tableCell("simulation"),
      tableCell(failure.reason),
      tableCell(failure.recoveryAction),
      tableCell(failure.retryRequired),
    ].join(" | "),
  );

  return [
    "## Failure Cases",
    "",
    "| ID | Failure Type | Evidence Source | Reason | Recovery Action | Retry Required |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row} |`),
  ].join("\n");
}

export function exportAIDecisionsAsMarkdown(input: EvidenceAIDecisionInput) {
  return [
    "## AI Agent Decisions",
    "",
    `- Evidence source: deterministic simulation logic`,
    `- Decision: ${input.decision}`,
    `- Reason: ${input.reason}`,
    `- Tip decision: ${input.tipDecision.tipLamports} lamports (${input.tipDecision.reason})`,
    `- Tip confidence: ${input.tipDecision.confidence}%`,
    `- Leader timing: distance ${input.leaderWindow.leaderDistance} slots; ${
      input.leaderWindow.shouldSubmitNow ? "submit now" : "do not submit yet"
    }`,
    `- Retry decision: ${
      input.retryDecision?.shouldRetry ? "retry" : "no retry"
    }`,
    `- Retry reason: ${input.retryDecision?.reason ?? "No retry required."}`,
    `- Active bundle evidence: ${input.activeBundle.mode}; status ${input.activeBundle.status}. sendBundle receipts are not treated as landed.`,
    `- Active bundle id: ${input.activeBundle.bundleId}`,
    `- Signals: ${input.signals.join(", ")}`,
  ].join("\n");
}

export function exportRealJitoEvidenceAsMarkdown(
  records: RealJitoBundleEvidenceRecord[],
) {
  const networkErrorRows = networkErrorExportRows(records);
  const rows = records.map((record) =>
    [
      tableCell(record.bundleId),
      tableCell(record.network),
      tableCell(record.source),
      tableCell(record.submittedAt),
      tableCell(record.latestStatus),
      tableCell(record.statusCheckedAt),
      tableCell(record.landedSlot),
      tableCell(record.confirmationLevel ?? record.confirmationStatus),
      tableCell(record.tipLamports),
      tableCell(record.transactionCount),
      tableCell(record.failureClassification ?? "none"),
    ].join(" | "),
  );

  return [
    "## Real Jito Evidence",
    "",
    `- Persisted records: ${records.length}`,
    "- Evidence source: `.data/jito-evidence.json` via `/api/jito/bundle-status`",
    "- Secret keys and signed transaction bytes are not stored in this evidence file.",
    "- Network-error records are failed operational evidence from status checks and are not landed Jito submissions.",
    "",
    "| Bundle ID | Network | Source | Submitted | Latest Status | Checked At | Landed Slot | Confirmation | Tip Lamports | Transaction Count | Failure Classification |",
    "| --- | --- | --- | --- | --- | --- | ---: | --- | ---: | ---: | --- |",
    ...rows.map((row) => `| ${row} |`),
    "",
    "### Network Error Records",
    "",
    "| Bundle ID If Available | Submitted At | Checked At | Error Message | Retry Attempts | Recovery Recommendation |",
    "| --- | --- | --- | --- | --- | --- |",
    ...(networkErrorRows.length > 0
      ? networkErrorRows.map((row) => `| ${row} |`)
      : ["| n/a | n/a | n/a | n/a | n/a | n/a |"]),
  ].join("\n");
}

export function exportNetworkStatusAsMarkdown(
  status: YellowstoneStreamStatusResponse,
) {
  const evidenceSource =
    status.streamError?.toLowerCase().includes("mock fallback")
      ? "Mock fallback"
      : status.source === "yellowstone" && status.streamConnected
      ? "Yellowstone connected"
      : "RPC fallback";

  return [
    "## Current Network Status",
    "",
    `- Evidence source: ${evidenceSource}`,
    `- Source field: ${status.source}`,
    `- Current slot: ${status.currentSlot}`,
    `- Processed slot: ${status.processedSlot ?? "n/a"}`,
    `- Confirmed slot: ${status.confirmedSlot ?? "n/a"}`,
    `- Finalized slot: ${status.finalizedSlot ?? "n/a"}`,
    `- Commitment: ${status.commitment}`,
    `- Stream connected: ${status.streamConnected}`,
    `- Stream status: ${status.streamStatus}`,
    `- Stream error: ${status.streamError ?? "none"}`,
    `- Last stream update: ${status.lastStreamUpdate ?? "n/a"}`,
  ].join("\n");
}

export function exportRequirementStatusAsMarkdown(
  requirements: JudgeRequirementCheck[],
) {
  const rows = requirements.map((requirement) =>
    [
      tableCell(requirement.label),
      tableCell(requirement.status),
      tableCell(
        requirement.status === "done"
            ? "implemented"
            : requirement.status === "partial"
              ? "partial/mock/simulation"
              : "not yet implemented",
      ),
      tableCell(
        requirement.countLabel
          ? `${requirement.evidence} Count: ${requirement.countLabel}.`
          : requirement.evidence,
      ),
    ].join(" | "),
  );

  return [
    "## Requirement Tracker Status",
    "",
    "| Requirement | Status | Evidence Source | Evidence |",
    "| --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row} |`),
    "",
    "Note: BundleIQ does not count devnet memo lifecycle evidence as Jito bundles and does not claim landed Jito bundle submissions.",
  ].join("\n");
}
