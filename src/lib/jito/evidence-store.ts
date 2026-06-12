import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import finalJitoEvidence from "@/data/final-jito-evidence.json";
import type { SimulatedFailureType } from "@/lib/solana/fault-injection";
import type {
  BundleEvidenceSource,
  BundleStatus,
  BundleSubmissionResult,
  JitoBundleStatusCheck,
  JitoNetwork,
} from "@/types/jito";

export interface RealJitoSubmissionEvidence {
  bundleId: string;
  submittedAt: string;
  network: JitoNetwork;
  tipLamports: number;
  transactionCount: number;
  source: Extract<
    BundleEvidenceSource,
    "real-jito-testnet" | "real-jito-mainnet"
  >;
  initialStatus: "submitted-not-landed";
}

export interface RealJitoStatusCheckEvidence {
  bundleId: string;
  checkedAt: string;
  status: BundleStatus;
  landedSlot: number | null;
  confirmationStatus: string | null;
  confirmationLevel: string | null;
  failureClassification: SimulatedFailureType | null;
  error: unknown;
  rawStatusPayload: unknown;
}

export type RealJitoLifecycleStage =
  | "submitted"
  | "status_checked"
  | "landed"
  | "failed"
  | "invalid"
  | "expired"
  | "unknown"
  | "network-error";

export interface RealJitoLifecycleEvidence {
  stage: RealJitoLifecycleStage;
  at: string;
  status: BundleStatus;
  landedSlot: number | null;
  confirmationStatus: string | null;
  confirmationLevel: string | null;
}

export interface RealJitoBundleEvidenceRecord
  extends RealJitoSubmissionEvidence {
  latestStatus: BundleStatus;
  statusChecked: boolean;
  statusCheckedAt: string | null;
  checkedAt: string | null;
  landedSlot: number | null;
  confirmationStatus: string | null;
  confirmationLevel: string | null;
  failureClassification: SimulatedFailureType | null;
  error: unknown;
  rawStatusPayload: unknown;
  statusChecks: RealJitoStatusCheckEvidence[];
  lifecycle: RealJitoLifecycleEvidence[];
  lifecycleEvents: RealJitoLifecycleEvidence[];
}

export interface RealJitoEvidenceSnapshot {
  records: RealJitoBundleEvidenceRecord[];
  statusChecks: RealJitoStatusCheckEvidence[];
  realSubmissionCount: number;
  successfulSubmissionCount: number;
  failedSubmissionCount: number;
  expiredSubmissionCount: number;
  pendingSubmissionCount: number;
  networkErrorSubmissionCount: number;
  statusCheckCount: number;
  warning: string;
}

interface PersistedRealJitoBundleEvidenceRecord {
  bundleId: string;
  network: JitoNetwork;
  source: RealJitoSubmissionEvidence["source"];
  submittedAt: string;
  latestStatus: BundleStatus;
  checkedAt: string | null;
  landedSlot: number | null;
  confirmationStatus: string | null;
  confirmationLevel: string | null;
  rawStatusPayload: unknown;
  tipLamports: number;
  transactionCount: number;
  failureClassification: SimulatedFailureType | null;
  lifecycleEvents: RealJitoLifecycleEvidence[];
  statusChecks: RealJitoStatusCheckEvidence[];
  initialStatus: "submitted-not-landed";
  error: unknown;
}

interface PersistedRealJitoEvidenceFile {
  version: 1;
  updatedAt: string | null;
  records: PersistedRealJitoBundleEvidenceRecord[];
  statusChecks: RealJitoStatusCheckEvidence[];
}

const DATA_DIR = path.join(process.cwd(), ".data");
const EVIDENCE_FILE_PATH = path.join(DATA_DIR, "jito-evidence.json");
const MAX_RECORDS = 250;
const MAX_STATUS_CHECKS = 500;
const MAX_RECORD_STATUS_CHECKS = 50;
const MAX_LIFECYCLE_EVENTS = 100;

export const JITO_BUNDLE_RECEIPT_WARNING =
  "Bundle ID means submitted to Jito, not landed. Status check is required.";

function createEmptyEvidenceFile(): PersistedRealJitoEvidenceFile {
  return {
    version: 1,
    updatedAt: null,
    records: [],
    statusChecks: [],
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRealJitoSource(
  source?: BundleEvidenceSource,
): source is RealJitoSubmissionEvidence["source"] {
  return source === "real-jito-testnet" || source === "real-jito-mainnet";
}

function isBundleStatus(value: unknown): value is BundleStatus {
  return (
    value === "constructed" ||
    value === "prepared" ||
    value === "simulated" ||
    value === "submitted" ||
    value === "submitted-not-landed" ||
    value === "pending" ||
    value === "landed" ||
    value === "failed" ||
    value === "invalid" ||
    value === "expired" ||
    value === "unknown" ||
    value === "network-error"
  );
}

function isFailureClassification(
  value: unknown,
): value is SimulatedFailureType {
  return (
    value === "expired-blockhash" ||
    value === "insufficient-tip" ||
    value === "compute-exceeded" ||
    value === "bundle-rejected" ||
    value === "leader-skipped-slot"
  );
}

function isLifecycleStage(value: unknown): value is RealJitoLifecycleStage {
  return (
    value === "submitted" ||
    value === "status_checked" ||
    value === "landed" ||
    value === "failed" ||
    value === "invalid" ||
    value === "expired" ||
    value === "unknown" ||
    value === "network-error"
  );
}

function stringifyUnknown(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isJitoOkErr(error: unknown) {
  return (
    isObject(error) &&
    "Ok" in error &&
    (error as { Ok?: unknown }).Ok === null
  );
}

function normalizeLandedSlot(status: BundleStatus, landedSlot: number | null) {
  return status === "landed" ? landedSlot : null;
}

function normalizeNetwork(value: unknown): JitoNetwork {
  return value === "mainnet" ? "mainnet" : "testnet";
}

function normalizeStatus(value: unknown): BundleStatus {
  return isBundleStatus(value) ? value : "submitted-not-landed";
}

function normalizeFailureClassification(
  value: unknown,
): SimulatedFailureType | null {
  return isFailureClassification(value) ? value : null;
}

function normalizeLifecycleEvent(
  value: unknown,
): RealJitoLifecycleEvidence | null {
  if (!isObject(value)) {
    return null;
  }

  const stage = value.stage;
  const status = normalizeStatus(value.status);
  const at = asString(value.at);

  if (!isLifecycleStage(stage) || !at) {
    return null;
  }

  return {
    stage,
    at,
    status,
    landedSlot: normalizeLandedSlot(status, asNumber(value.landedSlot)),
    confirmationStatus: asString(value.confirmationStatus),
    confirmationLevel: asString(value.confirmationLevel),
  };
}

function normalizeStatusCheckEvidence(
  value: unknown,
): RealJitoStatusCheckEvidence | null {
  if (!isObject(value)) {
    return null;
  }

  const bundleId = asString(value.bundleId);
  const checkedAt = asString(value.checkedAt);

  if (!bundleId || !checkedAt) {
    return null;
  }

  const status = normalizeStatus(value.status);
  const confirmationLevel =
    asString(value.confirmationLevel) ?? asString(value.confirmationStatus);

  return {
    bundleId,
    checkedAt,
    status,
    landedSlot: asNumber(value.landedSlot),
    confirmationStatus: asString(value.confirmationStatus),
    confirmationLevel,
    failureClassification: normalizeFailureClassification(
      value.failureClassification,
    ),
    error: value.error ?? null,
    rawStatusPayload: value.rawStatusPayload ?? null,
  };
}

function normalizeLifecycleEvents(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeLifecycleEvent)
    .filter((event): event is RealJitoLifecycleEvidence => Boolean(event))
    .slice(-MAX_LIFECYCLE_EVENTS);
}

function normalizeStatusChecks(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeStatusCheckEvidence)
    .filter((check): check is RealJitoStatusCheckEvidence => Boolean(check));
}

function getEvidenceSource(
  bundle: BundleSubmissionResult,
): RealJitoSubmissionEvidence["source"] {
  const source = bundle.source ?? bundle.bundleSource;

  if (isRealJitoSource(source)) {
    return source;
  }

  return bundle.mode === "real-jito-mainnet"
    ? "real-jito-mainnet"
    : "real-jito-testnet";
}

function getEvidenceNetwork(bundle: BundleSubmissionResult): JitoNetwork {
  if (bundle.network === "mainnet" || bundle.mode === "real-jito-mainnet") {
    return "mainnet";
  }

  return "testnet";
}

function classifyRealJitoFailure(
  status: BundleStatus,
  error: unknown,
): SimulatedFailureType | null {
  if (status === "expired") {
    return "expired-blockhash";
  }

  if (status === "invalid") {
    return "bundle-rejected";
  }

  if (status === "network-error") {
    return null;
  }

  if (status !== "failed") {
    return null;
  }

  const normalizedError = stringifyUnknown(error).toLowerCase();

  if (normalizedError.includes("tip")) {
    return "insufficient-tip";
  }

  if (normalizedError.includes("leader") || normalizedError.includes("slot")) {
    return "leader-skipped-slot";
  }

  if (normalizedError.includes("blockhash") || normalizedError.includes("expired")) {
    return "expired-blockhash";
  }

  if (normalizedError.includes("compute")) {
    return "compute-exceeded";
  }

  return "bundle-rejected";
}

function createSubmittedLifecycleStage(
  submission: RealJitoSubmissionEvidence,
): RealJitoLifecycleEvidence {
  return {
    stage: "submitted",
    at: submission.submittedAt,
    status: "submitted-not-landed",
    landedSlot: null,
    confirmationStatus: null,
    confirmationLevel: null,
  };
}

function createStatusCheckLifecycleStages(
  check: RealJitoStatusCheckEvidence,
): RealJitoLifecycleEvidence[] {
  const statusChecked: RealJitoLifecycleEvidence = {
    stage: "status_checked",
    at: check.checkedAt,
    status: check.status,
    landedSlot: check.landedSlot,
    confirmationStatus: check.confirmationStatus,
    confirmationLevel: check.confirmationLevel,
  };

  if (
    check.status === "landed" ||
    check.status === "failed" ||
    check.status === "invalid" ||
    check.status === "expired" ||
    check.status === "unknown" ||
    check.status === "network-error"
  ) {
    return [
      statusChecked,
      {
        stage: check.status,
        at: check.checkedAt,
        status: check.status,
        landedSlot: check.landedSlot,
        confirmationStatus: check.confirmationStatus,
        confirmationLevel: check.confirmationLevel,
      },
    ];
  }

  return [statusChecked];
}

function normalizePersistedRecord(
  value: unknown,
): PersistedRealJitoBundleEvidenceRecord | null {
  if (!isObject(value)) {
    return null;
  }

  const bundleId = asString(value.bundleId);
  const sourceCandidate = value.source as BundleEvidenceSource | undefined;
  const source = isRealJitoSource(sourceCandidate)
    ? sourceCandidate
    : "real-jito-testnet";
  const submittedAt =
    asString(value.submittedAt) ??
    asString(value.checkedAt) ??
    asString(value.statusCheckedAt);

  if (!bundleId || !submittedAt) {
    return null;
  }

  const latestStatus = normalizeStatus(value.latestStatus);
  const checkedAt = asString(value.checkedAt) ?? asString(value.statusCheckedAt);
  const landedSlot = normalizeLandedSlot(
    latestStatus,
    asNumber(value.landedSlot),
  );
  const confirmationStatus = asString(value.confirmationStatus);
  const confirmationLevel =
    asString(value.confirmationLevel) ?? confirmationStatus;
  const error = value.error ?? null;
  const rawStatusPayload = value.rawStatusPayload ?? null;
  const failureClassification =
    latestStatus === "landed"
      ? null
      : normalizeFailureClassification(value.failureClassification) ??
        classifyRealJitoFailure(latestStatus, error);
  const lifecycleEvents = normalizeLifecycleEvents(
    value.lifecycleEvents ?? value.lifecycle,
  );
  const normalizedStatusChecks = normalizeStatusChecks(value.statusChecks).slice(
    0,
    MAX_RECORD_STATUS_CHECKS,
  );
  const statusChecks =
    normalizedStatusChecks.length > 0
      ? normalizedStatusChecks
      : checkedAt
        ? [
            {
              bundleId,
              checkedAt,
              status: latestStatus,
              landedSlot,
              confirmationStatus,
              confirmationLevel,
              failureClassification,
              error,
              rawStatusPayload,
            },
          ]
        : [];

  return {
    bundleId,
    network: normalizeNetwork(value.network),
    source,
    submittedAt,
    latestStatus,
    checkedAt,
    landedSlot,
    confirmationStatus,
    confirmationLevel,
    rawStatusPayload,
    tipLamports: asNumber(value.tipLamports) ?? 0,
    transactionCount: asNumber(value.transactionCount) ?? 0,
    failureClassification,
    lifecycleEvents,
    statusChecks,
    initialStatus: "submitted-not-landed",
    error,
  };
}

function normalizeEvidenceFile(value: unknown): PersistedRealJitoEvidenceFile {
  if (Array.isArray(value)) {
    return normalizeEvidenceFile({ updatedAt: null, records: value });
  }

  if (!isObject(value)) {
    return createEmptyEvidenceFile();
  }

  const recordsByBundleId = new Map<
    string,
    PersistedRealJitoBundleEvidenceRecord
  >();
  const records = Array.isArray(value.records) ? value.records : [];

  for (const recordValue of records) {
    const record = normalizePersistedRecord(recordValue);

    if (record && !recordsByBundleId.has(record.bundleId)) {
      recordsByBundleId.set(record.bundleId, record);
    }
  }
  const normalizedRecords = Array.from(recordsByBundleId.values()).slice(
    0,
    MAX_RECORDS,
  );
  const normalizedStatusChecks = normalizeStatusChecks(value.statusChecks).slice(
    0,
    MAX_STATUS_CHECKS,
  );
  const statusChecks =
    normalizedStatusChecks.length > 0
      ? normalizedStatusChecks
      : normalizedRecords
          .flatMap((record) => record.statusChecks)
          .slice(0, MAX_STATUS_CHECKS);

  return {
    version: 1,
    updatedAt: asString(value.updatedAt),
    records: normalizedRecords,
    statusChecks,
  };
}

function ensureDataDirectory() {
  mkdirSync(DATA_DIR, { recursive: true });
}

function readEvidenceFile(): PersistedRealJitoEvidenceFile {
  try {
    ensureDataDirectory();

    if (!existsSync(EVIDENCE_FILE_PATH)) {
      return withStaticFallback(createEmptyEvidenceFile());
    }

    return withStaticFallback(
      normalizeEvidenceFile(JSON.parse(readFileSync(EVIDENCE_FILE_PATH, "utf8"))),
    );
  } catch {
    return withStaticFallback(createEmptyEvidenceFile());
  }
}

function writeEvidenceFile(store: PersistedRealJitoEvidenceFile) {
  ensureDataDirectory();

  writeFileSync(
    EVIDENCE_FILE_PATH,
    `${JSON.stringify(
      {
        ...normalizeEvidenceFile(store),
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function hasEvidence(store: PersistedRealJitoEvidenceFile) {
  return store.records.length > 0;
}

function shouldUseStaticEvidenceFallback() {
  return process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
}

function readStaticEvidenceFile(): PersistedRealJitoEvidenceFile {
  return normalizeEvidenceFile(finalJitoEvidence);
}

function withStaticFallback(
  localStore: PersistedRealJitoEvidenceFile,
): PersistedRealJitoEvidenceFile {
  if (!shouldUseStaticEvidenceFallback() || hasEvidence(localStore)) {
    return localStore;
  }

  return readStaticEvidenceFile();
}

function upsertRecord(
  store: PersistedRealJitoEvidenceFile,
  record: PersistedRealJitoBundleEvidenceRecord,
) {
  return {
    ...store,
    records: [
      record,
      ...store.records.filter(
        (currentRecord) => currentRecord.bundleId !== record.bundleId,
      ),
    ].slice(0, MAX_RECORDS),
  };
}

function migrateStatusCheckEvidence(
  check: RealJitoStatusCheckEvidence,
): RealJitoStatusCheckEvidence {
  const migratedStatus: BundleStatus =
    check.status === "failed" &&
    typeof check.landedSlot === "number" &&
    isJitoOkErr(check.error)
      ? "landed"
      : check.status;

  return {
    ...check,
    status: migratedStatus,
    landedSlot: normalizeLandedSlot(migratedStatus, check.landedSlot),
    confirmationLevel: check.confirmationLevel ?? check.confirmationStatus,
    failureClassification:
      migratedStatus === "landed"
        ? null
        : check.failureClassification ??
          classifyRealJitoFailure(migratedStatus, check.error),
    rawStatusPayload: check.rawStatusPayload ?? null,
  };
}

function migrateRecord(
  record: PersistedRealJitoBundleEvidenceRecord,
): PersistedRealJitoBundleEvidenceRecord {
  const migratedStatus: BundleStatus =
    record.latestStatus === "failed" &&
    typeof record.landedSlot === "number" &&
    isJitoOkErr(record.error)
      ? "landed"
      : record.latestStatus;
  const landedSlot = normalizeLandedSlot(migratedStatus, record.landedSlot);
  const confirmationLevel = record.confirmationLevel ?? record.confirmationStatus;
  const baseLifecycle =
    record.lifecycleEvents.length > 0
      ? record.lifecycleEvents
      : [
          createSubmittedLifecycleStage({
            ...record,
            initialStatus: "submitted-not-landed",
          }),
        ];
  const lifecycleEvents =
    migratedStatus === "landed"
      ? [
          ...baseLifecycle.filter(
            (stage) =>
              stage.stage !== "failed" &&
              stage.stage !== "invalid" &&
              stage.stage !== "expired",
          ),
          ...(baseLifecycle.some((stage) => stage.stage === "landed")
            ? []
            : [
                {
                  stage: "landed" as const,
                  at: record.checkedAt ?? record.submittedAt,
                  status: "landed" as const,
                  landedSlot,
                  confirmationStatus: record.confirmationStatus,
                  confirmationLevel: confirmationLevel ?? null,
                },
              ]),
        ]
      : baseLifecycle;

  return {
    ...record,
    latestStatus: migratedStatus,
    checkedAt: record.checkedAt,
    landedSlot,
    confirmationLevel: confirmationLevel ?? null,
    failureClassification:
      migratedStatus === "landed"
        ? null
        : record.failureClassification ??
          classifyRealJitoFailure(migratedStatus, record.error),
    rawStatusPayload: record.rawStatusPayload ?? null,
    lifecycleEvents: lifecycleEvents.slice(-MAX_LIFECYCLE_EVENTS),
    statusChecks: record.statusChecks
      .map(migrateStatusCheckEvidence)
      .slice(0, MAX_RECORD_STATUS_CHECKS),
  };
}

function toApiRecord(
  record: PersistedRealJitoBundleEvidenceRecord,
): RealJitoBundleEvidenceRecord {
  const migratedRecord = migrateRecord(record);

  return {
    bundleId: migratedRecord.bundleId,
    submittedAt: migratedRecord.submittedAt,
    network: migratedRecord.network,
    tipLamports: migratedRecord.tipLamports,
    transactionCount: migratedRecord.transactionCount,
    source: migratedRecord.source,
    initialStatus: "submitted-not-landed",
    latestStatus: migratedRecord.latestStatus,
    statusChecked: Boolean(migratedRecord.checkedAt),
    statusCheckedAt: migratedRecord.checkedAt,
    checkedAt: migratedRecord.checkedAt,
    landedSlot: migratedRecord.landedSlot,
    confirmationStatus: migratedRecord.confirmationStatus,
    confirmationLevel: migratedRecord.confirmationLevel,
    failureClassification: migratedRecord.failureClassification,
    error: migratedRecord.error,
    rawStatusPayload: migratedRecord.rawStatusPayload,
    statusChecks: migratedRecord.statusChecks,
    lifecycle: migratedRecord.lifecycleEvents,
    lifecycleEvents: migratedRecord.lifecycleEvents,
  };
}

export function recordRealJitoSubmission(bundle: BundleSubmissionResult) {
  const store = readEvidenceFile();
  const submission: RealJitoSubmissionEvidence = {
    bundleId: bundle.bundleId,
    submittedAt: bundle.submittedAt,
    network: getEvidenceNetwork(bundle),
    tipLamports: bundle.tipLamports,
    transactionCount: bundle.transactionCount ?? 0,
    source: getEvidenceSource(bundle),
    initialStatus: "submitted-not-landed",
  };
  const currentRecord = store.records.find(
    (record) => record.bundleId === submission.bundleId,
  );
  const nextRecord: PersistedRealJitoBundleEvidenceRecord = {
    ...submission,
    latestStatus: currentRecord?.latestStatus ?? "submitted-not-landed",
    checkedAt: currentRecord?.checkedAt ?? null,
    landedSlot: currentRecord?.landedSlot ?? null,
    confirmationStatus: currentRecord?.confirmationStatus ?? null,
    confirmationLevel: currentRecord?.confirmationLevel ?? null,
    failureClassification: currentRecord?.failureClassification ?? null,
    error: currentRecord?.error ?? null,
    rawStatusPayload: currentRecord?.rawStatusPayload ?? null,
    statusChecks: currentRecord?.statusChecks ?? [],
    lifecycleEvents:
      currentRecord?.lifecycleEvents && currentRecord.lifecycleEvents.length > 0
        ? currentRecord.lifecycleEvents
        : [createSubmittedLifecycleStage(submission)],
  };
  const nextStore = upsertRecord(store, nextRecord);

  writeEvidenceFile(nextStore);

  return toApiRecord(nextRecord);
}

export function recordRealJitoStatusChecks(
  checks: JitoBundleStatusCheck[],
): RealJitoStatusCheckEvidence[] {
  let store = readEvidenceFile();
  const evidenceChecks = checks.map<RealJitoStatusCheckEvidence>((check) => {
    const confirmationLevel =
      check.confirmationLevel ?? check.confirmationStatus ?? null;

    return {
      bundleId: check.bundleId,
      checkedAt: check.checkedAt,
      status: check.status,
      landedSlot: normalizeLandedSlot(check.status, check.landedSlot),
      confirmationStatus: check.confirmationStatus,
      confirmationLevel,
      failureClassification: classifyRealJitoFailure(check.status, check.error),
      error: check.error,
      rawStatusPayload: check.rawStatusPayload,
    };
  });

  store = {
    ...store,
    statusChecks: [...evidenceChecks, ...store.statusChecks].slice(
      0,
      MAX_STATUS_CHECKS,
    ),
  };

  for (const check of evidenceChecks) {
    const record =
      store.records.find(
        (currentRecord) => currentRecord.bundleId === check.bundleId,
      ) ??
      (check.status === "network-error"
        ? {
            bundleId: check.bundleId,
            network: "testnet" as const,
            source: "real-jito-testnet" as const,
            submittedAt: check.checkedAt,
            latestStatus: "submitted-not-landed" as const,
            checkedAt: null,
            landedSlot: null,
            confirmationStatus: null,
            confirmationLevel: null,
            rawStatusPayload: null,
            tipLamports: 0,
            transactionCount: 0,
            failureClassification: null,
            lifecycleEvents: [
              {
                stage: "submitted" as const,
                at: check.checkedAt,
                status: "submitted-not-landed" as const,
                landedSlot: null,
                confirmationStatus: null,
                confirmationLevel: null,
              },
            ],
            statusChecks: [],
            initialStatus: "submitted-not-landed" as const,
            error: null,
          }
        : null);

    if (!record) {
      continue;
    }

    const nextRecord: PersistedRealJitoBundleEvidenceRecord = migrateRecord({
      ...record,
      latestStatus: check.status,
      checkedAt: check.checkedAt,
      landedSlot: normalizeLandedSlot(check.status, check.landedSlot),
      confirmationStatus: check.confirmationStatus,
      confirmationLevel: check.confirmationLevel,
      failureClassification: classifyRealJitoFailure(check.status, check.error),
      error: check.error,
      rawStatusPayload: check.rawStatusPayload,
      statusChecks: [check, ...record.statusChecks].slice(
        0,
        MAX_RECORD_STATUS_CHECKS,
      ),
      lifecycleEvents: [
        ...(record.lifecycleEvents.length > 0
          ? record.lifecycleEvents
          : [
              createSubmittedLifecycleStage({
                ...record,
                initialStatus: "submitted-not-landed",
              }),
            ]),
        ...createStatusCheckLifecycleStages(check),
      ].slice(-MAX_LIFECYCLE_EVENTS),
    });

    store = upsertRecord(store, nextRecord);
  }

  writeEvidenceFile(store);

  return evidenceChecks;
}

export function removeRealJitoTestnetEvidence() {
  const store = readEvidenceFile();
  const nextRecords = store.records.filter(
    (record) => record.source !== "real-jito-testnet",
  );
  const removedBundleIds = new Set(
    store.records
      .filter((record) => record.source === "real-jito-testnet")
      .map((record) => record.bundleId),
  );
  const nextStore = {
    ...store,
    records: nextRecords,
    statusChecks: store.statusChecks.filter(
      (check) => !removedBundleIds.has(check.bundleId),
    ),
  };

  writeEvidenceFile(nextStore);

  return removedBundleIds.size;
}

export function getRealJitoEvidenceSnapshot(): RealJitoEvidenceSnapshot {
  const store = readEvidenceFile();
  const records = store.records.map((record) => toApiRecord(record));
  const statusChecks = store.statusChecks.map(migrateStatusCheckEvidence);
  const realRecords = records.filter((record) => isRealJitoSource(record.source));

  return {
    records,
    statusChecks,
    realSubmissionCount: realRecords.length,
    successfulSubmissionCount: realRecords.filter(
      (record) => record.latestStatus === "landed",
    ).length,
    failedSubmissionCount: realRecords.filter(
      (record) => record.latestStatus === "failed",
    ).length,
    expiredSubmissionCount: realRecords.filter(
      (record) => record.latestStatus === "expired",
    ).length,
    pendingSubmissionCount: realRecords.filter(
      (record) =>
        record.latestStatus === "pending" ||
        record.latestStatus === "submitted" ||
        record.latestStatus === "submitted-not-landed" ||
        record.latestStatus === "unknown",
    ).length,
    networkErrorSubmissionCount: realRecords.filter(
      (record) => record.latestStatus === "network-error",
    ).length,
    statusCheckCount: statusChecks.length,
    warning: JITO_BUNDLE_RECEIPT_WARNING,
  };
}
