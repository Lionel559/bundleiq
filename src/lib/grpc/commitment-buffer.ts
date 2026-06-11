export type SlotCommitmentStage = "processed" | "confirmed" | "finalized";

export interface SlotCommitmentRecord {
  slot: number;
  processedAt?: number;
  confirmedAt?: number;
  finalizedAt?: number;
}

export type CommitmentBuffer = Record<string, SlotCommitmentRecord>;

function timestampKey(stage: SlotCommitmentStage) {
  if (stage === "processed") {
    return "processedAt" as const;
  }

  if (stage === "confirmed") {
    return "confirmedAt" as const;
  }

  return "finalizedAt" as const;
}

function calculateDelta(
  buffer: CommitmentBuffer,
  firstStage: "processedAt" | "confirmedAt",
  secondStage: "confirmedAt" | "finalizedAt",
) {
  const matchingRecords = Object.values(buffer)
    .filter((record) => record[firstStage] !== undefined && record[secondStage] !== undefined)
    .sort((a, b) => b.slot - a.slot);

  const latestRecord = matchingRecords[0];

  if (!latestRecord) {
    return null;
  }

  return latestRecord[secondStage]! - latestRecord[firstStage]!;
}

export function promoteSlotCommitment(
  buffer: CommitmentBuffer,
  slot: number,
  stage: SlotCommitmentStage,
  observedAt = Date.now(),
) {
  const key = String(slot);
  const record = buffer[key] ?? { slot };
  const stageTimestamp = timestampKey(stage);

  buffer[key] = {
    ...record,
    [stageTimestamp]: record[stageTimestamp] ?? observedAt,
  };

  return buffer[key];
}

export function calculateProcessedToConfirmedDelta(buffer: CommitmentBuffer) {
  return calculateDelta(buffer, "processedAt", "confirmedAt");
}

export function calculateConfirmedToFinalizedDelta(buffer: CommitmentBuffer) {
  return calculateDelta(buffer, "confirmedAt", "finalizedAt");
}
