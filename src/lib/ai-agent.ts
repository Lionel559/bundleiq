import type { AIDecision, FailureCase, JitoBundleState, SlotState } from "@/types/bounty";

interface CreateAIDecisionInput {
  slotState: SlotState;
  bundleState: JitoBundleState;
  failureCases: FailureCase[];
  confidence?: number;
  createdAt?: string;
}

function formatLeaderDistance(distance: number) {
  if (distance === 1) {
    return "one slot";
  }

  if (distance === 2) {
    return "two slots";
  }

  return `${distance} slots`;
}

export function createAIDecision({
  slotState,
  bundleState,
  failureCases,
  confidence = 91,
  createdAt = "2026-06-02T21:12:00.000Z",
}: CreateAIDecisionInput): AIDecision {
  const hasTipSensitiveFailure = failureCases.some(
    (failure) => failure.classification === "insufficient-tip",
  );
  const hasSimulationFailure = failureCases.some(
    (failure) => failure.classification === "simulation-error",
  );
  const decision =
    hasTipSensitiveFailure || slotState.leaderDistance <= 2
      ? "Raise tip and submit through Jito mock path"
      : "Keep priority RPC route and monitor next leader slot";
  const failureReason = hasSimulationFailure
    ? "simulation failures still need inspection"
    : "recent failures are tip-sensitive rather than simulation failures";

  return {
    id: "ai-decision-001",
    decision,
    reason: `Leader is ${formatLeaderDistance(
      slotState.leaderDistance,
    )} away, network latency is low, and ${failureReason}.`,
    confidence,
    recommendedTipLamports: bundleState.dynamicTipLamports,
    signals: [
      `leader-distance:${slotState.leaderDistance}`,
      `rpc-latency:${slotState.rpcLatencyMs}ms`,
      hasTipSensitiveFailure
        ? "failure-class:insufficient-tip"
        : "failure-class:simulation-aware",
      `bundle-success:${bundleState.successRate}%`,
    ],
    createdAt,
  };
}

export function explainDecision(decision: AIDecision) {
  return `${decision.reason} Signals: ${decision.signals.join(", ")}.`;
}
