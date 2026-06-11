import type { JitoLeaderWindow } from "@/types/jito";

interface EstimateLeaderWindowInput {
  currentSlot: number;
  targetLeaderSlot: number;
}

export function estimateLeaderWindow({
  currentSlot,
  targetLeaderSlot,
}: EstimateLeaderWindowInput): JitoLeaderWindow {
  const leaderDistance = targetLeaderSlot - currentSlot;

  if (leaderDistance < 0) {
    return {
      leaderDistance,
      isNearLeader: false,
      shouldSubmitNow: false,
      reason: "Target leader slot has already passed.",
    };
  }

  if (leaderDistance <= 2) {
    return {
      leaderDistance,
      isNearLeader: true,
      shouldSubmitNow: true,
      reason: "Leader slot is close enough for simulated bundle submission.",
    };
  }

  if (leaderDistance <= 4) {
    return {
      leaderDistance,
      isNearLeader: true,
      shouldSubmitNow: false,
      reason: "Leader window is near; prepare payload and wait for tighter timing.",
    };
  }

  return {
    leaderDistance,
    isNearLeader: false,
    shouldSubmitNow: false,
    reason: "Leader slot is still too far away for bundle submission.",
  };
}
