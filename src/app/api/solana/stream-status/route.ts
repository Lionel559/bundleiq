import { ensureYellowstoneStream } from "@/lib/grpc/yellowstone-client";
import {
  getYellowstoneSlotSnapshot,
  type YellowstoneStreamStatusResponse,
} from "@/lib/grpc/slot-store";
import { devnetConnection } from "@/lib/solana/connection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STREAM_SOURCE = "SolInfra Yellowstone" as const;
const WORKER_STREAM_SOURCE = "Render Yellowstone Worker" as const;
const ENDPOINT_REGION = "FRA" as const;
const DEFAULT_WORKER_TIMEOUT_MS = 2_500;

type WorkerStreamStatus = Record<string, unknown> & {
  streamConnected?: unknown;
  source?: unknown;
  endpointRegion?: unknown;
};

async function getRpcFallbackSlots() {
  const [processedSlot, confirmedSlot, finalizedSlot] = await Promise.all([
    devnetConnection.getSlot("processed"),
    devnetConnection.getSlot("confirmed"),
    devnetConnection.getSlot("finalized"),
  ]);

  return {
    currentSlot: processedSlot,
    processedSlot,
    confirmedSlot,
    finalizedSlot,
  };
}

function getYellowstoneWorkerUrl() {
  return process.env.YELLOWSTONE_WORKER_URL?.trim().replace(/\/+$/, "") ?? "";
}

function getWorkerTimeoutMs() {
  const rawTimeout = Number.parseInt(
    process.env.YELLOWSTONE_WORKER_TIMEOUT_MS ?? "",
    10,
  );

  if (Number.isFinite(rawTimeout) && rawTimeout >= 500) {
    return rawTimeout;
  }

  return DEFAULT_WORKER_TIMEOUT_MS;
}

function isRecord(value: unknown): value is WorkerStreamStatus {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function getWorkerStreamStatus() {
  const workerUrl = getYellowstoneWorkerUrl();

  if (!workerUrl) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, getWorkerTimeoutMs());

  try {
    const response = await fetch(`${workerUrl}/stream-status`, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Worker returned HTTP ${response.status}`);
    }

    const workerStatus: unknown = await response.json();

    if (!isRecord(workerStatus)) {
      throw new Error("Worker returned a non-object response.");
    }

    if (
      workerStatus.streamConnected === true ||
      workerStatus.source === "yellowstone"
    ) {
      return {
        ...workerStatus,
        source: "yellowstone",
        streamSource: WORKER_STREAM_SOURCE,
        endpointRegion: workerStatus.endpointRegion ?? ENDPOINT_REGION,
      };
    }
  } catch (error) {
    console.warn("[yellowstone-worker] stream-status fetch failed", {
      workerUrl,
      reason: formatError(error),
    });
  } finally {
    clearTimeout(timeout);
  }

  return null;
}

export async function GET() {
  const workerStatus = await getWorkerStreamStatus();

  if (workerStatus) {
    return Response.json(workerStatus);
  }

  await ensureYellowstoneStream();

  const streamSnapshot = getYellowstoneSlotSnapshot();
  const hasYellowstoneSlot =
    streamSnapshot.streamConnected && streamSnapshot.currentSlot !== null;

  if (hasYellowstoneSlot) {
    const response: YellowstoneStreamStatusResponse = {
      ...streamSnapshot,
      source: "yellowstone",
      streamSource: STREAM_SOURCE,
      endpointRegion: ENDPOINT_REGION,
      currentSlot: streamSnapshot.currentSlot!,
    };

    return Response.json(response);
  }

  const fallbackSlots = await getRpcFallbackSlots();
  const streamError =
    streamSnapshot.streamError ??
    (streamSnapshot.streamConnected
      ? "SolInfra Yellowstone stream is connected but has not emitted a slot yet; using Solana devnet RPC fallback."
      : "SolInfra Yellowstone stream is unavailable; using Solana devnet RPC fallback.");
  const response: YellowstoneStreamStatusResponse = {
    ...streamSnapshot,
    ...fallbackSlots,
    source: "rpc-fallback",
    streamSource: STREAM_SOURCE,
    endpointRegion: ENDPOINT_REGION,
    processedToConfirmedDeltaMs: null,
    confirmedToFinalizedDeltaMs: null,
    streamError,
  };

  return Response.json(response);
}
