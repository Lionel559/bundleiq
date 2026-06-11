export type SimulatedFailureType =
  | "expired-blockhash"
  | "insufficient-tip"
  | "compute-exceeded"
  | "bundle-rejected"
  | "leader-skipped-slot";

export interface SimulatedFailure {
  id: string;
  failureType: SimulatedFailureType;
  reason: string;
  recoveryAction: string;
  retryRequired: boolean;
}

const simulatedFailures: Record<
  SimulatedFailureType,
  Omit<SimulatedFailure, "failureType" | "id">
> = {
  "expired-blockhash": {
    reason: "Mock blockhash aged past the last valid block height before landing.",
    recoveryAction: "Refresh blockhash, recalculate tip, and resubmit.",
    retryRequired: true,
  },
  "insufficient-tip": {
    reason: "Mock priority fee landed below the simulated leader threshold.",
    recoveryAction: "Increase the tip before retrying the bundle path.",
    retryRequired: true,
  },
  "compute-exceeded": {
    reason: "Mock transaction consumed more compute units than the configured budget.",
    recoveryAction: "Raise compute budget or simplify the instruction set before retry.",
    retryRequired: true,
  },
  "bundle-rejected": {
    reason: "Mock bundle relay rejected the packet during validation.",
    recoveryAction: "Rebuild the bundle payload and resubmit after validation passes.",
    retryRequired: true,
  },
  "leader-skipped-slot": {
    reason: "Targeted leader skipped the slot before the bundle could land.",
    recoveryAction:
      "Wait for the next viable leader window, refresh blockhash if needed, recalculate tip, and resubmit.",
    retryRequired: true,
  },
};

export const simulatedFailureTypes = Object.keys(
  simulatedFailures,
) as SimulatedFailureType[];

export function injectSimulatedFailure(
  failureType: SimulatedFailureType,
  id = `fault-${failureType}`,
): SimulatedFailure {
  return {
    id,
    failureType,
    ...simulatedFailures[failureType],
  };
}

export function injectExpiredBlockhashFailure(id?: string) {
  return injectSimulatedFailure("expired-blockhash", id);
}

export function injectInsufficientTipFailure(id?: string) {
  return injectSimulatedFailure("insufficient-tip", id);
}

export function injectComputeExceededFailure(id?: string) {
  return injectSimulatedFailure("compute-exceeded", id);
}

export function injectBundleRejectedFailure(id?: string) {
  return injectSimulatedFailure("bundle-rejected", id);
}

export function injectLeaderSkippedSlotFailure(id?: string) {
  return injectSimulatedFailure("leader-skipped-slot", id);
}

export function injectRandomFailure(id?: string) {
  const failureType =
    simulatedFailureTypes[Math.floor(Math.random() * simulatedFailureTypes.length)];

  return injectSimulatedFailure(failureType, id);
}

export function getSimulatedFailures() {
  return simulatedFailureTypes.map((failureType) =>
    injectSimulatedFailure(failureType),
  );
}
