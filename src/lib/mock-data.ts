import { createAIDecision } from "@/lib/ai-agent";
import { classifyFailure, getRecoveryAction } from "@/lib/failures";
import type {
  DashboardSnapshot,
  FailureCase,
  JitoBundleState,
  RequirementStatus,
  SlotState,
  TransactionLifecycle,
} from "@/types/bounty";

export const mockSlotState: SlotState = {
  status: "healthy",
  currentSlot: 356_918_421,
  currentLeader: "Jito Labs Validator",
  leaderIdentity: "J1to...b1dr",
  leaderDistance: 2,
  rpcLatencyMs: 43,
  tps: 4_128,
  skippedSlotRate: 0.59,
  source: "yellowstone-mock",
  observedAt: "2026-06-02T21:12:00.000Z",
};

export const mockBundleState: JitoBundleState = {
  bundleId: "biq-mock-8f2c",
  status: "mock-ready",
  targetSlot: 356_918_423,
  successRate: 85.7,
  dynamicTipLamports: 15_224,
  relayRegion: "devnet-sim",
  relayMode: "mock",
};

export const mockFailureCases: FailureCase[] = [
  {
    id: "fail-001",
    signature: "m6CUW5iqcA7Bx15aKgX4jNvyH7G3y",
    classification: classifyFailure("Blockhash expired during leader handoff."),
    cause: "Blockhash expired during leader handoff.",
    recovery: getRecoveryAction("blockhash-expired"),
    severity: "danger",
  },
  {
    id: "fail-002",
    signature: "3x97rFQ4YeStLbQe6HTus",
    classification: classifyFailure("Tip landed below current mock Jito threshold."),
    cause: "Tip landed below current mock Jito threshold.",
    recovery: getRecoveryAction("insufficient-tip"),
    severity: "warning",
  },
];

export const mockTransactionLifecycles: TransactionLifecycle[] = [
  {
    signature: "g6x6N1aKkWfzQmVK4FtqKQeN4GEM8n3A2Nc1xyTGY",
    slot: 356_918_421,
    stage: "finalized",
    tipLamports: 16_100,
    timestamp: "09:12:00 PM",
    route: "jito-mock",
    latencyMs: 612,
    commitmentProgression: {
      submittedSlot: 356_918_419,
      simulatedSlot: 356_918_419,
      processedSlot: 356_918_420,
      confirmedSlot: 356_918_421,
      finalizedSlot: 356_918_421,
      lastObservedSlot: 356_918_421,
      currentCommitment: "finalized",
    },
  },
  {
    signature: "E7XLCLm1q9HRfY7xYfVvR4N5Q8tdZyXh",
    slot: 356_918_420,
    stage: "confirmed",
    tipLamports: 10_400,
    timestamp: "09:11:07 PM",
    route: "priority-rpc",
    latencyMs: 488,
    commitmentProgression: {
      submittedSlot: 356_918_419,
      processedSlot: 356_918_420,
      confirmedSlot: 356_918_420,
      lastObservedSlot: 356_918_420,
      currentCommitment: "confirmed",
    },
  },
  {
    signature: "m6CUW5iqcA7Bx15aKgX4jNvyH7G3y",
    slot: 356_918_418,
    stage: "failed",
    tipLamports: 8_200,
    timestamp: "09:10:14 PM",
    route: "standard-rpc",
    latencyMs: 1_480,
    commitmentProgression: {
      submittedSlot: 356_918_416,
      processedSlot: 356_918_417,
      failedSlot: 356_918_418,
      lastObservedSlot: 356_918_418,
      currentCommitment: "failed",
    },
    failure: mockFailureCases[0],
  },
  {
    signature: "wf9GJ6MbFK8iXqp4sqoOHK48",
    slot: 356_918_417,
    stage: "processed",
    tipLamports: 14_900,
    timestamp: "09:09:42 PM",
    route: "jito-mock",
    latencyMs: 276,
    commitmentProgression: {
      submittedSlot: 356_918_416,
      processedSlot: 356_918_417,
      lastObservedSlot: 356_918_417,
      currentCommitment: "processed",
    },
  },
  {
    signature: "4P9kV1rjAn3XvKc2mLq8sHn77vKQ1",
    slot: 356_918_416,
    stage: "submitted",
    tipLamports: 15_224,
    timestamp: "09:09:18 PM",
    route: "jito-mock",
    latencyMs: 91,
    commitmentProgression: {
      submittedSlot: 356_918_416,
      lastObservedSlot: 356_918_416,
      currentCommitment: "submitted",
    },
  },
];

export const mockAIDecisions = [
  createAIDecision({
    slotState: mockSlotState,
    bundleState: mockBundleState,
    failureCases: mockFailureCases,
  }),
];

export const mockRequirementStatus: RequirementStatus[] = [
  {
    label: "Network Status",
    status: "done",
    evidence: "Current slot, leader, TPS, latency, and skipped slot rate.",
  },
  {
    label: "Jito Bundle Status",
    status: "mocked",
    evidence: "Bundle ID, mock relay, target slot, success rate, and tip.",
  },
  {
    label: "AI Agent Decision",
    status: "mocked",
    evidence: "Decision, reason, confidence, signals, and recommended tip.",
  },
  {
    label: "Transaction Lifecycle Log",
    status: "done",
    evidence: "Submitted through finalized/failed mock transaction stages.",
  },
  {
    label: "Failure Cases",
    status: "done",
    evidence: "Blockhash-expired and insufficient-tip classifications.",
  },
  {
    label: "Requirement Tracker",
    status: "done",
    evidence: "In-app checklist mirrors README bounty requirement tracking.",
  },
];

export const mockDashboardSnapshot: DashboardSnapshot = {
  network: mockSlotState,
  jitoBundle: mockBundleState,
  lifecycle: mockTransactionLifecycles,
  failures: mockFailureCases,
  aiDecision: mockAIDecisions[0],
  requirements: mockRequirementStatus,
};
