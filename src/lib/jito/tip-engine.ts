import type { BundleStatus, BundleTipDecision } from "@/types/jito";

interface CalculateDynamicTipInput {
  networkHealth: "healthy" | "degraded" | "congested";
  leaderDistance: number;
  recentFailures: string[];
  slotLatencyMs?: number | null;
  bundleHistory?: BundleStatus[];
  baseTip: number;
}

function hasTipTooLowFailure(recentFailures: string[]) {
  return recentFailures.some((failure) => {
    const normalizedFailure = failure.toLowerCase();

    return (
      normalizedFailure.includes("tip-too-low") ||
      normalizedFailure.includes("insufficient-tip") ||
      normalizedFailure.includes("insufficient tip") ||
      normalizedFailure.includes("below") ||
      normalizedFailure.includes("threshold")
    );
  });
}

export function calculateDynamicTip({
  networkHealth,
  leaderDistance,
  recentFailures,
  slotLatencyMs = null,
  bundleHistory = [],
  baseTip,
}: CalculateDynamicTipInput): BundleTipDecision {
  let multiplier = 1;
  const reasons: string[] = [];
  const bundleFailureCount = bundleHistory.filter(
    (status) => status === "failed",
  ).length;
  const bundleSuccessCount = bundleHistory.filter(
    (status) => status === "landed" || status === "simulated",
  ).length;

  if (leaderDistance <= 1) {
    multiplier += 0.25;
    reasons.push("leader is immediate");
  } else if (leaderDistance <= 2) {
    multiplier += 0.16;
    reasons.push("leader is near");
  } else if (leaderDistance <= 4) {
    multiplier += 0.08;
    reasons.push("leader window is approaching");
  }

  if (hasTipTooLowFailure(recentFailures)) {
    multiplier += 0.2;
    reasons.push("recent tip-too-low failure");
  }

  if (recentFailures.some((failure) => failure === "leader-skipped-slot")) {
    multiplier += 0.1;
    reasons.push("recent leader skipped slot");
  }

  if (networkHealth === "congested") {
    multiplier += 0.12;
    reasons.push("network is congested");
  } else if (networkHealth === "degraded") {
    multiplier += 0.06;
    reasons.push("network is degraded");
  } else {
    multiplier -= 0.05;
    reasons.push("network is healthy");
  }

  if (typeof slotLatencyMs === "number") {
    if (slotLatencyMs >= 1_000) {
      multiplier += 0.14;
      reasons.push(`slot latency is high at ${slotLatencyMs}ms`);
    } else if (slotLatencyMs >= 500) {
      multiplier += 0.09;
      reasons.push(`slot latency is elevated at ${slotLatencyMs}ms`);
    } else {
      multiplier += 0.02;
      reasons.push(`slot latency is live/fallback at ${slotLatencyMs}ms`);
    }
  } else {
    reasons.push("slot latency is unavailable");
  }

  if (bundleFailureCount > 0) {
    multiplier += Math.min(0.18, bundleFailureCount * 0.06);
    reasons.push(`${bundleFailureCount} recent bundle failure(s)`);
  }

  if (bundleSuccessCount > 0 && bundleFailureCount === 0) {
    multiplier -= 0.03;
    reasons.push(`${bundleSuccessCount} recent successful bundle signal(s)`);
  }

  const tipLamports = Math.max(baseTip, Math.ceil(baseTip * multiplier));
  const confidence = Math.min(
    96,
    Math.max(72, Math.round(82 + (tipLamports / baseTip - 1) * 45)),
  );

  return {
    tipLamports,
    reason: `Dynamic tip adjusted because ${reasons.join(", ")}.`,
    confidence,
    inputs: {
      leaderDistance,
      recentFailureCount: recentFailures.length,
      slotLatencyMs,
      bundleFailureCount,
      bundleSuccessCount,
    },
  };
}
