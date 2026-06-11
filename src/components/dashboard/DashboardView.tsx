"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Bot,
  Download,
  FileJson,
  Gauge,
  PackageCheck,
  Play,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import { SectionPanel } from "@/components/shared/SectionPanel";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  compactSignature,
  formatDuration,
  formatLamports,
  formatSlot,
  formatSolFromLamports,
} from "@/lib/solana";
import {
  getSimulatedFailures,
  injectExpiredBlockhashFailure,
  injectRandomFailure,
  type SimulatedFailure,
} from "@/lib/solana/fault-injection";
import {
  calculateStageDeltas,
  classifyFinalStatus,
  createLifecycleEntry,
  type DevnetMemoLifecycleResult,
  progressLifecycleEntry,
  type SimulatedLifecycleEntry,
} from "@/lib/solana/lifecycle-tracker";
import { decideRetryAction, type RetryDecision } from "@/lib/retry/retry-agent";
import {
  calculateDynamicTip,
  estimateLeaderWindow,
  prepareBundlePayload,
  simulateBundleSubmission,
} from "@/lib/jito";
import {
  exportAIDecisionsAsMarkdown,
  exportFailureCasesAsMarkdown,
  exportLifecycleAsJson,
  exportLifecycleAsMarkdown,
  exportNetworkStatusAsMarkdown,
  exportRealJitoEvidenceAsMarkdown,
  exportRequirementStatusAsMarkdown,
} from "@/lib/evidence/export-evidence";
import {
  evaluateJudgeRequirements,
  type JudgeRequirementCheck,
  type JudgeRequirementState,
} from "@/lib/requirements/evaluate-requirements";
import type {
  RealJitoBundleEvidenceRecord,
  RealJitoEvidenceSnapshot,
} from "@/lib/jito/evidence-store";
import {
  clearLocalEvidenceStore,
  loadLocalEvidenceStore,
  saveAIDecisions,
  saveExportedEvidenceHistory,
  saveFailureCases,
  saveLifecycleLogs,
  type StoredAIDecision,
  type StoredEvidenceExport,
} from "@/lib/storage/local-evidence-store";
import { getDashboardSnapshot } from "@/services/dashboard-service";
import type { YellowstoneStreamStatusResponse } from "@/lib/grpc/slot-store";
import type {
  BundleStatus,
  BundleSubmissionResult,
  BundleTipDecision,
  JitoBundleStatusCheck,
  JitoLeaderWindow,
} from "@/types/jito";
import type { SignalSeverity, TransactionLifecycle } from "@/types/bounty";

type NetworkFeedState = "loading" | "yellowstone" | "rpc-fallback" | "fallback";
type SubmitMemoState = "idle" | "submitting";
type SubmitJitoBundleState = "idle" | "submitting";
type RealJitoDashboardStatus =
  | "submitted"
  | "pending"
  | "landed"
  | "failed"
  | "invalid"
  | "expired"
  | "unknown"
  | "network-error";
type TestnetWalletStatusState =
  | {
      state: "loading";
    }
  | {
      state: "ready";
      publicKey: string;
      balanceLamports: number;
      balanceSol: number;
      network: "testnet";
      funded: boolean;
    }
  | {
      state: "setup-error";
      error: string;
      network: "testnet";
      funded: false;
    };
type DevnetTestProgress = {
  running: boolean;
  completed: number;
  target: number;
};

const LOCAL_EVIDENCE_CLEAR_WARNING =
  "This removes local judge evidence from this browser only.";
const JITO_BUNDLE_RECEIPT_WARNING =
  "Bundle ID means submitted to Jito, not landed. Status check is required.";
const NETWORK_ERROR_RECOVERY_RECOMMENDATION =
  "Retry the bundle-status check after RPC/Jito connectivity recovers; keep the bundle submitted-not-landed until a separate status check returns landed.";
const JITO_TESTNET_UNFUNDED_MESSAGE =
  "Testnet wallet is unfunded. Real Jito submission blocked.";
const JITO_STATUS_POLL_INTERVAL_MS = 5_000;
const JITO_STATUS_POLL_MAX_ATTEMPTS = 12;
const REAL_JITO_TEST_TARGET = 10;
const FETCH_RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

const requirementStatusLabels: Record<JudgeRequirementState, string> = {
  done: "Done",
  partial: "Partial",
  missing: "Missing",
};

const simulatedBundleStatusLabels: Record<BundleStatus, string> = {
  constructed: "Constructed",
  prepared: "Prepared",
  simulated: "Simulated",
  submitted: "Submitted",
  "submitted-not-landed": "Submitted, not landed",
  pending: "Pending",
  landed: "Landed",
  failed: "Failed",
  invalid: "Invalid",
  expired: "Expired",
  unknown: "Unknown",
  "network-error": "Network error",
};

interface BundleStatusRequestBody {
  bundleId: string;
  markExpired?: boolean;
  markUnknown?: boolean;
  markNetworkError?: boolean;
  pollAttempt?: number;
  retryAttempts?: number;
  networkErrorMessage?: string;
}

const initialLifecycleTimestamps: Array<{
  submittedAt: string;
  processedAt?: string;
  confirmedAt?: string;
  finalizedAt?: string;
  failedAt?: string;
}> = [
  {
    submittedAt: "2026-06-02T21:09:18.000Z",
    processedAt: "2026-06-02T21:09:18.210Z",
    confirmedAt: "2026-06-02T21:09:18.640Z",
    finalizedAt: "2026-06-02T21:09:19.180Z",
  },
  {
    submittedAt: "2026-06-02T21:10:05.000Z",
    processedAt: "2026-06-02T21:10:05.210Z",
    confirmedAt: "2026-06-02T21:10:05.640Z",
  },
  {
    submittedAt: "2026-06-02T21:10:52.000Z",
    processedAt: "2026-06-02T21:10:52.210Z",
    failedAt: "2026-06-02T21:10:52.820Z",
  },
  {
    submittedAt: "2026-06-02T21:11:39.000Z",
    processedAt: "2026-06-02T21:11:39.210Z",
  },
  {
    submittedAt: "2026-06-02T21:12:26.000Z",
  },
];

const initialBundleSubmittedAt = "2026-06-02T21:12:05.000Z";

function formatLifecycleTimestamp(timestamp?: string) {
  if (!timestamp) {
    return "Pending";
  }

  const timeMatch = timestamp.match(/T(\d{2}):(\d{2}):(\d{2})/);

  if (!timeMatch) {
    return "Pending";
  }

  const hour = Number(timeMatch[1]);
  const displayHour = hour % 12 || 12;
  const period = hour >= 12 ? "PM" : "AM";

  return `${String(displayHour).padStart(2, "0")}:${timeMatch[2]}:${timeMatch[3]} ${period}`;
}

function formatOptionalSlot(slot?: number | null) {
  return typeof slot === "number" ? formatSlot(slot) : "Pending";
}

function formatOptionalDelta(deltaMs?: number | null) {
  return typeof deltaMs === "number" ? formatDuration(deltaMs) : "Pending";
}

function getRetryDecision(
  failure: SimulatedFailure,
  currentTip: number,
  leaderDistance: number,
  rpcLatency: number,
): RetryDecision {
  return decideRetryAction({
    failureType: failure.failureType,
    blockhashAge: failure.failureType === "expired-blockhash" ? 151 : 42,
    currentTip,
    leaderDistance,
    rpcLatency,
  });
}

function createInitialLifecycleEntries(
  lifecycle: TransactionLifecycle[],
): SimulatedLifecycleEntry[] {
  return lifecycle.map((entry, index) => {
    const timestamps =
      initialLifecycleTimestamps[index] ??
      initialLifecycleTimestamps[initialLifecycleTimestamps.length - 1];
    const lifecycleEntry = createLifecycleEntry({
      id: `mock-life-${index}`,
      signature: entry.signature,
      slot: entry.slot,
      tipLamports: entry.tipLamports,
      route: "devnet-mock",
      submittedAt: timestamps.submittedAt,
    });

    if (entry.stage === "failed") {
      return {
        ...lifecycleEntry,
        stage: "failed",
        processedAt: timestamps.processedAt,
        failedAt: "failedAt" in timestamps ? timestamps.failedAt : undefined,
        failure: injectExpiredBlockhashFailure(`mock-failure-${index}`),
      };
    }

    if (entry.stage === "submitted") {
      return lifecycleEntry;
    }

    if (entry.stage === "processed") {
      return {
        ...lifecycleEntry,
        stage: "processed",
        processedAt: timestamps.processedAt,
      };
    }

    if (entry.stage === "confirmed") {
      return {
        ...lifecycleEntry,
        stage: "confirmed",
        processedAt: timestamps.processedAt,
        confirmedAt: "confirmedAt" in timestamps ? timestamps.confirmedAt : undefined,
      };
    }

    return {
      ...lifecycleEntry,
      stage: "finalized",
      processedAt: timestamps.processedAt,
      confirmedAt: "confirmedAt" in timestamps ? timestamps.confirmedAt : undefined,
      finalizedAt: "finalizedAt" in timestamps ? timestamps.finalizedAt : undefined,
    };
  });
}

function createRealDevnetLifecycleEntry(
  lifecycle: DevnetMemoLifecycleResult,
): SimulatedLifecycleEntry {
  return {
    id: `real-${lifecycle.signature}`,
    signature: lifecycle.signature,
    slot: lifecycle.slot,
    route: "devnet-real",
    source: "real-devnet-memo",
    tipLamports: 0,
    stage: lifecycle.status,
    submittedAt: lifecycle.submittedAt,
    processedAt: lifecycle.processedAt,
    confirmedAt: lifecycle.confirmedAt,
    finalizedAt: lifecycle.finalizedAt,
  };
}

function getInitialLeaderWindow(
  currentSlot: number,
  leaderDistance: number,
): JitoLeaderWindow {
  return estimateLeaderWindow({
    currentSlot,
    targetLeaderSlot: currentSlot + Math.max(leaderDistance, 1),
  });
}

function createTipDecision(
  networkHealth: "healthy" | "degraded" | "congested",
  leaderDistance: number,
  recentFailures: string[],
  baseTip: number,
  slotLatencyMs?: number | null,
  bundleHistory?: BundleStatus[],
): BundleTipDecision {
  return calculateDynamicTip({
    networkHealth,
    leaderDistance,
    recentFailures,
    slotLatencyMs,
    bundleHistory,
    baseTip,
  });
}

function createInitialBundleSubmission(
  currentSlot: number,
  leaderDistance: number,
  networkHealth: "healthy" | "degraded" | "congested",
  baseTip: number,
): BundleSubmissionResult {
  const leaderSlot = currentSlot + Math.max(leaderDistance, 1);
  const leaderWindow = estimateLeaderWindow({
    currentSlot,
    targetLeaderSlot: leaderSlot,
  });
  const tipDecision = createTipDecision(
    networkHealth,
    leaderWindow.leaderDistance,
    ["insufficient-tip"],
    baseTip,
  );
  const canSimulateSubmission =
    leaderWindow.leaderDistance >= 0 && leaderWindow.leaderDistance <= 4;
  const reason = `${leaderWindow.reason} ${tipDecision.reason}`;

  return {
    bundleId: `biq-sim-${leaderSlot}-bootstrap`,
    status: canSimulateSubmission ? "simulated" : "prepared",
    tipLamports: tipDecision.tipLamports,
    submittedAt: initialBundleSubmittedAt,
    leaderSlot,
    leaderDistance: leaderWindow.leaderDistance,
    reason: canSimulateSubmission
      ? `Mock Jito adapter accepted bundle payload. ${reason}`
      : `Mock Jito adapter prepared payload only. ${reason}`,
    mode: "mock-only",
  };
}

function severityForRequirement(status: JudgeRequirementState): SignalSeverity {
  if (status === "done") {
    return "success";
  }

  if (status === "partial") {
    return "warning";
  }

  return "danger";
}

function severityForSimulatedBundle(status: BundleStatus): SignalSeverity {
  if (status === "landed") {
    return "success";
  }

  if (
    status === "failed" ||
    status === "invalid" ||
    status === "expired" ||
    status === "network-error"
  ) {
    return "danger";
  }

  if (
    status === "constructed" ||
    status === "submitted" ||
    status === "submitted-not-landed" ||
    status === "prepared"
  ) {
    return "warning";
  }

  return "info";
}

function isRealDevnetMemoEntry(entry: SimulatedLifecycleEntry) {
  return entry.source === "real-devnet-memo" || entry.source === "real-devnet";
}

function lifecycleSourceLabel(entry: SimulatedLifecycleEntry) {
  return isRealDevnetMemoEntry(entry)
    ? "real-devnet-memo"
    : "mock-simulation";
}

function createStoredAIDecision({
  createdAt = new Date().toISOString(),
  ...decision
}: Omit<StoredAIDecision, "createdAt"> & { createdAt?: string }) {
  return {
    ...decision,
    createdAt,
  };
}

function getStoredRequirementProgress(requirements: JudgeRequirementCheck[]) {
  return requirements.map((requirement) => ({
    id: requirement.id,
    label: requirement.label,
    status: requirement.status,
    countLabel: requirement.countLabel,
  }));
}

function getNetworkSlotLatencyMs(
  status: YellowstoneStreamStatusResponse,
  fallbackLatencyMs: number,
) {
  return (
    status.processedToConfirmedDeltaMs ??
    status.confirmedToFinalizedDeltaMs ??
    fallbackLatencyMs
  );
}

function getBundleStatusHistory(bundleSubmissions: BundleSubmissionResult[]) {
  return bundleSubmissions.map((bundle) => bundle.status);
}

function formatEvidenceTimestamp(timestamp?: string | null) {
  return timestamp ?? "Pending";
}

function formatEvidenceSlot(slot?: number | null) {
  return typeof slot === "number" ? formatSlot(slot) : "Pending";
}

function isRealJitoTestnetBundle(bundle: BundleSubmissionResult) {
  return (
    bundle.source === "real-jito-testnet" ||
    bundle.bundleSource === "real-jito-testnet" ||
    bundle.mode === "real-jito-testnet"
  );
}

function getRealJitoDashboardStatus(
  record: RealJitoBundleEvidenceRecord,
): RealJitoDashboardStatus {
  if (record.latestStatus === "landed") {
    return "landed";
  }

  if (record.latestStatus === "failed") {
    return "failed";
  }

  if (record.latestStatus === "invalid") {
    return "invalid";
  }

  if (record.latestStatus === "expired") {
    return "expired";
  }

  if (record.latestStatus === "unknown") {
    return "unknown";
  }

  if (record.latestStatus === "network-error") {
    return "network-error";
  }

  return record.statusChecked ? "pending" : "submitted";
}

function getRealJitoDashboardStatusLabel(status: RealJitoDashboardStatus) {
  const labels: Record<RealJitoDashboardStatus, string> = {
    submitted: "Submitted",
    pending: "Pending",
    landed: "Landed",
    failed: "Failed",
    invalid: "Invalid",
    expired: "Expired",
    unknown: "Unknown",
    "network-error": "Network error",
  };

  return labels[status];
}

function getRealJitoDashboardStatusSeverity(status: RealJitoDashboardStatus) {
  if (status === "landed") {
    return "success";
  }

  if (
    status === "failed" ||
    status === "invalid" ||
    status === "expired" ||
    status === "network-error"
  ) {
    return "danger";
  }

  if (status === "pending" || status === "unknown") {
    return "warning";
  }

  return "submitted";
}

function isTerminalRealJitoStatus(status: BundleStatus) {
  return (
    status === "landed" ||
    status === "failed" ||
    status === "invalid" ||
    status === "expired" ||
    status === "unknown" ||
    status === "network-error"
  );
}

function waitForJitoStatusPollInterval() {
  return new Promise((resolve) =>
    window.setTimeout(resolve, JITO_STATUS_POLL_INTERVAL_MS),
  );
}

function waitForFetchRetry(delayMs: number) {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

function isRetryableResponse(response: Response) {
  return response.status === 429 || response.status >= 500;
}

function formatFetchError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  context: string,
) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= FETCH_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(input, init);

      if (
        attempt < FETCH_RETRY_DELAYS_MS.length &&
        isRetryableResponse(response)
      ) {
        await waitForFetchRetry(FETCH_RETRY_DELAYS_MS[attempt]);
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;

      if (attempt >= FETCH_RETRY_DELAYS_MS.length) {
        break;
      }

      await waitForFetchRetry(FETCH_RETRY_DELAYS_MS[attempt]);
    }
  }

  throw new Error(
    `${context} fetch failed after ${FETCH_RETRY_DELAYS_MS.length} retries: ${formatFetchError(
      lastError,
    )}`,
  );
}

export function DashboardView() {
  const snapshot = getDashboardSnapshot();
  const { jitoBundle, lifecycle, network } = snapshot;
  const [lifecycleEntries, setLifecycleEntries] = useState<
    SimulatedLifecycleEntry[]
  >(() => createInitialLifecycleEntries(lifecycle));
  const [simulatedFailures, setSimulatedFailures] = useState<SimulatedFailure[]>(
    () => getSimulatedFailures(),
  );
  const [activeFailure, setActiveFailure] = useState<SimulatedFailure | null>(
    () => injectExpiredBlockhashFailure("fault-expired-blockhash"),
  );
  const [retryDecision, setRetryDecision] = useState<RetryDecision | null>(() =>
    getRetryDecision(
      injectExpiredBlockhashFailure("fault-expired-blockhash"),
      jitoBundle.dynamicTipLamports,
      network.leaderDistance,
      network.rpcLatencyMs,
    ),
  );
  const [leaderWindow, setLeaderWindow] = useState<JitoLeaderWindow>(() =>
    getInitialLeaderWindow(network.currentSlot, network.leaderDistance),
  );
  const [tipDecision, setTipDecision] = useState<BundleTipDecision>(() =>
    createTipDecision(
      network.status,
      network.leaderDistance,
      ["insufficient-tip"],
      jitoBundle.dynamicTipLamports,
    ),
  );
  const [bundleSubmissions, setBundleSubmissions] = useState<
    BundleSubmissionResult[]
  >(() => [
    createInitialBundleSubmission(
      network.currentSlot,
      network.leaderDistance,
      network.status,
      jitoBundle.dynamicTipLamports,
    ),
  ]);
  const [realJitoEvidence, setRealJitoEvidence] = useState<
    RealJitoBundleEvidenceRecord[]
  >([]);
  const [realJitoEvidenceError, setRealJitoEvidenceError] = useState<
    string | null
  >(null);
  const [networkFeedState, setNetworkFeedState] =
    useState<NetworkFeedState>("loading");
  const [solanaStatus, setSolanaStatus] =
    useState<YellowstoneStreamStatusResponse | null>(null);
  const [submitMemoState, setSubmitMemoState] =
    useState<SubmitMemoState>("idle");
  const [submitMemoError, setSubmitMemoError] = useState<string | null>(null);
  const [submitJitoBundleState, setSubmitJitoBundleState] =
    useState<SubmitJitoBundleState>("idle");
  const [submitJitoBundleError, setSubmitJitoBundleError] = useState<
    string | null
  >(null);
  const [checkingBundleId, setCheckingBundleId] = useState<string | null>(null);
  const [pollingBundleId, setPollingBundleId] = useState<string | null>(null);
  const [pollingAttempt, setPollingAttempt] = useState(0);
  const [testnetWalletStatus, setTestnetWalletStatus] =
    useState<TestnetWalletStatusState>({ state: "loading" });
  const [devnetTestProgress, setDevnetTestProgress] =
    useState<DevnetTestProgress>({
      running: false,
      completed: 0,
      target: 0,
    });
  const [realJitoTestProgress, setRealJitoTestProgress] =
    useState<DevnetTestProgress>({
      running: false,
      completed: 0,
      target: 0,
    });
  const [storedAIDecisions, setStoredAIDecisions] = useState<StoredAIDecision[]>(
    [],
  );
  const [exportedEvidenceHistory, setExportedEvidenceHistory] = useState<
    StoredEvidenceExport[]
  >([]);
  const fallbackSolanaStatus: YellowstoneStreamStatusResponse = {
    source: "rpc-fallback",
    currentSlot: network.currentSlot,
    processedSlot: network.currentSlot,
    confirmedSlot: network.currentSlot - 1,
    finalizedSlot: network.currentSlot - 32,
    skippedSlots: 0,
    processedToConfirmedDeltaMs: null,
    confirmedToFinalizedDeltaMs: null,
    streamConnected: false,
    streamStatus: "unavailable",
    commitment: "processed",
    lastStreamUpdate: null,
    lastPongAt: null,
    lastDisconnectedAt: null,
    reconnectAttempts: 0,
    streamError: "Network status request failed; using mock fallback.",
    backpressureQueueDepth: 0,
    backpressureDroppedUpdates: 0,
    lastBackpressureDropAt: null,
  };
  const isNetworkLoading = networkFeedState === "loading";
  const isYellowstoneNetwork = networkFeedState === "yellowstone";
  const isRpcFallbackNetwork = networkFeedState === "rpc-fallback";
  const activeSolanaStatus = solanaStatus ?? fallbackSolanaStatus;
  const networkFeedLabel = isNetworkLoading
    ? "Loading Yellowstone"
    : isYellowstoneNetwork
      ? "Yellowstone Devnet"
      : isRpcFallbackNetwork
        ? "RPC Fallback"
      : "Mock Fallback";
  const networkFeedSeverity: SignalSeverity = isNetworkLoading
    ? "warning"
    : isYellowstoneNetwork
      ? "success"
      : "info";
  const currentSlotValue = isNetworkLoading
    ? "Loading devnet..."
    : formatSlot(activeSolanaStatus.currentSlot);
  const currentSlotMetricValue = isNetworkLoading
    ? "Loading"
    : formatSlot(activeSolanaStatus.currentSlot);
  const processedSlotValue = isNetworkLoading
    ? "Loading Yellowstone..."
    : formatOptionalSlot(activeSolanaStatus.processedSlot);
  const confirmedSlotValue = isNetworkLoading
    ? "Loading Yellowstone..."
    : formatOptionalSlot(activeSolanaStatus.confirmedSlot);
  const finalizedSlotValue = isNetworkLoading
    ? "Loading Yellowstone..."
    : formatOptionalSlot(activeSolanaStatus.finalizedSlot);
  const processedToConfirmedDeltaValue = isNetworkLoading
    ? "Loading Yellowstone..."
    : formatOptionalDelta(activeSolanaStatus.processedToConfirmedDeltaMs);
  const streamStatusValue = isNetworkLoading
    ? "Loading Yellowstone..."
    : isYellowstoneNetwork
      ? "Connected"
      : isRpcFallbackNetwork
        ? "RPC fallback"
        : "Mock fallback";
  const dataSourceValue = isNetworkLoading
    ? "Loading Yellowstone..."
    : isYellowstoneNetwork
      ? "Yellowstone gRPC Devnet"
      : isRpcFallbackNetwork
        ? "Solana Devnet RPC"
      : "Mock Fallback";
  const activeBundleSubmission = bundleSubmissions[0];
  const leaderTimingDecision = leaderWindow.shouldSubmitNow
    ? "Submit now"
    : leaderWindow.isNearLeader
      ? "Prepare payload"
      : "Wait";
  const retrySignals =
    activeFailure && retryDecision
      ? [
          `failure-type:${activeFailure.failureType}`,
          `refresh-blockhash:${retryDecision.refreshBlockhash}`,
          `retry:${retryDecision.shouldRetry}`,
          `new-tip:${retryDecision.newTip}`,
          `jito-tip:${tipDecision.tipLamports}`,
          `leader-distance:${leaderWindow.leaderDistance}`,
        ]
      : [
          `jito-tip:${tipDecision.tipLamports}`,
          `leader-distance:${leaderWindow.leaderDistance}`,
          "retry:false",
          "jito-mode:mock-only",
        ];
  const aiDecisionLabel = leaderWindow.shouldSubmitNow
    ? "Simulate Jito bundle with dynamic tip"
    : "Prepare mock Jito payload and wait for leader timing";
  const aiDecisionReason = `${tipDecision.reason} ${leaderWindow.reason} Retry agent: ${
    retryDecision?.reason ?? "No retry required for latest simulated lifecycle."
  }`;
  const liveSlotLatencyMs = getNetworkSlotLatencyMs(
    activeSolanaStatus,
    network.rpcLatencyMs,
  );
  const testnetWalletStatusLine =
    testnetWalletStatus.state === "loading"
      ? "Testnet wallet: loading status..."
      : testnetWalletStatus.state === "setup-error"
        ? `Testnet wallet setup: ${testnetWalletStatus.error}`
        : `Testnet wallet ${testnetWalletStatus.publicKey} | balance ${formatSolFromLamports(
            testnetWalletStatus.balanceLamports,
            9,
          )} (${formatLamports(testnetWalletStatus.balanceLamports)}) | funded ${
            testnetWalletStatus.funded ? "yes" : "no"
          }`;
  const isTestnetWalletFunded =
    testnetWalletStatus.state === "ready" && testnetWalletStatus.funded;
  const displayedRealJitoEvidence = isTestnetWalletFunded
    ? realJitoEvidence
    : [];
  const realJitoStatusSummary = displayedRealJitoEvidence.reduce(
    (summary, record) => {
      if (record.latestStatus === "landed") {
        summary.landed += 1;
      } else if (record.latestStatus === "failed") {
        summary.failed += 1;
      } else if (record.latestStatus === "expired") {
        summary.expired += 1;
      } else if (record.latestStatus === "network-error") {
        summary.networkError += 1;
      } else {
        summary.pending += 1;
      }

      return summary;
    },
    {
      landed: 0,
      failed: 0,
      expired: 0,
      pending: 0,
      networkError: 0,
    },
  );
  const requirementChecks = evaluateJudgeRequirements({
    lifecycleLogs: lifecycleEntries,
    failureCases: simulatedFailures,
    aiDecisions: [
      {
        decision: aiDecisionLabel,
        retryDecision,
      },
      ...storedAIDecisions.map((decision) => ({
        decision: decision.decision,
        retryDecision: decision.retryDecision,
      })),
    ],
    streamStatus: activeSolanaStatus,
    bundleStatus: bundleSubmissions,
    realJitoEvidence,
    jitoTestnetWalletFunded: isTestnetWalletFunded,
    evidenceExportStatus: {
      available: true,
      exportedEvidenceCount: exportedEvidenceHistory.length,
    },
  });
  const isDevnetEvidenceBusy =
    submitMemoState === "submitting" || devnetTestProgress.running;
  const isJitoBundleSubmitBusy = submitJitoBundleState === "submitting";
  const isAutoSignedJitoSubmitDisabled =
    isJitoBundleSubmitBusy ||
    Boolean(checkingBundleId) ||
    Boolean(pollingBundleId) ||
    !isTestnetWalletFunded;
  const isRunTenRealJitoTestsDisabled = isAutoSignedJitoSubmitDisabled;
  const activeBundleSourceLabel =
    activeBundleSubmission.source === "real-jito-testnet"
      ? "Real Jito testnet submit"
      : "Mock-only Jito simulation";
  const devnetTestProgressLabel =
    devnetTestProgress.target > 0
      ? `${devnetTestProgress.completed}/${devnetTestProgress.target}`
      : "0/10";
  const realJitoTestProgressLabel =
    realJitoTestProgress.target > 0
      ? `${realJitoTestProgress.completed}/${realJitoTestProgress.target}`
      : `0/${REAL_JITO_TEST_TARGET}`;

  function applyFailureDecision(failure: SimulatedFailure | null) {
    const nextRetryDecision = failure
      ? getRetryDecision(
          failure,
          jitoBundle.dynamicTipLamports,
          leaderWindow.leaderDistance,
          liveSlotLatencyMs,
        )
      : null;

    setActiveFailure(failure);
    setRetryDecision(nextRetryDecision);

    return nextRetryDecision;
  }

  function persistAIDecision(decision: StoredAIDecision) {
    const nextDecisions = [decision, ...storedAIDecisions.slice(0, 49)];

    setStoredAIDecisions(nextDecisions);
    saveAIDecisions(nextDecisions);
  }

  function createFailureAIDecision(
    failure: SimulatedFailure,
    nextRetryDecision: RetryDecision,
  ) {
    return createStoredAIDecision({
      id: `ai-${failure.id}`,
      decision: `Retry simulated ${failure.failureType}`,
      reason: nextRetryDecision.nextAction,
      source: "simulation",
      retryDecision: nextRetryDecision,
      signals: [
        `failure-type:${failure.failureType}`,
        `refresh-blockhash:${nextRetryDecision.refreshBlockhash}`,
        `retry:${nextRetryDecision.shouldRetry}`,
        `new-tip:${nextRetryDecision.newTip}`,
        "jito-mode:mock-only",
      ],
    });
  }

  function createExportHistoryEntry({
    filename,
    format,
    exportedAt,
  }: Pick<StoredEvidenceExport, "filename" | "format" | "exportedAt">) {
    return {
      id: `export-${exportedAt}`,
      filename,
      format,
      exportedAt,
      networkSource:
        activeSolanaStatus.source === "yellowstone" &&
        activeSolanaStatus.streamConnected
          ? "Yellowstone devnet"
          : activeSolanaStatus.streamError?.toLowerCase().includes("mock fallback")
            ? "mock fallback"
            : "devnet RPC fallback",
      lifecycleCount: lifecycleEntries.length,
      failureCount: simulatedFailures.length,
      aiDecisionCount: storedAIDecisions.length,
      requirementProgress: getStoredRequirementProgress(requirementChecks),
      notes: [
        "Mock lifecycle rows are labeled mock-simulation.",
        "Real devnet memo rows are labeled real-devnet-memo.",
        "Devnet memo tests prove lifecycle tracking. They are not Jito bundle submissions.",
        "Jito bundle evidence is simulated only.",
        "Yellowstone is connected only when stream status reports yellowstone and connected.",
      ],
    };
  }

  function persistExportHistory(entry: StoredEvidenceExport) {
    const nextHistory = [entry, ...exportedEvidenceHistory.slice(0, 19)];

    setExportedEvidenceHistory(nextHistory);
    saveExportedEvidenceHistory(nextHistory);
  }

  function handleSimulateBundleLifecycle() {
    const id = `life-${Date.now()}`;
    const shouldFail = Math.random() < 0.38;
    const failure = shouldFail ? injectRandomFailure(`fault-${id}`) : undefined;
    const entry = createLifecycleEntry({
      id,
      slot: activeSolanaStatus.currentSlot,
      tipLamports: jitoBundle.dynamicTipLamports,
      route: "devnet-mock",
    });
    const finalStage = failure
      ? "failed"
      : Math.random() < 0.22
        ? "confirmed"
        : "finalized";
    const nextEntry = progressLifecycleEntry(entry, finalStage, failure);
    const nextEntries = [nextEntry, ...lifecycleEntries.slice(0, 49)];

    setLifecycleEntries(nextEntries);
    saveLifecycleLogs(nextEntries);

    if (failure) {
      const nextFailures = [failure, ...simulatedFailures.slice(0, 49)];
      const nextRetryDecision = applyFailureDecision(failure);

      setSimulatedFailures(nextFailures);
      saveFailureCases(nextFailures);

      if (nextRetryDecision) {
        persistAIDecision(createFailureAIDecision(failure, nextRetryDecision));
      }
    } else {
      applyFailureDecision(null);
    }
  }

  function handleInjectBlockhashExpiry() {
    const id = `life-expired-${Date.now()}`;
    const failure = injectExpiredBlockhashFailure(`fault-${id}`);
    const entry = createLifecycleEntry({
      id,
      slot: activeSolanaStatus.currentSlot,
      tipLamports: jitoBundle.dynamicTipLamports,
      route: "devnet-mock",
    });
    const failedEntry = progressLifecycleEntry(entry, "failed", failure);
    const nextEntries = [failedEntry, ...lifecycleEntries.slice(0, 49)];
    const nextFailures = [failure, ...simulatedFailures.slice(0, 49)];
    const nextRetryDecision = applyFailureDecision(failure);

    setLifecycleEntries(nextEntries);
    setSimulatedFailures(nextFailures);
    saveLifecycleLogs(nextEntries);
    saveFailureCases(nextFailures);

    if (nextRetryDecision) {
      persistAIDecision(createFailureAIDecision(failure, nextRetryDecision));
    }
  }

  function handleSimulateJitoBundle() {
    const leaderSlot =
      activeSolanaStatus.currentSlot + Math.max(network.leaderDistance, 1);
    const nextLeaderWindow = estimateLeaderWindow({
      currentSlot: activeSolanaStatus.currentSlot,
      targetLeaderSlot: leaderSlot,
    });
    const nextTipDecision = calculateDynamicTip({
      networkHealth: network.status,
      leaderDistance: nextLeaderWindow.leaderDistance,
      recentFailures: simulatedFailures.map((failure) => failure.failureType),
      slotLatencyMs: liveSlotLatencyMs,
      bundleHistory: getBundleStatusHistory(bundleSubmissions),
      baseTip: jitoBundle.dynamicTipLamports,
    });
    const payload = prepareBundlePayload({
      transactions: lifecycleEntries
        .slice(0, 3)
        .map((entry) => `mock-tx:${entry.signature}`),
      tipLamports: nextTipDecision.tipLamports,
      leaderSlot,
      leaderDistance: nextLeaderWindow.leaderDistance,
      reason: `${nextLeaderWindow.reason} ${nextTipDecision.reason}`,
    });
    const result = simulateBundleSubmission(payload);

    setLeaderWindow(nextLeaderWindow);
    setTipDecision(nextTipDecision);
    setBundleSubmissions((currentSubmissions) => [
      result,
      ...currentSubmissions.slice(0, 4),
    ]);
    persistAIDecision(
      createStoredAIDecision({
        id: `ai-${result.bundleId}`,
        decision: "Simulate Jito bundle with dynamic tip",
        reason: result.reason,
        source: "simulation",
        retryDecision,
        signals: [
          `jito-tip:${nextTipDecision.tipLamports}`,
          `leader-distance:${nextLeaderWindow.leaderDistance}`,
          "jito-mode:mock-only",
        ],
      }),
    );
  }

  async function submitAutoSignedJitoBundleRequest() {
    const response = await fetchWithRetry(
      "/api/jito/bundle",
      {
        method: "POST",
      },
      "Jito bundle submit",
    );
    const payload = (await response.json()) as {
      bundle?: BundleSubmissionResult;
      evidence?: RealJitoBundleEvidenceRecord;
      error?: string;
    };

    if (!response.ok || !payload.bundle || !payload.evidence) {
      throw new Error(
        payload.error ?? "Unable to submit auto-signed Jito testnet bundle.",
      );
    }

    return {
      bundle: payload.bundle,
      evidence: payload.evidence,
    };
  }

  function applyRealJitoSubmissionEvidence(
    bundle: BundleSubmissionResult,
    evidence: RealJitoBundleEvidenceRecord,
  ) {
    setBundleSubmissions((currentSubmissions) => [
      bundle,
      ...currentSubmissions.slice(0, 4),
    ]);
    setRealJitoEvidence((currentRecords) => [
      evidence,
      ...currentRecords.filter((record) => record.bundleId !== evidence.bundleId),
    ]);
    setRealJitoEvidenceError(null);
  }

  function blockUnfundedRealJitoEvidence() {
    setSubmitJitoBundleError(JITO_TESTNET_UNFUNDED_MESSAGE);
  }

  async function handleSubmitAutoSignedJitoBundle() {
    if (isJitoBundleSubmitBusy) {
      return;
    }

    if (!isTestnetWalletFunded) {
      blockUnfundedRealJitoEvidence();
      return;
    }

    setSubmitJitoBundleState("submitting");
    setSubmitJitoBundleError(null);

    try {
      const { bundle, evidence } = await submitAutoSignedJitoBundleRequest();

      applyRealJitoSubmissionEvidence(bundle, evidence);
      void pollRealJitoBundleStatus(bundle.bundleId);
    } catch (error) {
      setSubmitJitoBundleError(
        error instanceof Error
          ? error.message
          : "Unable to submit auto-signed Jito testnet bundle.",
      );
    } finally {
      setSubmitJitoBundleState("idle");
    }
  }

  async function requestRealJitoBundleStatus(
    bundleId: string,
    {
      markExpired = false,
      markUnknown = false,
      markNetworkError = false,
      pollAttempt = null,
      retryAttempts = null,
      networkErrorMessage = null,
    }: {
      markExpired?: boolean;
      markUnknown?: boolean;
      markNetworkError?: boolean;
      pollAttempt?: number | null;
      retryAttempts?: number | null;
      networkErrorMessage?: string | null;
    } = {},
  ) {
    const requestBody: BundleStatusRequestBody = {
      bundleId,
    };

    if (markExpired) {
      requestBody.markExpired = true;
    }

    if (markUnknown) {
      requestBody.markUnknown = true;
    }

    if (markNetworkError) {
      requestBody.markNetworkError = true;
    }

    if (pollAttempt !== null) {
      requestBody.pollAttempt = pollAttempt;
    }

    if (retryAttempts !== null) {
      requestBody.retryAttempts = retryAttempts;
    }

    if (typeof networkErrorMessage === "string") {
      requestBody.networkErrorMessage = networkErrorMessage;
    }

    const response = await fetchWithRetry(
      "/api/jito/bundle-status",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      },
      "Jito bundle status",
    );
    const payload = (await response.json()) as {
      statuses?: JitoBundleStatusCheck[];
      snapshot?: RealJitoEvidenceSnapshot;
      error?: string;
    };

    if (!response.ok || !payload.statuses) {
      throw new Error(payload.error ?? "Unable to check Jito bundle status.");
    }

    const checkedStatus = payload.statuses.find(
      (status) => status.bundleId === bundleId,
    );

    if (!checkedStatus) {
      const pendingStatus: JitoBundleStatusCheck = {
        bundleId,
        status: "pending",
        checkedAt: new Date().toISOString(),
        statusSource: "bundle-status",
        inflightStatus: null,
        confirmationStatus: null,
        confirmationLevel: null,
        landedSlot: null,
        error: "Jito status check did not return this bundle id.",
        rawStatusPayload: payload,
      };

      if (pollAttempt !== null) {
        console.info("[BundleIQ] Jito status poll", {
          bundleId,
          pollAttempt,
          rawStatusPayload: pendingStatus.rawStatusPayload,
        });
      }

      return pendingStatus;
    }

    if (payload.snapshot) {
      setRealJitoEvidence(payload.snapshot.records);
    }

    setBundleSubmissions((currentSubmissions) =>
      currentSubmissions.map((submission) =>
        submission.bundleId === bundleId
          ? {
              ...submission,
              status: checkedStatus.status,
              statusSource: checkedStatus.statusSource,
              statusCheckedAt: checkedStatus.checkedAt,
              landedSlot: checkedStatus.landedSlot,
              confirmationStatus:
                checkedStatus.confirmationLevel ??
                checkedStatus.confirmationStatus,
            }
          : submission,
      ),
    );
    setSubmitJitoBundleError(null);

    if (pollAttempt !== null) {
      console.info("[BundleIQ] Jito status poll", {
        bundleId,
        pollAttempt,
        rawStatusPayload: checkedStatus.rawStatusPayload,
      });
    }

    return checkedStatus;
  }

  async function recordRealJitoNetworkError(
    bundleId: string,
    error: unknown,
    pollAttempt: number | null = null,
  ) {
    try {
      return await requestRealJitoBundleStatus(bundleId, {
        markNetworkError: true,
        pollAttempt,
        retryAttempts: FETCH_RETRY_DELAYS_MS.length,
        networkErrorMessage: formatFetchError(error),
      });
    } catch (recordError) {
      const checkedAt = new Date().toISOString();
      const fallbackStatus: JitoBundleStatusCheck = {
        bundleId,
        status: "network-error",
        checkedAt,
        statusSource: "bundle-status",
        inflightStatus: null,
        confirmationStatus: null,
        confirmationLevel: null,
        landedSlot: null,
        error: formatFetchError(recordError),
        rawStatusPayload: {
          source: "bundleiq-client-network-error",
          reason: formatFetchError(error),
          persistenceError: formatFetchError(recordError),
          retryAttempts: FETCH_RETRY_DELAYS_MS.length,
          pollAttempt,
          recoveryRecommendation: NETWORK_ERROR_RECOVERY_RECOMMENDATION,
          checkedAt,
        },
      };

      console.info("[BundleIQ] Jito status poll", {
        bundleId,
        pollAttempt,
        rawStatusPayload: fallbackStatus.rawStatusPayload,
      });

      return fallbackStatus;
    }
  }

  async function pollRealJitoBundleToTerminal(bundleId: string) {
    for (let attempt = 1; attempt <= JITO_STATUS_POLL_MAX_ATTEMPTS; attempt += 1) {
      setPollingAttempt(attempt);
      await waitForJitoStatusPollInterval();

      let checkedStatus: JitoBundleStatusCheck;

      try {
        checkedStatus = await requestRealJitoBundleStatus(bundleId, {
          pollAttempt: attempt,
        });
      } catch (error) {
        return recordRealJitoNetworkError(bundleId, error, attempt);
      }

      if (isTerminalRealJitoStatus(checkedStatus.status)) {
        return checkedStatus;
      }
    }

    return requestRealJitoBundleStatus(bundleId, {
      markUnknown: true,
      pollAttempt: JITO_STATUS_POLL_MAX_ATTEMPTS,
    });
  }

  async function pollRealJitoBundleStatus(bundleId: string) {
    setPollingBundleId(bundleId);
    setPollingAttempt(0);

    try {
      await pollRealJitoBundleToTerminal(bundleId);
    } catch (error) {
      setRealJitoEvidenceError(
        error instanceof Error
          ? error.message
          : "Unable to poll Jito bundle status.",
      );
    } finally {
      setPollingBundleId(null);
      setPollingAttempt(0);
    }
  }

  async function handleCheckRealJitoBundleStatus(bundleId: string) {
    if (checkingBundleId || pollingBundleId) {
      return;
    }

    setCheckingBundleId(bundleId);
    setRealJitoEvidenceError(null);

    try {
      await requestRealJitoBundleStatus(bundleId);
    } catch (error) {
      setRealJitoEvidenceError(
        error instanceof Error
          ? error.message
          : "Unable to check Jito bundle status.",
      );
    } finally {
      setCheckingBundleId(null);
    }
  }

  async function handleRunTenRealJitoTests() {
    if (isRunTenRealJitoTestsDisabled) {
      return;
    }

    if (!isTestnetWalletFunded) {
      blockUnfundedRealJitoEvidence();
      return;
    }

    setSubmitJitoBundleState("submitting");
    setSubmitJitoBundleError(null);
    setRealJitoEvidenceError(null);
    setRealJitoTestProgress({
      running: true,
      completed: 0,
      target: REAL_JITO_TEST_TARGET,
    });

    for (let index = 0; index < REAL_JITO_TEST_TARGET; index += 1) {
      try {
        const { bundle, evidence } = await submitAutoSignedJitoBundleRequest();

        applyRealJitoSubmissionEvidence(bundle, evidence);
        setPollingBundleId(bundle.bundleId);
        setPollingAttempt(0);
        await pollRealJitoBundleToTerminal(bundle.bundleId);
      } catch (error) {
        const networkErrorBundleId = `biq-network-error-${Date.now()}-${index + 1}`;

        await recordRealJitoNetworkError(networkErrorBundleId, error, null);
        setSubmitJitoBundleError(
          error instanceof Error
            ? error.message
            : "One real Jito test hit a temporary network error and was recorded.",
        );
      }

      setRealJitoTestProgress({
        running: true,
        completed: index + 1,
        target: REAL_JITO_TEST_TARGET,
      });
    }

    setSubmitJitoBundleState("idle");
    setPollingBundleId(null);
    setPollingAttempt(0);
    setRealJitoTestProgress((currentProgress) => ({
      ...currentProgress,
      running: false,
    }));
  }

  async function submitDevnetMemoLifecycle() {
    const response = await fetchWithRetry(
      "/api/solana/submit-memo",
      {
        method: "POST",
      },
      "Solana devnet memo submit",
    );
    const payload = (await response.json()) as {
      lifecycle?: DevnetMemoLifecycleResult;
      error?: string;
    };

    if (!response.ok || !payload.lifecycle) {
      throw new Error(payload.error ?? "Unable to submit devnet memo.");
    }

    return createRealDevnetLifecycleEntry(payload.lifecycle);
  }

  function appendLifecycleEvidence(
    lifecycleEntry: SimulatedLifecycleEntry,
    currentEntries: SimulatedLifecycleEntry[],
  ) {
    const nextEntries = [lifecycleEntry, ...currentEntries.slice(0, 49)];

    setLifecycleEntries(nextEntries);
    saveLifecycleLogs(nextEntries);
    applyFailureDecision(null);

    return nextEntries;
  }

  async function runSingleDevnetEvidenceTest(
    currentEntries = lifecycleEntries,
  ) {
    const lifecycleEntry = await submitDevnetMemoLifecycle();

    return appendLifecycleEvidence(lifecycleEntry, currentEntries);
  }

  async function handleSubmitRealDevnetMemo() {
    if (isDevnetEvidenceBusy) {
      return;
    }

    setSubmitMemoState("submitting");
    setSubmitMemoError(null);

    try {
      await runSingleDevnetEvidenceTest();
    } catch (error) {
      setSubmitMemoError(
        error instanceof Error
          ? error.message
          : "Unable to submit devnet memo.",
      );
    } finally {
      setSubmitMemoState("idle");
    }
  }

  async function handleRunDevnetEvidenceTest() {
    if (isDevnetEvidenceBusy) {
      return;
    }

    setSubmitMemoState("submitting");
    setSubmitMemoError(null);

    try {
      await runSingleDevnetEvidenceTest();
    } catch (error) {
      setSubmitMemoError(
        error instanceof Error
          ? error.message
          : "Unable to run devnet evidence test.",
      );
    } finally {
      setSubmitMemoState("idle");
    }
  }

  async function handleRunTenDevnetTests() {
    if (isDevnetEvidenceBusy) {
      return;
    }

    let nextEntries = lifecycleEntries;

    setSubmitMemoState("submitting");
    setSubmitMemoError(null);
    setDevnetTestProgress({
      running: true,
      completed: 0,
      target: 10,
    });

    try {
      for (let index = 0; index < 10; index += 1) {
        nextEntries = await runSingleDevnetEvidenceTest(nextEntries);
        setDevnetTestProgress({
          running: true,
          completed: index + 1,
          target: 10,
        });
      }
    } catch (error) {
      setSubmitMemoError(
        error instanceof Error
          ? error.message
          : "Devnet evidence run stopped after an RPC or wallet error.",
      );
    } finally {
      setSubmitMemoState("idle");
      setDevnetTestProgress((currentProgress) => ({
        ...currentProgress,
        running: false,
      }));
    }
  }

  function evidenceFileTimestamp() {
    return new Date().toISOString();
  }

  function evidenceFileSlug(timestamp: string) {
    return timestamp.replace(/[:.]/g, "-");
  }

  function downloadEvidenceFile(filename: string, content: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function fetchPersistedRealJitoEvidenceSnapshot() {
    const response = await fetchWithRetry(
      "/api/jito/bundle-status",
      {
        cache: "no-store",
      },
      "Jito evidence refresh",
    );

    if (!response.ok) {
      throw new Error(`Jito evidence request failed: ${response.status}`);
    }

    return (await response.json()) as RealJitoEvidenceSnapshot;
  }

  function createJudgeEvidenceMarkdown(
    generatedAt: string,
    persistedRealJitoEvidence: RealJitoBundleEvidenceRecord[],
  ) {
    return [
      "# BundleIQ Judge Evidence",
      "",
      "## Project Name",
      "",
      "BundleIQ",
      "",
      "## Export Timestamp",
      "",
      generatedAt,
      "",
      "## Evidence Notes",
      "",
      "- Devnet memo lifecycle rows marked `real-devnet-memo` are real Solana devnet data.",
      "- Mock lifecycle rows are marked `mock simulation`.",
      "- Real Jito records are counted only when persisted through `/api/jito/bundle-status`.",
      "- Devnet memo tests prove lifecycle tracking. They are not Jito bundle submissions.",
      "- Yellowstone is marked connected only when `/api/solana/stream-status` reports `source: yellowstone` and `streamConnected: true`.",
      "- BundleIQ does not treat a sendBundle receipt as landed without a separate status check.",
      "",
      exportNetworkStatusAsMarkdown(activeSolanaStatus),
      "",
      exportRealJitoEvidenceAsMarkdown(persistedRealJitoEvidence),
      "",
      exportLifecycleAsMarkdown(lifecycleEntries),
      "",
      exportFailureCasesAsMarkdown(simulatedFailures),
      "",
      exportAIDecisionsAsMarkdown({
        decision: aiDecisionLabel,
        reason: aiDecisionReason,
        tipDecision,
        leaderWindow,
        retryDecision,
        signals: retrySignals,
        activeBundle: activeBundleSubmission,
      }),
      "",
      exportRequirementStatusAsMarkdown(requirementChecks),
      "",
    ].join("\n");
  }

  async function handleExportJudgeEvidence() {
    const generatedAt = evidenceFileTimestamp();
    const filename = `bundleiq-judge-evidence-${evidenceFileSlug(generatedAt)}.md`;
    let persistedRealJitoEvidence = realJitoEvidence;

    try {
      const snapshot = await fetchPersistedRealJitoEvidenceSnapshot();

      persistedRealJitoEvidence = snapshot.records;
      setRealJitoEvidence(snapshot.records);
      setRealJitoEvidenceError(null);
    } catch (error) {
      setRealJitoEvidenceError(
        error instanceof Error
          ? error.message
          : "Unable to refresh persisted Jito evidence before export.",
      );
    }

    downloadEvidenceFile(
      filename,
      createJudgeEvidenceMarkdown(generatedAt, persistedRealJitoEvidence),
      "text/markdown;charset=utf-8",
    );
    persistExportHistory(
      createExportHistoryEntry({
        filename,
        format: "markdown",
        exportedAt: generatedAt,
      }),
    );
  }

  function handleExportLifecycleJson() {
    const generatedAt = evidenceFileTimestamp();
    const filename = `bundleiq-lifecycle-${evidenceFileSlug(generatedAt)}.json`;

    downloadEvidenceFile(
      filename,
      exportLifecycleAsJson(lifecycleEntries, generatedAt),
      "application/json;charset=utf-8",
    );
    persistExportHistory(
      createExportHistoryEntry({
        filename,
        format: "json",
        exportedAt: generatedAt,
      }),
    );
  }

  function handleClearLocalEvidence() {
    if (!window.confirm(LOCAL_EVIDENCE_CLEAR_WARNING)) {
      return;
    }

    const resetFailure = injectExpiredBlockhashFailure("fault-expired-blockhash");

    clearLocalEvidenceStore();
    setLifecycleEntries(createInitialLifecycleEntries(lifecycle));
    setSimulatedFailures(getSimulatedFailures());
    setStoredAIDecisions([]);
    setExportedEvidenceHistory([]);
    setActiveFailure(resetFailure);
    setRetryDecision(
      getRetryDecision(
        resetFailure,
        jitoBundle.dynamicTipLamports,
        network.leaderDistance,
        network.rpcLatencyMs,
      ),
    );
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const savedEvidence = loadLocalEvidenceStore();

      if (savedEvidence.lifecycleLogs.length > 0) {
        setLifecycleEntries(savedEvidence.lifecycleLogs);
      }

      if (savedEvidence.failureCases.length > 0) {
        const restoredFailure = savedEvidence.failureCases[0];
        const restoredRetryDecision =
          savedEvidence.aiDecisions[0]?.retryDecision ??
          getRetryDecision(
            restoredFailure,
            jitoBundle.dynamicTipLamports,
            network.leaderDistance,
            network.rpcLatencyMs,
          );

        setSimulatedFailures(savedEvidence.failureCases);
        setActiveFailure(restoredFailure);
        setRetryDecision(restoredRetryDecision);
      }

      if (savedEvidence.aiDecisions.length > 0) {
        setStoredAIDecisions(savedEvidence.aiDecisions);
      }

      if (savedEvidence.exportedEvidenceHistory.length > 0) {
        setExportedEvidenceHistory(savedEvidence.exportedEvidenceHistory);
      }
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    jitoBundle.dynamicTipLamports,
    network.leaderDistance,
    network.rpcLatencyMs,
  ]);

  useEffect(() => {
    let isMounted = true;

    async function loadSolanaStatus() {
      try {
        const response = await fetchWithRetry(
          "/api/solana/stream-status",
          {
            cache: "no-store",
          },
          "Solana stream status",
        );

        if (!response.ok) {
          throw new Error(`Solana stream status request failed: ${response.status}`);
        }

        const status = (await response.json()) as YellowstoneStreamStatusResponse;

        if (isMounted) {
          setSolanaStatus(status);
          setNetworkFeedState(
            status.source === "yellowstone" && status.streamConnected
              ? "yellowstone"
              : "rpc-fallback",
          );
        }
      } catch {
        if (isMounted) {
          setSolanaStatus(null);
          setNetworkFeedState("fallback");
        }
      }
    }

    loadSolanaStatus();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadRealJitoEvidence() {
      try {
        const response = await fetchWithRetry(
          "/api/jito/bundle-status",
          {
            cache: "no-store",
          },
          "Jito evidence load",
        );

        if (!response.ok) {
          throw new Error(`Jito evidence request failed: ${response.status}`);
        }

        const snapshot = (await response.json()) as RealJitoEvidenceSnapshot;

        if (isMounted) {
          setRealJitoEvidence(snapshot.records);
          setRealJitoEvidenceError(null);
        }
      } catch (error) {
        if (isMounted) {
          setRealJitoEvidenceError(
            error instanceof Error
              ? error.message
              : "Unable to load real Jito evidence.",
          );
        }
      }
    }

    loadRealJitoEvidence();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadTestnetWalletStatus() {
      try {
        const response = await fetchWithRetry(
          "/api/solana/testnet-wallet-status",
          {
            cache: "no-store",
          },
          "Testnet wallet status",
        );
        const status = (await response.json()) as
          | Omit<Extract<TestnetWalletStatusState, { state: "ready" }>, "state">
          | Omit<
              Extract<TestnetWalletStatusState, { state: "setup-error" }>,
              "state"
            >;

        if (!isMounted) {
          return;
        }

        if (!response.ok || "error" in status) {
          setTestnetWalletStatus({
            state: "setup-error",
            error:
              "error" in status
                ? status.error
                : "Unable to read testnet wallet status.",
            network: "testnet",
            funded: false,
          });
          return;
        }

        setTestnetWalletStatus({
          state: "ready",
          ...status,
        });
      } catch {
        if (isMounted) {
          setTestnetWalletStatus({
            state: "setup-error",
            error: "Unable to reach testnet wallet status route.",
            network: "testnet",
            funded: false,
          });
        }
      }
    }

    loadTestnetWalletStatus();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (testnetWalletStatus.state !== "ready" || testnetWalletStatus.funded) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setBundleSubmissions((currentSubmissions) => {
        const nextSubmissions = currentSubmissions.filter(
          (submission) => !isRealJitoTestnetBundle(submission),
        );

        if (nextSubmissions.length === currentSubmissions.length) {
          return currentSubmissions;
        }

        return nextSubmissions.length > 0
          ? nextSubmissions
          : [
              createInitialBundleSubmission(
                network.currentSlot,
                network.leaderDistance,
                network.status,
                jitoBundle.dynamicTipLamports,
              ),
            ];
      });
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    jitoBundle.dynamicTipLamports,
    network.currentSlot,
    network.leaderDistance,
    network.status,
    testnetWalletStatus,
  ]);

  return (
    <main className="min-h-screen overflow-x-hidden bg-background py-5 text-foreground lg:py-8">
      <div className="mx-auto flex w-[calc(100vw-2rem)] min-w-0 max-w-7xl flex-col gap-6 sm:w-[calc(100vw-3rem)] lg:w-[calc(100vw-4rem)]">
        <header className="rounded-lg border border-white/10 bg-[linear-gradient(135deg,rgba(15,23,42,0.92),rgba(4,9,15,0.96))] px-4 py-5 shadow-[0_24px_80px_rgba(0,0,0,0.36)] sm:px-6 lg:px-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0 max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={network.status} />
                <StatusBadge label={networkFeedLabel} status={networkFeedSeverity} />
                <StatusBadge label="Yellowstone P2" status="neutral" />
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
                BundleIQ
              </h1>
              <p className="mt-3 max-w-2xl break-words text-sm leading-6 text-slate-300">
                Production-style Solana infrastructure dashboard foundation for
                slot monitoring, leader tracking, transaction lifecycle
                visibility, Jito bundle status, dynamic tips, failure
                classification, and AI decision reasoning.
              </p>
            </div>
            <div className="min-w-0 rounded-lg border border-cyan-300/15 bg-cyan-300/[0.045] p-4 lg:min-w-[300px]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.18em] text-cyan-100/70">
                    Review Build
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    Devnet readiness data plane
                  </p>
                </div>
                <StatusBadge label="No Jito Submit" status="neutral" />
              </div>
              <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                <HeaderStat
                  label="Current Slot"
                  value={currentSlotValue}
                />
                <HeaderStat
                  label="Target Slot"
                  value={formatSlot(jitoBundle.targetSlot)}
                />
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={ShieldCheck}
            label="Network Health"
            value={network.status}
            detail={
              isNetworkLoading
                ? "Loading Yellowstone stream"
                : isYellowstoneNetwork
                  ? `${activeSolanaStatus.commitment} Yellowstone stream`
                  : isRpcFallbackNetwork
                    ? "Solana devnet RPC fallback"
                  : `${network.rpcLatencyMs}ms mock RPC latency`
            }
            tone="success"
          />
          <MetricCard
            icon={Activity}
            label="Current Slot"
            value={currentSlotMetricValue}
            detail={isYellowstoneNetwork ? "Yellowstone gRPC devnet" : networkFeedLabel}
            tone="info"
          />
          <MetricCard
            icon={Radio}
            label="Current Leader"
            value={network.currentLeader}
            detail={`Mock leader identity ${network.leaderIdentity}`}
            tone="neutral"
          />
          <MetricCard
            icon={Gauge}
            label="Dynamic Tip"
            value={formatLamports(tipDecision.tipLamports)}
            detail="Mock Jito adapter"
            tone="warning"
          />
        </section>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
          <div className="grid gap-5">
            <SectionPanel
              title="1. Network Status"
              description="Yellowstone gRPC slot stream with Solana devnet RPC fallback."
              action={<StatusBadge label={networkFeedLabel} status={networkFeedSeverity} />}
              className="bg-[linear-gradient(180deg,rgba(15,23,42,0.78),rgba(6,11,18,0.82))]"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <PanelKicker icon={Activity} label="Yellowstone Slot Stream" />
                  <DetailRow label="Data Source" value={dataSourceValue} />
                  <DetailRow label="Current Slot" value={currentSlotValue} />
                  <DetailRow label="Processed Slot" value={processedSlotValue} />
                  <DetailRow label="Confirmed Slot" value={confirmedSlotValue} />
                </div>
                <div className="space-y-3">
                  <PanelKicker icon={ShieldCheck} label="Commitment Progress" />
                  <DetailRow label="Finalized Slot" value={finalizedSlotValue} />
                  <DetailRow
                    label="Processed -> Confirmed Delta"
                    value={processedToConfirmedDeltaValue}
                  />
                  <DetailRow label="Stream Status" value={streamStatusValue} />
                </div>
              </div>
            </SectionPanel>

            <SectionPanel
              title="2. Jito Bundle Status"
              description="Mock Jito adapter readiness, leader timing, and dynamic tip."
              action={
                <div className="flex min-w-0 max-w-full flex-wrap justify-start gap-2 sm:justify-end">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-auto min-h-7 min-w-0 max-w-full shrink whitespace-normal text-left leading-4"
                    onClick={handleSubmitAutoSignedJitoBundle}
                    disabled={isAutoSignedJitoSubmitDisabled}
                  >
                    <Send className="size-3.5" />
                    {isJitoBundleSubmitBusy
                      ? "Submitting Auto-Signed Jito"
                      : "Submit Auto-Signed Jito Testnet Bundle"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-auto min-h-7 min-w-0 max-w-full shrink whitespace-normal text-left leading-4"
                    onClick={handleRunTenRealJitoTests}
                    disabled={isRunTenRealJitoTestsDisabled}
                  >
                    <Activity className="size-3.5" />
                    {realJitoTestProgress.running
                      ? `Running ${realJitoTestProgressLabel}`
                      : "Run 10 Real Jito Tests"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-auto min-h-7 min-w-0 max-w-full shrink whitespace-normal text-left leading-4"
                    onClick={handleSimulateJitoBundle}
                  >
                    <Play className="size-3.5" />
                    Simulate Jito Bundle
                  </Button>
                  <StatusBadge
                    label={simulatedBundleStatusLabels[activeBundleSubmission.status]}
                    status={severityForSimulatedBundle(activeBundleSubmission.status)}
                    className="h-auto min-h-6 min-w-0 max-w-full shrink whitespace-normal overflow-visible text-left leading-4"
                  />
                </div>
              }
              className="bg-[linear-gradient(180deg,rgba(8,20,27,0.76),rgba(6,11,18,0.84))]"
            >
              <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,220px)]">
                <div className="min-w-0 rounded-lg border border-cyan-300/15 bg-cyan-300/[0.045] p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
                      <PackageCheck className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs uppercase tracking-[0.16em] text-cyan-100/70">
                        Bundle ID
                      </p>
                      <p className="mt-1 break-all font-mono text-sm leading-5 text-white">
                        {activeBundleSubmission.bundleId}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 h-2 rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-cyan-300"
                      style={{ width: `${tipDecision.confidence}%` }}
                    />
                  </div>
                  <p className="mt-2 break-words text-xs text-muted-foreground">
                    {activeBundleSourceLabel}: {activeBundleSubmission.reason}
                  </p>
                  <p className="mt-2 break-all text-xs leading-5 text-slate-300">
                    {testnetWalletStatusLine}
                  </p>
                </div>
                <div className="grid min-w-0 gap-3">
                  <DetailRow
                    label="Leader Distance"
                    value={`${activeBundleSubmission.leaderDistance} slots`}
                  />
                  <DetailRow
                    label="Dynamic Tip"
                    value={formatLamports(activeBundleSubmission.tipLamports)}
                  />
                  <DetailRow
                    label="Status"
                    value={simulatedBundleStatusLabels[activeBundleSubmission.status]}
                  />
                  <DetailRow
                    label="Simulation Mode"
                    value={activeBundleSubmission.mode}
                  />
                </div>
              </div>
              <div className="mt-4 min-w-0 break-words rounded-md border border-amber-300/20 bg-amber-300/[0.045] px-3 py-2 text-xs leading-5 text-amber-100">
                {JITO_BUNDLE_RECEIPT_WARNING}
                <span className="mt-1 block">
                  Submit responses stay submitted-not-landed until the separate
                  bundle status check reports otherwise.
                </span>
              </div>
              {submitJitoBundleError && (
                <div className="mt-3 min-w-0 break-words rounded-md border border-rose-300/20 bg-rose-300/[0.05] px-3 py-2 text-xs leading-5 text-rose-100">
                  {submitJitoBundleError}
                </div>
              )}
              {realJitoTestProgress.target > 0 && (
                <div className="mt-3 min-w-0 break-words rounded-md border border-white/10 bg-white/[0.035] px-3 py-2 text-xs leading-5 text-muted-foreground">
                  Real Jito test progress: {realJitoTestProgressLabel}.
                </div>
              )}
              {displayedRealJitoEvidence.length > 0 && (
                <div className="mt-3 min-w-0 break-words rounded-md border border-white/10 bg-white/[0.035] px-3 py-2 text-xs leading-5 text-muted-foreground">
                  Real Jito summary: landed {realJitoStatusSummary.landed};
                  failed {realJitoStatusSummary.failed}; expired{" "}
                  {realJitoStatusSummary.expired}; pending{" "}
                  {realJitoStatusSummary.pending}; network-error{" "}
                  {realJitoStatusSummary.networkError}.
                </div>
              )}
              <div className="mt-4 min-w-0 overflow-x-auto rounded-md border border-white/10">
                <table className="w-full min-w-full table-fixed text-left text-xs sm:min-w-[920px]">
                  <colgroup>
                    <col className="w-[24%]" />
                    <col className="w-[12%]" />
                    <col className="w-[11%]" />
                    <col className="w-[12%]" />
                    <col className="w-[9%]" />
                    <col className="w-[10%]" />
                    <col className="w-[7%]" />
                    <col className="w-[8%]" />
                    <col className="w-[7%]" />
                  </colgroup>
                  <thead className="border-b border-white/10 text-muted-foreground">
                    <tr>
                      <th className="break-words px-3 py-2 align-top font-medium">Bundle ID</th>
                      <th className="break-words px-3 py-2 align-top font-medium">Submitted At</th>
                      <th className="break-words px-3 py-2 align-top font-medium">Status</th>
                      <th className="break-words px-3 py-2 align-top font-medium">Checked At</th>
                      <th className="break-words px-3 py-2 align-top font-medium">Landed Slot</th>
                      <th className="break-words px-3 py-2 align-top font-medium">Confirmation</th>
                      <th className="break-words px-3 py-2 align-top font-medium">Tip</th>
                      <th className="break-words px-3 py-2 align-top font-medium">Source</th>
                      <th className="break-words px-3 py-2 align-top font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedRealJitoEvidence.length > 0 ? (
                      displayedRealJitoEvidence.map((record) => {
                        const dashboardStatus =
                          getRealJitoDashboardStatus(record);
                        const isCheckingThisBundle =
                          checkingBundleId === record.bundleId;
                        const isPollingThisBundle =
                          pollingBundleId === record.bundleId;

                        return (
                          <tr
                            key={record.bundleId}
                            className="border-b border-white/10 last:border-b-0"
                          >
                            <td className="min-w-0 break-all px-3 py-3 align-top font-mono text-cyan-100">
                              {record.bundleId}
                            </td>
                            <td className="break-words px-3 py-3 align-top font-mono text-slate-300">
                              {formatEvidenceTimestamp(record.submittedAt)}
                            </td>
                            <td className="px-3 py-3 align-top">
                              <StatusBadge
                                label={getRealJitoDashboardStatusLabel(
                                  dashboardStatus,
                                )}
                                status={getRealJitoDashboardStatusSeverity(
                                  dashboardStatus,
                                )}
                                className="h-auto min-h-6 min-w-0 max-w-full shrink whitespace-normal overflow-visible text-left leading-4"
                              />
                            </td>
                            <td className="break-words px-3 py-3 align-top font-mono text-slate-300">
                              {formatEvidenceTimestamp(record.statusCheckedAt)}
                            </td>
                            <td className="break-words px-3 py-3 align-top font-mono text-slate-300">
                              {formatEvidenceSlot(record.landedSlot)}
                            </td>
                            <td className="break-words px-3 py-3 align-top font-mono text-slate-300">
                              {record.confirmationLevel ??
                                record.confirmationStatus ??
                                "Pending"}
                            </td>
                            <td className="break-words px-3 py-3 align-top font-mono text-slate-300">
                              {formatLamports(record.tipLamports)}
                            </td>
                            <td className="break-words px-3 py-3 align-top font-mono text-slate-300">
                              {record.source}
                            </td>
                            <td className="px-3 py-3 align-top">
                              <div className="min-w-0 space-y-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-auto min-h-7 min-w-0 max-w-full shrink whitespace-normal text-left leading-4"
                                  onClick={() =>
                                    handleCheckRealJitoBundleStatus(
                                      record.bundleId,
                                    )
                                  }
                                  disabled={
                                    Boolean(checkingBundleId) ||
                                    Boolean(pollingBundleId)
                                  }
                                >
                                  <RefreshCw className="size-3.5" />
                                  {isPollingThisBundle
                                    ? `Polling ${pollingAttempt}/${JITO_STATUS_POLL_MAX_ATTEMPTS}`
                                    : isCheckingThisBundle
                                      ? "Checking"
                                      : "Check Bundle Status"}
                                </Button>
                                <details className="max-w-full text-xs text-slate-300">
                                  <summary className="cursor-pointer break-words font-mono text-cyan-100">
                                    Raw Status Payload
                                  </summary>
                                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border border-white/10 bg-black/30 p-2 text-[11px] leading-4 text-slate-300">
                                    {JSON.stringify(
                                      record.rawStatusPayload ?? null,
                                      null,
                                      2,
                                    )}
                                  </pre>
                                </details>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td
                          colSpan={9}
                          className="px-3 py-4 text-center text-muted-foreground"
                        >
                          {realJitoEvidenceError ??
                            (!isTestnetWalletFunded &&
                            testnetWalletStatus.state === "ready"
                              ? JITO_TESTNET_UNFUNDED_MESSAGE
                              : "No real Jito bundle evidence captured yet.")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </SectionPanel>
          </div>

          <SectionPanel
            title="3. AI Agent Decision"
            description="Mock Jito tip, leader timing, and retry reasoning."
            action={<StatusBadge label="Jito Adapter Mock" status="info" />}
            className="bg-[linear-gradient(180deg,rgba(15,23,42,0.82),rgba(7,10,17,0.9))]"
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-md border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
                <Bot className="size-5" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-cyan-100/70">
                  Decision
                </p>
                <h2 className="mt-1 text-lg font-semibold leading-6 text-white">
                  {aiDecisionLabel}
                </h2>
              </div>
            </div>
            <p className="mt-5 text-sm leading-6 text-slate-300">
              {aiDecisionReason}
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <DetailRow
                label="Tip Decision"
                value={formatLamports(tipDecision.tipLamports)}
              />
              <DetailRow
                label="Leader Timing"
                value={leaderTimingDecision}
              />
              <DetailRow
                label="Retry Decision"
                value={retryDecision?.shouldRetry ? "Retry" : "No retry"}
              />
            </div>
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>Tip Confidence</span>
                <span className="font-mono">{tipDecision.confidence}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-emerald-300"
                  style={{ width: `${tipDecision.confidence}%` }}
                />
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {retrySignals.map((signal) => (
                <span
                  key={signal}
                  className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-xs text-slate-300"
                >
                  <Sparkles className="size-3 text-cyan-200" />
                  {signal}
                </span>
              ))}
            </div>
          </SectionPanel>
        </section>

        <SectionPanel
          title="4. Transaction Lifecycle Log"
          description="Real devnet memo lifecycle rows and mock simulation rows with stage timing."
          action={
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={handleSubmitRealDevnetMemo}
                disabled={isDevnetEvidenceBusy}
              >
                <Send className="size-3.5" />
                {submitMemoState === "submitting"
                  ? "Submitting Devnet Memo"
                  : "Submit Real Devnet Memo"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRunDevnetEvidenceTest}
                disabled={isDevnetEvidenceBusy}
              >
                <Send className="size-3.5" />
                Run Devnet Evidence Test
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRunTenDevnetTests}
                disabled={isDevnetEvidenceBusy}
              >
                <Activity className="size-3.5" />
                {devnetTestProgress.running
                  ? `Running ${devnetTestProgressLabel}`
                  : "Run 10 Devnet Tests"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleSimulateBundleLifecycle}
              >
                <Play className="size-3.5" />
                Simulate Bundle Lifecycle
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleInjectBlockhashExpiry}
              >
                <RefreshCw className="size-3.5" />
                Inject Blockhash Expiry
              </Button>
            </div>
          }
          contentClassName="p-0"
          className="bg-[linear-gradient(180deg,rgba(15,23,42,0.78),rgba(6,11,18,0.86))]"
        >
          <div className="border-b border-white/10 px-4 py-3 text-xs leading-5 text-muted-foreground sm:px-5">
            Devnet only. No mainnet funds. No private keys in browser.
            <span className="mt-1 block">
              Devnet memo tests prove lifecycle tracking. They are not Jito bundle
              submissions.
            </span>
            {devnetTestProgress.target > 0 && (
              <span className="mt-1 block">
                Devnet evidence progress: {devnetTestProgressLabel}.
              </span>
            )}
            {submitMemoError && (
              <span className="mt-2 block text-rose-200">{submitMemoError}</span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1280px] text-sm">
              <thead className="border-b border-white/10 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium sm:px-5">Signature</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Submitted At</th>
                  <th className="px-4 py-3 font-medium">Processed At</th>
                  <th className="px-4 py-3 font-medium">Confirmed At</th>
                  <th className="px-4 py-3 font-medium">Finalized At</th>
                  <th className="px-4 py-3 font-medium">Latency Delta</th>
                  <th className="px-4 py-3 font-medium sm:px-5">Failure Classification</th>
                </tr>
              </thead>
              <tbody>
                {lifecycleEntries.map((entry) => {
                  const deltas = calculateStageDeltas(entry);
                  const finalStatus = classifyFinalStatus(entry);

                  return (
                    <tr
                      key={entry.id}
                      className="border-b border-white/10 last:border-b-0"
                    >
                      <td className="px-4 py-4 font-mono text-xs text-cyan-100 sm:px-5">
                        {compactSignature(entry.signature)}
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge status={entry.stage} />
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge
                          label={lifecycleSourceLabel(entry)}
                          status={isRealDevnetMemoEntry(entry) ? "success" : "info"}
                        />
                      </td>
                      <td className="px-4 py-4 font-mono text-xs text-muted-foreground">
                        {formatLifecycleTimestamp(entry.submittedAt)}
                      </td>
                      <td className="px-4 py-4 font-mono text-xs text-muted-foreground">
                        {formatLifecycleTimestamp(entry.processedAt)}
                      </td>
                      <td className="px-4 py-4 font-mono text-xs text-muted-foreground">
                        {formatLifecycleTimestamp(entry.confirmedAt)}
                      </td>
                      <td className="px-4 py-4 font-mono text-xs text-muted-foreground">
                        {formatLifecycleTimestamp(entry.finalizedAt)}
                      </td>
                      <td className="px-4 py-4 font-mono text-xs">
                        {formatDuration(deltas.totalLatencyMs)}
                      </td>
                      <td className="px-4 py-4 sm:px-5">
                        <StatusBadge
                          label={
                            entry.failure?.failureType ??
                            (finalStatus === "failed" ? "unclassified" : "none")
                          }
                          status={entry.failure ? "danger" : "neutral"}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionPanel>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <SectionPanel
            title="5. Failure Cases"
            description="Fault-injection simulations for mock transaction and bundle failures."
            action={
              <StatusBadge
                label={`${simulatedFailures.length} Simulated`}
                status="warning"
              />
            }
            className="bg-[linear-gradient(180deg,rgba(20,16,12,0.72),rgba(7,10,17,0.86))]"
          >
            <div className="space-y-3">
              {simulatedFailures.map((failure) => (
                <div
                  key={failure.id}
                  className="rounded-lg border border-white/10 bg-white/[0.035] p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <StatusBadge
                      label={failure.failureType}
                      status="danger"
                    />
                    <StatusBadge
                      label={failure.retryRequired ? "Retry Required" : "No Retry"}
                      status={failure.retryRequired ? "warning" : "success"}
                    />
                  </div>
                  <p className="mt-4 text-sm leading-6 text-slate-300">
                    {failure.reason}
                  </p>
                  <div className="mt-3 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-xs leading-5 text-muted-foreground">
                    <span className="font-medium text-slate-200">Recovery:</span>{" "}
                    {failure.recoveryAction}
                  </div>
                </div>
              ))}
            </div>
          </SectionPanel>

          <SectionPanel
            title="6. Requirement Tracker"
            description="Visible README-facing checklist for bounty review."
            action={
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExportJudgeEvidence}
                >
                  <Download className="size-3.5" />
                  Export Judge Evidence
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExportLifecycleJson}
                >
                  <FileJson className="size-3.5" />
                  Export Lifecycle JSON
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleClearLocalEvidence}
                >
                  <Trash2 className="size-3.5" />
                  Clear Local Evidence
                </Button>
                <StatusBadge label="Judge Ready" status="success" />
              </div>
            }
            className="bg-[linear-gradient(180deg,rgba(15,23,42,0.82),rgba(7,10,17,0.9))]"
          >
            <p className="mb-3 text-xs leading-5 text-muted-foreground">
              Tracker reflects current local project state. Mock and simulated
              items are labeled.
            </p>
            <div className="grid gap-3">
              {requirementChecks.map((item, index) => (
                <div
                  key={item.id}
                  className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.035] p-3 sm:grid-cols-[32px_1fr_auto] sm:items-center"
                >
                  <div className="flex size-8 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] font-mono text-xs text-slate-300">
                    {index + 1}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{item.label}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {item.evidence}
                      {item.countLabel ? ` Count: ${item.countLabel}.` : ""}
                    </p>
                  </div>
                  <StatusBadge
                    label={requirementStatusLabels[item.status]}
                    status={severityForRequirement(item.status)}
                    className="justify-self-start sm:justify-self-end"
                  />
                </div>
              ))}
            </div>
          </SectionPanel>
        </section>
      </div>
    </main>
  );
}

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-white/10 bg-black/20 px-3 py-2">
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-mono text-slate-100">{value}</p>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone: SignalSeverity;
}) {
  const toneClass = {
    success: "border-emerald-300/20 bg-emerald-300/[0.045] text-emerald-100",
    info: "border-cyan-300/20 bg-cyan-300/[0.045] text-cyan-100",
    warning: "border-amber-300/20 bg-amber-300/[0.045] text-amber-100",
    danger: "border-rose-300/20 bg-rose-300/[0.045] text-rose-100",
    neutral: "border-white/10 bg-white/[0.035] text-slate-100",
  }[tone];

  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-card/75 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-3 truncate font-mono text-lg font-semibold text-white">
            {value}
          </p>
        </div>
        <div
          className={`flex size-9 shrink-0 items-center justify-center rounded-md border ${toneClass}`}
        >
          <Icon className="size-4" />
        </div>
      </div>
      <p className="mt-3 truncate text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function PanelKicker({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-cyan-100/70">
      <Icon className="size-3.5" />
      {label}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-white/10 bg-[#080d14]/75 px-3 py-2.5">
      <div className="break-words text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words font-mono text-sm leading-5 text-slate-100">
        {value}
      </div>
    </div>
  );
}
