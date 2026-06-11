import type { SimulatedFailure } from "./fault-injection";

export type SimulatedLifecycleStage =
  | "submitted"
  | "processed"
  | "confirmed"
  | "finalized"
  | "failed";

export interface SimulatedLifecycleEntry {
  id: string;
  signature: string;
  slot: number;
  route: "devnet-mock" | "jito-mock" | "devnet-real";
  source: "mock-simulation" | "real-devnet-memo" | "real-devnet";
  tipLamports: number;
  stage: SimulatedLifecycleStage;
  submittedAt: string;
  processedAt?: string;
  confirmedAt?: string;
  finalizedAt?: string;
  failedAt?: string;
  failure?: SimulatedFailure;
}

export interface LifecycleStageDeltas {
  submittedToProcessedMs: number | null;
  submittedToConfirmedMs: number | null;
  submittedToFinalizedMs: number | null;
  totalLatencyMs: number;
}

export interface DevnetMemoLifecycleResult {
  signature: string;
  slot: number;
  submittedAt: string;
  processedAt: string;
  confirmedAt: string;
  finalizedAt: string;
  status: "finalized";
  deltas: LifecycleStageDeltas;
}

export type SimulatedFinalStatus = "pending" | "landed" | "failed";

interface CreateLifecycleEntryInput {
  id?: string;
  signature?: string;
  slot: number;
  tipLamports: number;
  route?: SimulatedLifecycleEntry["route"];
  source?: SimulatedLifecycleEntry["source"];
  submittedAt?: string;
}

function toTimestampMs(timestamp: string) {
  return new Date(timestamp).getTime();
}

function offsetTimestamp(timestamp: string, offsetMs: number) {
  return new Date(toTimestampMs(timestamp) + offsetMs).toISOString();
}

function makeMockSignature(seed: string | number) {
  return `mock${String(seed).replace(/[^a-zA-Z0-9]/g, "").slice(-10)}${Math.random()
    .toString(36)
    .slice(2, 16)}`;
}

export function createLifecycleEntry({
  id = `life-${Date.now()}`,
  signature = makeMockSignature(id),
  slot,
  tipLamports,
  route = "jito-mock",
  source = "mock-simulation",
  submittedAt = new Date().toISOString(),
}: CreateLifecycleEntryInput): SimulatedLifecycleEntry {
  return {
    id,
    signature,
    slot,
    route,
    source,
    tipLamports,
    stage: "submitted",
    submittedAt,
  };
}

export function updateLifecycleStage(
  entry: SimulatedLifecycleEntry,
  stage: SimulatedLifecycleStage,
  timestamp = new Date().toISOString(),
  failure?: SimulatedFailure,
): SimulatedLifecycleEntry {
  const nextEntry: SimulatedLifecycleEntry = {
    ...entry,
    stage,
  };

  if (stage === "processed") {
    nextEntry.processedAt = timestamp;
  }

  if (stage === "confirmed") {
    nextEntry.confirmedAt = timestamp;
  }

  if (stage === "finalized") {
    nextEntry.finalizedAt = timestamp;
  }

  if (stage === "failed") {
    nextEntry.failedAt = timestamp;
    nextEntry.failure = failure ?? entry.failure;
  }

  return nextEntry;
}

export function calculateStageDeltas(
  entry: SimulatedLifecycleEntry,
): LifecycleStageDeltas {
  const submittedAt = toTimestampMs(entry.submittedAt);
  const finalTimestamp =
    entry.finalizedAt ?? entry.failedAt ?? entry.confirmedAt ?? entry.processedAt;

  return {
    submittedToProcessedMs: entry.processedAt
      ? Math.max(toTimestampMs(entry.processedAt) - submittedAt, 0)
      : null,
    submittedToConfirmedMs: entry.confirmedAt
      ? Math.max(toTimestampMs(entry.confirmedAt) - submittedAt, 0)
      : null,
    submittedToFinalizedMs: entry.finalizedAt
      ? Math.max(toTimestampMs(entry.finalizedAt) - submittedAt, 0)
      : null,
    totalLatencyMs: finalTimestamp
      ? Math.max(toTimestampMs(finalTimestamp) - submittedAt, 0)
      : 0,
  };
}

export function classifyFinalStatus(
  entry: SimulatedLifecycleEntry,
): SimulatedFinalStatus {
  if (entry.stage === "failed" || entry.failure) {
    return "failed";
  }

  if (entry.stage === "finalized") {
    return "landed";
  }

  return "pending";
}

export function progressLifecycleEntry(
  entry: SimulatedLifecycleEntry,
  finalStage: "confirmed" | "finalized" | "failed",
  failure?: SimulatedFailure,
) {
  const processedAt = offsetTimestamp(entry.submittedAt, 210);
  const confirmedAt = offsetTimestamp(entry.submittedAt, 640);
  const finalizedAt = offsetTimestamp(entry.submittedAt, 1_180);
  const failedAt = offsetTimestamp(entry.submittedAt, 820);
  const processedEntry = updateLifecycleStage(entry, "processed", processedAt);

  if (finalStage === "failed") {
    return updateLifecycleStage(processedEntry, "failed", failedAt, failure);
  }

  const confirmedEntry = updateLifecycleStage(
    processedEntry,
    "confirmed",
    confirmedAt,
  );

  if (finalStage === "confirmed") {
    return confirmedEntry;
  }

  return updateLifecycleStage(confirmedEntry, "finalized", finalizedAt);
}
