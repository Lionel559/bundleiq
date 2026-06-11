import type { SimulatedFailureType } from "@/lib/solana/fault-injection";

export interface RetryDecisionInput {
  failureType: SimulatedFailureType;
  blockhashAge: number;
  currentTip: number;
  leaderDistance: number;
  rpcLatency: number;
}

export interface RetryDecision {
  shouldRetry: boolean;
  newTip: number;
  refreshBlockhash: boolean;
  reason: string;
  nextAction: string;
}

function bumpTip(currentTip: number, multiplier: number) {
  return Math.ceil(currentTip * multiplier);
}

export function decideRetryAction({
  failureType,
  blockhashAge,
  currentTip,
  leaderDistance,
  rpcLatency,
}: RetryDecisionInput): RetryDecision {
  if (failureType === "expired-blockhash") {
    return {
      shouldRetry: true,
      newTip: bumpTip(currentTip, 1.12),
      refreshBlockhash: true,
      reason: `Blockhash age ${blockhashAge} is stale for the mock lifecycle window.`,
      nextAction: "Refresh blockhash, recalculate tip, and resubmit.",
    };
  }

  if (failureType === "insufficient-tip") {
    return {
      shouldRetry: true,
      newTip: bumpTip(currentTip, leaderDistance <= 2 ? 1.2 : 1.12),
      refreshBlockhash: blockhashAge > 100,
      reason: `Tip ${currentTip} is below the simulated threshold while leader distance is ${leaderDistance}.`,
      nextAction: "Increase tip and retry the simulated bundle lifecycle.",
    };
  }

  if (failureType === "compute-exceeded") {
    return {
      shouldRetry: true,
      newTip: bumpTip(currentTip, rpcLatency > 120 ? 1.08 : 1.04),
      refreshBlockhash: blockhashAge > 90,
      reason: "Compute budget was exceeded in the mock execution path.",
      nextAction: "Increase compute budget, refresh if stale, then resubmit.",
    };
  }

  if (failureType === "leader-skipped-slot") {
    return {
      shouldRetry: true,
      newTip: bumpTip(currentTip, leaderDistance <= 2 ? 1.18 : 1.1),
      refreshBlockhash: blockhashAge > 60,
      reason: `Leader skipped the targeted slot while leader distance is ${leaderDistance}.`,
      nextAction:
        "Wait for the next viable leader window, refresh stale blockhash, recalculate tip, and resubmit.",
    };
  }

  return {
    shouldRetry: true,
    newTip: bumpTip(currentTip, 1.15),
    refreshBlockhash: blockhashAge > 75,
    reason: "Mock bundle relay rejected the submitted bundle payload.",
    nextAction: "Rebuild bundle payload, recalculate tip, and resubmit.",
  };
}
