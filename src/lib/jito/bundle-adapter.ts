import type {
  BundleSimulationMode,
  BundleSubmissionInput,
  BundleSubmissionResult,
} from "@/types/jito";

interface PrepareBundlePayloadInput {
  transactions: string[];
  tipLamports: number;
  leaderSlot: number;
  leaderDistance: number;
  reason: string;
  mode?: BundleSimulationMode;
}

function createMockBundleId(leaderSlot: number) {
  return `biq-sim-${leaderSlot}-${Math.random().toString(36).slice(2, 8)}`;
}

export function prepareBundlePayload({
  transactions,
  tipLamports,
  leaderSlot,
  leaderDistance,
  reason,
  mode = "mock-only",
}: PrepareBundlePayloadInput): BundleSubmissionInput {
  return {
    transactions,
    tipLamports,
    leaderSlot,
    leaderDistance,
    reason,
    mode,
  };
}

export function simulateBundleSubmission(
  input: BundleSubmissionInput,
): BundleSubmissionResult {
  const canSimulateSubmission = input.leaderDistance >= 0 && input.leaderDistance <= 4;

  return {
    bundleId: createMockBundleId(input.leaderSlot),
    status: canSimulateSubmission ? "simulated" : "prepared",
    tipLamports: input.tipLamports,
    submittedAt: new Date().toISOString(),
    leaderSlot: input.leaderSlot,
    leaderDistance: input.leaderDistance,
    reason: canSimulateSubmission
      ? `Mock Jito adapter accepted bundle payload. ${input.reason}`
      : `Mock Jito adapter prepared payload only. ${input.reason}`,
    mode: input.mode,
    bundleSource: "mock-simulation",
    statusSource: "simulation",
  };
}
