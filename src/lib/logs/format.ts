import type { LifecycleStage } from "@/types";

export const LIFECYCLE_STAGES: LifecycleStage[] = [
  "submitted",
  "simulated",
  "processed",
  "confirmed",
  "finalized",
  "failed",
];

export const lifecycleStageLabels: Record<LifecycleStage, string> = {
  submitted: "Submitted",
  simulated: "Simulated",
  processed: "Processed",
  confirmed: "Confirmed",
  finalized: "Finalized",
  failed: "Failed",
};
