import type {
  JitoBundleState,
  RequirementStatus,
  SlotState,
  TransactionLifecycle,
} from "./bounty";

export type * from "./bounty";

export type NetworkStatus = SlotState;
export type JitoBundleStatus = JitoBundleState;
export type TransactionLifecycleEntry = TransactionLifecycle;
export type RequirementItem = RequirementStatus;
