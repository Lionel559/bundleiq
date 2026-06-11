import type { JudgeRequirementState } from "@/lib/requirements/evaluate-requirements";
import type { RetryDecision } from "@/lib/retry/retry-agent";
import type { SimulatedFailure } from "@/lib/solana/fault-injection";
import type { SimulatedLifecycleEntry } from "@/lib/solana/lifecycle-tracker";

const STORAGE_KEY = "bundleiq:judge-evidence:v1";
const STORE_VERSION = 1;
const MAX_LIFECYCLE_LOGS = 50;
const MAX_FAILURE_CASES = 50;
const MAX_AI_DECISIONS = 50;
const MAX_EXPORT_HISTORY = 20;

export type StoredAIDecisionSource =
  | "simulation"
  | "mock"
  | "real-devnet"
  | "real-devnet-memo";
export type StoredEvidenceExportFormat = "markdown" | "json";

export interface StoredAIDecision {
  id: string;
  decision: string;
  reason: string;
  source: StoredAIDecisionSource;
  signals: string[];
  retryDecision: RetryDecision | null;
  createdAt: string;
}

export interface StoredRequirementProgress {
  id: string;
  label: string;
  status: JudgeRequirementState;
  countLabel?: string;
}

export interface StoredEvidenceExport {
  id: string;
  filename: string;
  format: StoredEvidenceExportFormat;
  exportedAt: string;
  networkSource: string;
  lifecycleCount: number;
  failureCount: number;
  aiDecisionCount: number;
  requirementProgress: StoredRequirementProgress[];
  notes: string[];
}

export interface LocalEvidenceStore {
  version: typeof STORE_VERSION;
  lifecycleLogs: SimulatedLifecycleEntry[];
  failureCases: SimulatedFailure[];
  aiDecisions: StoredAIDecision[];
  exportedEvidenceHistory: StoredEvidenceExport[];
  updatedAt: string | null;
}

function createEmptyStore(): LocalEvidenceStore {
  return {
    version: STORE_VERSION,
    lifecycleLogs: [],
    failureCases: [],
    aiDecisions: [],
    exportedEvidenceHistory: [],
    updatedAt: null,
  };
}

function canUseLocalStorage() {
  try {
    return typeof window !== "undefined" && Boolean(window.localStorage);
  } catch {
    return false;
  }
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function trimToLimit<T>(items: T[], limit: number) {
  return items.slice(0, limit);
}

function normalizeLifecycleLog(entry: SimulatedLifecycleEntry) {
  return {
    ...entry,
    source:
      entry.source === "real-devnet"
        ? ("real-devnet-memo" as const)
        : entry.source,
  };
}

function normalizeStore(value: unknown): LocalEvidenceStore {
  if (!value || typeof value !== "object") {
    return createEmptyStore();
  }

  const partial = value as Partial<LocalEvidenceStore>;

  return {
    version: STORE_VERSION,
    lifecycleLogs: trimToLimit(
      asArray<SimulatedLifecycleEntry>(partial.lifecycleLogs).map(
        normalizeLifecycleLog,
      ),
      MAX_LIFECYCLE_LOGS,
    ),
    failureCases: trimToLimit(
      asArray<SimulatedFailure>(partial.failureCases),
      MAX_FAILURE_CASES,
    ),
    aiDecisions: trimToLimit(
      asArray<StoredAIDecision>(partial.aiDecisions),
      MAX_AI_DECISIONS,
    ),
    exportedEvidenceHistory: trimToLimit(
      asArray<StoredEvidenceExport>(partial.exportedEvidenceHistory),
      MAX_EXPORT_HISTORY,
    ),
    updatedAt:
      typeof partial.updatedAt === "string" ? partial.updatedAt : null,
  };
}

export function loadLocalEvidenceStore(): LocalEvidenceStore {
  if (!canUseLocalStorage()) {
    return createEmptyStore();
  }

  try {
    const rawStore = window.localStorage.getItem(STORAGE_KEY);

    return rawStore ? normalizeStore(JSON.parse(rawStore)) : createEmptyStore();
  } catch {
    return createEmptyStore();
  }
}

export function saveLocalEvidenceStore(store: LocalEvidenceStore) {
  if (!canUseLocalStorage()) {
    return false;
  }

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...normalizeStore(store),
        updatedAt: new Date().toISOString(),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

function updateLocalEvidenceStore(
  update: (store: LocalEvidenceStore) => LocalEvidenceStore,
) {
  return saveLocalEvidenceStore(update(loadLocalEvidenceStore()));
}

export function saveLifecycleLogs(lifecycleLogs: SimulatedLifecycleEntry[]) {
  return updateLocalEvidenceStore((store) => ({
    ...store,
    lifecycleLogs: trimToLimit(lifecycleLogs, MAX_LIFECYCLE_LOGS),
  }));
}

export function saveFailureCases(failureCases: SimulatedFailure[]) {
  return updateLocalEvidenceStore((store) => ({
    ...store,
    failureCases: trimToLimit(failureCases, MAX_FAILURE_CASES),
  }));
}

export function saveAIDecisions(aiDecisions: StoredAIDecision[]) {
  return updateLocalEvidenceStore((store) => ({
    ...store,
    aiDecisions: trimToLimit(aiDecisions, MAX_AI_DECISIONS),
  }));
}

export function saveExportedEvidenceHistory(
  exportedEvidenceHistory: StoredEvidenceExport[],
) {
  return updateLocalEvidenceStore((store) => ({
    ...store,
    exportedEvidenceHistory: trimToLimit(
      exportedEvidenceHistory,
      MAX_EXPORT_HISTORY,
    ),
  }));
}

export function clearLocalEvidenceStore() {
  if (!canUseLocalStorage()) {
    return false;
  }

  try {
    window.localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
