import { mockDashboardSnapshot } from "@/lib/mock-data";
import type { DashboardSnapshot } from "@/types/bounty";

export const MOCK_DASHBOARD: DashboardSnapshot = mockDashboardSnapshot;

export function getDashboardSnapshot() {
  return MOCK_DASHBOARD;
}
