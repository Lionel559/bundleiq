import {
  JitoConfigError,
  JitoDisabledError,
  JitoSubmissionError,
  checkJitoBundleStatuses,
} from "@/lib/jito/server-adapter";
import {
  getRealJitoEvidenceSnapshot,
  recordRealJitoStatusChecks,
} from "@/lib/jito/evidence-store";
import type { JitoBundleStatusCheck } from "@/types/jito";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BundleStatusErrorType =
  | "validation-error"
  | "network-error"
  | "jito-error";

class BundleStatusValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleStatusValidationError";
  }
}

function isProvided(value: unknown) {
  return value !== undefined && value !== null;
}

function isJitoNetworkError(error: unknown) {
  return (
    error instanceof JitoSubmissionError &&
    error.message.toLowerCase().includes("fetch failed")
  );
}

function getErrorType(error: unknown): BundleStatusErrorType {
  if (error instanceof BundleStatusValidationError) {
    return "validation-error";
  }

  if (
    error instanceof JitoConfigError ||
    error instanceof JitoDisabledError ||
    error instanceof JitoSubmissionError
  ) {
    return "jito-error";
  }

  return "network-error";
}

function getStatusCode(error: unknown) {
  const errorType = getErrorType(error);

  if (errorType === "validation-error" || errorType === "jito-error") {
    return 400;
  }

  return 502;
}

interface BundleStatusRequest {
  bundleIds: string[];
  markExpired: boolean;
  markUnknown: boolean;
  markNetworkError: boolean;
  pollAttempt: number | null;
  retryAttempts: number | null;
  networkErrorMessage: string | null;
}

const NETWORK_ERROR_RECOVERY_RECOMMENDATION =
  "Retry the bundle-status check after RPC/Jito connectivity recovers; keep the bundle submitted-not-landed until a separate status check returns landed.";

function parseBundleStatusRequest(body: unknown): BundleStatusRequest {
  if (!body || typeof body !== "object") {
    return {
      bundleIds: [],
      markExpired: false,
      markUnknown: false,
      markNetworkError: false,
      pollAttempt: null,
      retryAttempts: null,
      networkErrorMessage: null,
    };
  }

  const candidate = body as Record<string, unknown>;
  const markExpired = candidate.markExpired;
  const markUnknown = candidate.markUnknown;
  const markNetworkError = candidate.markNetworkError;
  const pollAttempt = candidate.pollAttempt;
  const retryAttempts = candidate.retryAttempts;
  const networkErrorMessage = candidate.networkErrorMessage;
  let bundleIds: string[];

  if (Array.isArray(candidate.bundleIds)) {
    if (!candidate.bundleIds.every((bundleId) => typeof bundleId === "string")) {
      throw new BundleStatusValidationError(
        "bundleIds must be an array of Jito bundle id strings.",
      );
    }

    bundleIds = candidate.bundleIds;
  } else if (
    isProvided(candidate.bundleIds) ||
    (isProvided(candidate.bundleId) && typeof candidate.bundleId !== "string")
  ) {
    throw new BundleStatusValidationError(
      "Provide bundleId as a string or bundleIds as a string array.",
    );
  } else {
    bundleIds = typeof candidate.bundleId === "string" ? [candidate.bundleId] : [];
  }

  if (isProvided(markExpired) && typeof markExpired !== "boolean") {
    throw new BundleStatusValidationError(
      "markExpired must be a boolean when provided.",
    );
  }

  if (isProvided(markUnknown) && typeof markUnknown !== "boolean") {
    throw new BundleStatusValidationError(
      "markUnknown must be a boolean when provided.",
    );
  }

  if (isProvided(markNetworkError) && typeof markNetworkError !== "boolean") {
    throw new BundleStatusValidationError(
      "markNetworkError must be a boolean when provided.",
    );
  }

  if (
    isProvided(networkErrorMessage) &&
    typeof networkErrorMessage !== "string"
  ) {
    throw new BundleStatusValidationError(
      "networkErrorMessage must be a string when provided.",
    );
  }

  if (
    isProvided(pollAttempt) &&
    (typeof pollAttempt !== "number" ||
      !Number.isInteger(pollAttempt) ||
      pollAttempt < 0)
  ) {
    throw new BundleStatusValidationError(
      "pollAttempt must be a non-negative integer.",
    );
  }

  if (
    isProvided(retryAttempts) &&
    (typeof retryAttempts !== "number" ||
      !Number.isInteger(retryAttempts) ||
      retryAttempts < 0)
  ) {
    throw new BundleStatusValidationError(
      "retryAttempts must be a non-negative integer.",
    );
  }

  return {
    bundleIds,
    markExpired: markExpired === true,
    markUnknown: markUnknown === true,
    markNetworkError: markNetworkError === true,
    pollAttempt: typeof pollAttempt === "number" ? pollAttempt : null,
    retryAttempts: typeof retryAttempts === "number" ? retryAttempts : null,
    networkErrorMessage:
      typeof networkErrorMessage === "string" ? networkErrorMessage : null,
  };
}

function createExpiredBundleStatuses(
  bundleIds: string[],
): JitoBundleStatusCheck[] {
  const checkedAt = new Date().toISOString();

  if (bundleIds.length === 0) {
    throw new JitoSubmissionError("Provide at least one Jito bundle id.");
  }

  return bundleIds.map((bundleId) => ({
    bundleId: bundleId.trim(),
    status: "expired",
    checkedAt,
    statusSource: "bundle-status",
    inflightStatus: null,
    confirmationStatus: null,
    confirmationLevel: null,
    landedSlot: null,
    error: "Polling expired after 12 status checks.",
    rawStatusPayload: {
      source: "bundleiq-local-polling-timeout",
      reason: "Polling expired after 12 status checks.",
      checkedAt,
    },
  }));
}

function createUnknownBundleStatuses(
  bundleIds: string[],
): JitoBundleStatusCheck[] {
  const checkedAt = new Date().toISOString();

  if (bundleIds.length === 0) {
    throw new JitoSubmissionError("Provide at least one Jito bundle id.");
  }

  return bundleIds.map((bundleId) => ({
    bundleId: bundleId.trim(),
    status: "unknown",
    checkedAt,
    statusSource: "bundle-status",
    inflightStatus: null,
    confirmationStatus: null,
    confirmationLevel: null,
    landedSlot: null,
    error: "Polling reached max attempts without landed, failed, or expired status.",
    rawStatusPayload: {
      source: "bundleiq-local-polling-max-attempts",
      reason: "Polling reached max attempts without terminal Jito status.",
      checkedAt,
    },
  }));
}

function createNetworkErrorBundleStatuses(
  bundleIds: string[],
  errorMessage: string | null,
  retryAttempts: number | null,
  pollAttempt: number | null,
): JitoBundleStatusCheck[] {
  const checkedAt = new Date().toISOString();
  const retryAttemptCount = retryAttempts ?? pollAttempt;

  if (bundleIds.length === 0) {
    throw new JitoSubmissionError("Provide at least one Jito bundle id.");
  }

  return bundleIds.map((bundleId) => ({
    bundleId: bundleId.trim(),
    status: "network-error",
    checkedAt,
    statusSource: "bundle-status",
    inflightStatus: null,
    confirmationStatus: null,
    confirmationLevel: null,
    landedSlot: null,
    error:
      errorMessage ??
      "Temporary RPC, Jito, or network failure after retry attempts.",
    rawStatusPayload: {
      source: "bundleiq-network-error",
      reason:
        errorMessage ??
        "Temporary RPC, Jito, or network failure after retry attempts.",
      errorType: "network-error",
      retryAttempts: retryAttemptCount,
      pollAttempt,
      recoveryRecommendation: NETWORK_ERROR_RECOVERY_RECOMMENDATION,
      checkedAt,
    },
  }));
}

function logJitoStatusPoll(
  statuses: JitoBundleStatusCheck[],
  pollAttempt: number | null,
) {
  if (pollAttempt === null) {
    return;
  }

  for (const status of statuses) {
    console.info("[BundleIQ] Jito status poll", {
      bundleId: status.bundleId,
      pollAttempt,
      rawStatusPayload: status.rawStatusPayload,
    });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const statusRequest = parseBundleStatusRequest(body);
    let statuses: JitoBundleStatusCheck[];

    if (statusRequest.markNetworkError) {
      statuses = createNetworkErrorBundleStatuses(
        statusRequest.bundleIds,
        statusRequest.networkErrorMessage,
        statusRequest.retryAttempts,
        statusRequest.pollAttempt,
      );
    } else if (statusRequest.markUnknown) {
      statuses = createUnknownBundleStatuses(statusRequest.bundleIds);
    } else if (statusRequest.markExpired) {
      statuses = createExpiredBundleStatuses(statusRequest.bundleIds);
    } else {
      try {
        statuses = await checkJitoBundleStatuses(statusRequest.bundleIds);
      } catch (error) {
        if (!isJitoNetworkError(error)) {
          throw error;
        }

        statuses = createNetworkErrorBundleStatuses(
          statusRequest.bundleIds,
          error instanceof Error
            ? error.message
            : "Temporary RPC, Jito, or network failure after retry attempts.",
          statusRequest.retryAttempts,
          statusRequest.pollAttempt,
        );
      }
    }

    logJitoStatusPoll(statuses, statusRequest.pollAttempt);

    const evidence = recordRealJitoStatusChecks(statuses);

    return Response.json({
      statuses,
      evidence,
      snapshot: getRealJitoEvidenceSnapshot(),
    });
  } catch (error) {
    const errorType = getErrorType(error);

    return Response.json(
      {
        errorType,
        error:
          error instanceof Error
            ? error.message
            : "Unable to check Jito bundle status.",
      },
      {
        status: getStatusCode(error),
      },
    );
  }
}

export async function GET() {
  return Response.json(getRealJitoEvidenceSnapshot());
}
