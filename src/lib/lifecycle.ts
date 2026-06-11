import type {
  CommitmentProgression,
  SignalSeverity,
  TransactionLifecycle,
} from "@/types/bounty";

export interface CommitmentDelta {
  processedSlotDelta: number | null;
  confirmedSlotDelta: number | null;
  finalizedSlotDelta: number | null;
  latestSlotDelta: number;
}

function slotDelta(fromSlot: number, toSlot?: number) {
  return typeof toSlot === "number" ? Math.max(toSlot - fromSlot, 0) : null;
}

export function calculateCommitmentDelta(
  progression: CommitmentProgression,
): CommitmentDelta {
  const latestSlot =
    progression.finalizedSlot ??
    progression.confirmedSlot ??
    progression.processedSlot ??
    progression.simulatedSlot ??
    progression.failedSlot ??
    progression.lastObservedSlot;

  return {
    processedSlotDelta: slotDelta(progression.submittedSlot, progression.processedSlot),
    confirmedSlotDelta: slotDelta(progression.submittedSlot, progression.confirmedSlot),
    finalizedSlotDelta: slotDelta(progression.submittedSlot, progression.finalizedSlot),
    latestSlotDelta: Math.max(latestSlot - progression.submittedSlot, 0),
  };
}

export function classifyLifecycleStatus(
  lifecycle: Pick<TransactionLifecycle, "failure" | "stage">,
): SignalSeverity {
  if (lifecycle.failure || lifecycle.stage === "failed") {
    return "danger";
  }

  if (lifecycle.stage === "finalized") {
    return "success";
  }

  if (lifecycle.stage === "submitted" || lifecycle.stage === "simulated") {
    return "warning";
  }

  return "info";
}

export function formatLifecycleLatency(latencyMs: number) {
  if (latencyMs < 1_000) {
    return `${Math.round(latencyMs)}ms`;
  }

  return `${(latencyMs / 1_000).toFixed(1)}s`;
}
