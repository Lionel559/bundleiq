export type SignalSeverity = "success" | "info" | "warning" | "danger" | "neutral";

export type SlotHealth = "healthy" | "degraded" | "congested";

export type JitoBundleStateStatus = "mock-ready" | "queued" | "landed" | "failed";

export type LifecycleStage =
  | "submitted"
  | "simulated"
  | "processed"
  | "confirmed"
  | "finalized"
  | "failed";

export type TransactionRoute = "standard-rpc" | "priority-rpc" | "jito-mock";

export type FailureClassification =
  | "blockhash-expired"
  | "insufficient-tip"
  | "simulation-error"
  | "leader-missed";

export type RequirementState = "done" | "mocked" | "next";

export interface SlotState {
  status: SlotHealth;
  currentSlot: number;
  currentLeader: string;
  leaderIdentity: string;
  leaderDistance: number;
  rpcLatencyMs: number;
  tps: number;
  skippedSlotRate: number;
  source: "yellowstone-mock" | "rpc-mock";
  observedAt: string;
}

export interface JitoBundleState {
  bundleId: string;
  status: JitoBundleStateStatus;
  targetSlot: number;
  successRate: number;
  dynamicTipLamports: number;
  relayRegion: string;
  relayMode: "mock";
}

export interface CommitmentProgression {
  submittedSlot: number;
  simulatedSlot?: number;
  processedSlot?: number;
  confirmedSlot?: number;
  finalizedSlot?: number;
  failedSlot?: number;
  lastObservedSlot: number;
  currentCommitment: LifecycleStage;
}

export interface FailureCase {
  id: string;
  signature: string;
  classification: FailureClassification;
  cause: string;
  recovery: string;
  severity: SignalSeverity;
}

export interface TransactionLifecycle {
  signature: string;
  slot: number;
  stage: LifecycleStage;
  tipLamports: number;
  timestamp: string;
  route: TransactionRoute;
  latencyMs: number;
  commitmentProgression: CommitmentProgression;
  failure?: FailureCase;
}

export interface AIDecision {
  id: string;
  decision: string;
  reason: string;
  confidence: number;
  recommendedTipLamports: number;
  signals: string[];
  createdAt: string;
}

export interface RequirementStatus {
  label: string;
  status: RequirementState;
  evidence: string;
}

export interface DashboardSnapshot {
  network: SlotState;
  jitoBundle: JitoBundleState;
  lifecycle: TransactionLifecycle[];
  failures: FailureCase[];
  aiDecision: AIDecision;
  requirements: RequirementStatus[];
}
