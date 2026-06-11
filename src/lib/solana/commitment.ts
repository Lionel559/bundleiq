export const commitmentStages = [
  "submitted",
  "processed",
  "confirmed",
  "finalized",
] as const;

export type CommitmentStage = (typeof commitmentStages)[number];

export type CommitmentStageTimestamps = Partial<
  Record<CommitmentStage, Date | number | string>
>;

export type CommitmentTimestampDeltas = Partial<
  Record<`${CommitmentStage}To${Capitalize<CommitmentStage>}Ms`, number>
>;

function toTimestampMs(timestamp: Date | number | string) {
  if (timestamp instanceof Date) {
    return timestamp.getTime();
  }

  if (typeof timestamp === "number") {
    return timestamp;
  }

  return new Date(timestamp).getTime();
}

function capitalizeStage(stage: CommitmentStage) {
  return `${stage[0].toUpperCase()}${stage.slice(1)}` as Capitalize<CommitmentStage>;
}

export function measureCommitmentTimestampDeltas(
  timestamps: CommitmentStageTimestamps,
) {
  return commitmentStages.slice(1).reduce<CommitmentTimestampDeltas>(
    (deltas, stage) => {
      const submittedAt = timestamps.submitted;
      const stageTimestamp = timestamps[stage];

      if (!submittedAt || !stageTimestamp) {
        return deltas;
      }

      const deltaKey =
        `submittedTo${capitalizeStage(stage)}Ms` as keyof CommitmentTimestampDeltas;
      const deltaMs = toTimestampMs(stageTimestamp) - toTimestampMs(submittedAt);

      return {
        ...deltas,
        [deltaKey]: Math.max(deltaMs, 0),
      };
    },
    {},
  );
}
