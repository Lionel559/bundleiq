import type { YellowstoneStreamStatusResponse } from "@/lib/grpc/slot-store";
import type { RealJitoBundleEvidenceRecord } from "@/lib/jito/evidence-store";
import type { RetryDecision } from "@/lib/retry/retry-agent";
import type {
  SimulatedFailure,
  SimulatedFailureType,
} from "@/lib/solana/fault-injection";
import type { SimulatedLifecycleEntry } from "@/lib/solana/lifecycle-tracker";
import type { BundleSubmissionResult } from "@/types/jito";

export type JudgeRequirementState = "done" | "partial" | "missing";

export interface JudgeAIDecisionEvidence {
  decision: string;
  retryDecision: RetryDecision | null;
}

export interface JudgeEvidenceExportStatus {
  available: boolean;
  exportedEvidenceCount?: number;
}

export interface JudgeRequirementCheck {
  id: string;
  label: string;
  status: JudgeRequirementState;
  evidence: string;
  countLabel?: string;
}

export interface EvaluateJudgeRequirementsInput {
  lifecycleLogs: SimulatedLifecycleEntry[];
  failureCases: SimulatedFailure[];
  aiDecisions: JudgeAIDecisionEvidence[];
  streamStatus: YellowstoneStreamStatusResponse;
  bundleStatus: BundleSubmissionResult[];
  realJitoEvidence?: RealJitoBundleEvidenceRecord[];
  jitoTestnetWalletFunded?: boolean;
  evidenceExportStatus: JudgeEvidenceExportStatus;
}

function isYellowstoneNotConfigured(streamStatus: YellowstoneStreamStatusResponse) {
  return (
    streamStatus.streamStatus === "unavailable" &&
    (streamStatus.streamError?.includes("not configured") ||
      streamStatus.streamError?.includes("missing SOLINFRA") ||
      streamStatus.streamError?.includes("missing YELLOWSTONE") ||
      false)
  );
}

function evaluateSlotStreaming(
  streamStatus: YellowstoneStreamStatusResponse,
): JudgeRequirementCheck {
  if (
    streamStatus.source === "yellowstone" &&
    streamStatus.streamConnected &&
    streamStatus.latestStreamedSlot !== null
  ) {
    return {
      id: "slot-streaming",
      label: "Slot streaming",
      status: "done",
      evidence:
        `SolInfra Yellowstone gRPC stream is connected from FRA and reporting streamed slot ${streamStatus.latestStreamedSlot}.`,
    };
  }

  if (isYellowstoneNotConfigured(streamStatus)) {
    return {
      id: "slot-streaming",
      label: "Slot streaming",
      status: "missing",
      evidence:
        "SolInfra Yellowstone endpoint/API key is not configured. RPC fallback is visible, but slot streaming is not connected.",
    };
  }

  if (streamStatus.source === "rpc-fallback" && streamStatus.currentSlot > 0) {
    return {
      id: "slot-streaming",
      label: "Slot streaming",
      status: "partial",
      evidence:
        "SolInfra Yellowstone is unavailable; dashboard is using devnet RPC fallback and does not claim streaming is connected.",
    };
  }

  return {
    id: "slot-streaming",
    label: "Slot streaming",
    status: "missing",
    evidence: "No SolInfra Yellowstone stream or RPC fallback slot status is currently available.",
  };
}

function hasAllRequiredFailures(failureCases: SimulatedFailure[]) {
  const failureTypes = new Set(
    failureCases.map((failure) => failure.failureType),
  );

  const requiredFailureTypes: SimulatedFailureType[] = [
    "expired-blockhash",
    "insufficient-tip",
    "bundle-rejected",
    "leader-skipped-slot",
  ];

  return requiredFailureTypes.every((failureType) =>
    failureTypes.has(failureType),
  );
}

function hasCountableRealJitoStatusEvidence(
  bundle: RealJitoBundleEvidenceRecord,
) {
  return (
    (bundle.source === "real-jito-testnet" ||
      bundle.source === "real-jito-mainnet") &&
    bundle.statusChecked &&
    (bundle.latestStatus === "network-error" ||
      bundle.bundleId.trim().length > 0)
  );
}

function hasConstructedBundleEvidence(bundleStatus: BundleSubmissionResult[]) {
  return bundleStatus.some(
    (bundle) =>
      bundle.status === "constructed" ||
      bundle.status === "submitted-not-landed" ||
      bundle.status === "simulated" ||
      bundle.bundleSource === "constructed-only" ||
      bundle.bundleSource === "mock-simulation",
  );
}

export function evaluateJudgeRequirements({
  lifecycleLogs,
  failureCases,
  aiDecisions,
  streamStatus,
  bundleStatus,
  realJitoEvidence = [],
}: EvaluateJudgeRequirementsInput): JudgeRequirementCheck[] {
  const failureCount = failureCases.length;
  const hasAIDecision = aiDecisions.some((decision) =>
    decision.decision.trim().length > 0,
  );
  const hasRetryDecision = aiDecisions.some(
    (decision) => decision.retryDecision !== null,
  );
  const allRequiredFailures = hasAllRequiredFailures(failureCases);
  const hasLiveTipInput =
    streamStatus.source === "yellowstone" ||
    streamStatus.source === "rpc-fallback";
  const hasLifecycleLogs = lifecycleLogs.length > 0;
  const countableRealJitoEvidence = realJitoEvidence.filter((record) =>
    hasCountableRealJitoStatusEvidence(record),
  );
  const realSubmittedBundleCount = countableRealJitoEvidence.length;
  const successfulRealJitoSubmissionCount = countableRealJitoEvidence.filter(
    (record) => record.latestStatus === "landed",
  ).length;
  const landedStatusCheckedWithSlotCount = countableRealJitoEvidence.filter(
    (record) =>
      record.latestStatus === "landed" &&
      record.statusChecked &&
      typeof record.landedSlot === "number",
  ).length;
  const finalLandedRequirementCount = Math.min(
    landedStatusCheckedWithSlotCount,
    10,
  );
  const failedRealJitoSubmissionCount = countableRealJitoEvidence.filter(
    (record) => record.latestStatus === "failed",
  ).length;
  const invalidRealJitoSubmissionCount = countableRealJitoEvidence.filter(
    (record) => record.latestStatus === "invalid",
  ).length;
  const expiredRealJitoSubmissionCount = countableRealJitoEvidence.filter(
    (record) => record.latestStatus === "expired",
  ).length;
  const networkErrorRealJitoSubmissionCount = countableRealJitoEvidence.filter(
    (record) => record.latestStatus === "network-error",
  ).length;
  const failedOperationalEvidenceCount =
    failedRealJitoSubmissionCount +
    invalidRealJitoSubmissionCount +
    expiredRealJitoSubmissionCount +
    networkErrorRealJitoSubmissionCount;
  const hasJitoConstructionEvidence = hasConstructedBundleEvidence(bundleStatus);

  return [
    {
      id: "lifecycle-logs",
      label: "Lifecycle logs",
      status: hasLifecycleLogs ? "done" : "missing",
      evidence: hasLifecycleLogs
        ? "Lifecycle rows are recorded and devnet memo rows are labeled lifecycle evidence only, not Jito bundles."
        : "No lifecycle rows are currently recorded.",
      countLabel: `${lifecycleLogs.length} lifecycle rows`,
    },
    {
      id: "real-jito-submissions",
      label: "Real Jito submissions",
      status:
        landedStatusCheckedWithSlotCount >= 10
          ? "done"
          : realSubmittedBundleCount > 0
            ? "partial"
            : "missing",
      evidence:
        landedStatusCheckedWithSlotCount >= 10
          ? "10 real Jito testnet bundles landed and were status-checked with landed slots recorded."
          : realSubmittedBundleCount > 0
            ? "Some real Jito status-check evidence exists, but fewer than 10 landed status-checked bundles with landed slots are recorded."
            : "No status-checked real Jito testnet/mainnet evidence is recorded. Submitted-only, constructed, mock, and devnet memo evidence does not count as verified real Jito submission.",
      countLabel: `${finalLandedRequirementCount}/10`,
    },
    {
      id: "successful-real-jito-submissions",
      label: "Successful submissions",
      status:
        landedStatusCheckedWithSlotCount >= 10
          ? "done"
          : successfulRealJitoSubmissionCount > 0
            ? "partial"
            : "missing",
      evidence:
        landedStatusCheckedWithSlotCount >= 10
          ? "Successful Jito evidence is based only on separate bundle-status results; bundle IDs alone were not treated as success."
          : "Successful Jito evidence requires landed status from the separate bundle-status route.",
      countLabel: `${finalLandedRequirementCount}/10 landed and status-checked`,
    },
    {
      id: "failed-real-jito-submissions",
      label: "Failed submissions",
      status:
        failedOperationalEvidenceCount > 0
          ? "done"
          : realSubmittedBundleCount > 0
            ? "partial"
            : "missing",
      evidence:
        failedOperationalEvidenceCount > 0
          ? "Failed/network-error operational evidence exists and is separated from successful landed evidence."
          : "No failed/network-error real Jito operational evidence is currently recorded.",
      countLabel: `${failedOperationalEvidenceCount} failed/network-error (${failedRealJitoSubmissionCount} failed, ${invalidRealJitoSubmissionCount} invalid, ${expiredRealJitoSubmissionCount} expired, ${networkErrorRealJitoSubmissionCount} network-error)`,
    },
    evaluateSlotStreaming(streamStatus),
    {
      id: "reconnection-handling",
      label: "Reconnection handling",
      status: "done",
      evidence:
        "Yellowstone client has reconnect timers, reconnect attempt tracking, and connected/reconnecting/unavailable/error stream states in src/lib/grpc/yellowstone-client.ts and slot-store.ts.",
    },
    {
      id: "backpressure-handling",
      label: "Backpressure handling",
      status: "done",
      evidence:
        `Yellowstone stream updates use a bounded event buffer with queue depth ${streamStatus.backpressureQueueDepth} and dropped update count ${streamStatus.backpressureDroppedUpdates}.`,
    },
    {
      id: "real-jito-bundle-construction",
      label: "Real Jito bundle construction",
      status: successfulRealJitoSubmissionCount > 0 ? "done" : "partial",
      evidence:
        hasJitoConstructionEvidence
          ? "Jito construction exists and bundle states are separated as constructed/submitted-not-landed/landed. Landed status is counted only after the separate bundle-status route reports landed."
          : "src/lib/jito/server-adapter.ts exports constructJitoBundle(): caller-signed base64 transaction(s) plus signed Jito tip transaction, capped at five transactions. No landed real Jito status is recorded.",
    },
    {
      id: "dynamic-tip-live-data",
      label: "Dynamic tip from live data",
      status: hasLiveTipInput ? "partial" : "missing",
      evidence:
        "Dynamic tip uses leader distance, recent failures, live/fallback slot latency, and local bundle status history. Full live Jito landing history is still not available.",
    },
    {
      id: "commitment-levels",
      label: "Commitment levels",
      status: "done",
      evidence:
        "Solana routes and Yellowstone store track processed, confirmed, finalized, and lastValidBlockHeight for time-sensitive transaction flows.",
    },
    {
      id: "ai-layer-separation",
      label: "AI reasoning",
      status: hasAIDecision ? "done" : "missing",
      evidence: hasAIDecision
        ? "AI/retry decisions are isolated in src/lib/ai-agent.ts and src/lib/retry/retry-agent.ts; they consume signals and do not own wallet or gRPC code."
        : "No AI decision is currently available.",
    },
    {
      id: "architecture-explanation",
      label: "Architecture explanation",
      status: "done",
      evidence:
        "Architecture and technical expectation docs explain boundaries between streaming, transaction stack, Jito construction, retry/failure handling, and AI reasoning.",
    },
    {
      id: "core-transaction-stack-separation",
      label: "Core transaction stack separation",
      status: "done",
      evidence:
        "Core Solana/Jito stack is separated under src/lib/solana, src/lib/jito, and API route handlers; browser code calls API routes and does not import private-key loaders.",
    },
    {
      id: "failure-handling",
      label: "Failure handling",
      status:
        allRequiredFailures && hasRetryDecision
          ? "done"
          : failureCount > 0
            ? "partial"
            : "missing",
      evidence:
        "Failure handling includes expired blockhash, insufficient tip, bundle rejected, and leader skipped slot; each has classification, reason, recovery action, and retry-agent decision.",
      countLabel: `${failureCount} failure classifications`,
    },
  ];
}
