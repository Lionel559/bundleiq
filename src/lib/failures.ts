import type { FailureCase, FailureClassification } from "@/types/bounty";

const recoveryActions: Record<FailureClassification, string> = {
  "blockhash-expired": "Refresh blockhash and resubmit with leader-aware tip.",
  "insufficient-tip": "Raise dynamic tip from 10,000 to 15,224 lamports.",
  "simulation-error": "Re-run simulation and inspect account or compute budget constraints.",
  "leader-missed": "Wait for the next favorable leader slot and resubmit through priority path.",
};

export function classifyFailure(
  failure: string | Pick<FailureCase, "cause" | "classification">,
): FailureClassification {
  if (typeof failure !== "string") {
    return failure.classification;
  }

  const normalizedFailure = failure.toLowerCase();

  if (normalizedFailure.includes("blockhash") || normalizedFailure.includes("expired")) {
    return "blockhash-expired";
  }

  if (normalizedFailure.includes("tip") || normalizedFailure.includes("threshold")) {
    return "insufficient-tip";
  }

  if (normalizedFailure.includes("leader") || normalizedFailure.includes("handoff")) {
    return "leader-missed";
  }

  return "simulation-error";
}

export function getRecoveryAction(classification: FailureClassification) {
  return recoveryActions[classification];
}
