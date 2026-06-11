export type BundleStatus =
  | "constructed"
  | "prepared"
  | "simulated"
  | "submitted"
  | "submitted-not-landed"
  | "pending"
  | "landed"
  | "failed"
  | "invalid"
  | "expired"
  | "unknown"
  | "network-error";

export type BundleSimulationMode =
  | "jito-testnet"
  | "mock-only"
  | "real-jito-testnet"
  | "real-jito-mainnet";
export type JitoNetwork = "testnet" | "mainnet";
export type BundleEvidenceSource =
  | "constructed-only"
  | "mock-simulation"
  | "real-jito-mainnet"
  | "real-jito-testnet";

export interface BundleSubmissionInput {
  transactions: string[];
  tipLamports: number;
  leaderSlot: number;
  leaderDistance: number;
  mode: BundleSimulationMode;
  reason: string;
}

export interface BundleSubmissionResult {
  bundleId: string;
  status: BundleStatus;
  tipLamports: number;
  submittedAt: string;
  leaderSlot: number;
  leaderDistance: number;
  reason: string;
  mode: BundleSimulationMode;
  network?: JitoNetwork;
  source?: BundleEvidenceSource;
  bundleSource?: BundleEvidenceSource;
  encoding?: "base64";
  transactionCount?: number;
  userTransactionCount?: number;
  tipAccount?: string;
  lastValidBlockHeight?: number;
  landedSlot?: number | null;
  confirmationStatus?: string | null;
  initialStatus?: "submitted-not-landed";
  statusSource?: "bundle-status" | "construction" | "sendBundle" | "simulation";
  statusCheckedAt?: string | null;
  rawStatusPayload?: unknown;
}

export interface BundleTipDecision {
  tipLamports: number;
  reason: string;
  confidence: number;
  inputs?: {
    leaderDistance: number;
    recentFailureCount: number;
    slotLatencyMs: number | null;
    bundleFailureCount: number;
    bundleSuccessCount: number;
  };
}

export interface JitoLeaderWindow {
  leaderDistance: number;
  isNearLeader: boolean;
  shouldSubmitNow: boolean;
  reason: string;
}

export interface JitoBundleStatusCheck {
  bundleId: string;
  status: BundleStatus;
  checkedAt: string;
  statusSource: "bundle-status";
  inflightStatus: string | null;
  confirmationStatus: string | null;
  confirmationLevel: string | null;
  landedSlot: number | null;
  error: unknown;
  rawStatusPayload: unknown;
}

export interface JitoConstructedBundle {
  status: "constructed";
  encodedTransactions: string[];
  encoding: "base64";
  transactionCount: number;
  userTransactionCount: number;
  tipAccount: string;
  tipLamports: number;
  lastValidBlockHeight: number;
  constructedAt: string;
  mode: "jito-testnet";
  bundleSource: "constructed-only";
  reason: string;
}
