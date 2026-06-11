import type {
  ChannelOptions,
  ClientDuplexStream,
  SubscribeRequest,
  SubscribeUpdate,
} from "@triton-one/yellowstone-grpc";

import {
  getYellowstoneSlotSnapshot,
  markYellowstoneConnected,
  markYellowstoneConnecting,
  markYellowstoneDisconnected,
  markYellowstoneError,
  markYellowstoneReconnecting,
  markYellowstoneUnavailable,
  recordYellowstoneBackpressureDrop,
  recordYellowstonePong,
  recordYellowstoneSlotUpdate,
  setYellowstoneBackpressureQueueDepth,
  setYellowstoneCommitment,
  type YellowstoneCommitment,
} from "./slot-store";

const PROCESSED_COMMITMENT = 0;
const CONFIRMED_COMMITMENT = 1;
const FINALIZED_COMMITMENT = 2;
const SLOT_PROCESSED_STATUS = 0;
const SLOT_CONFIRMED_STATUS = 1;
const SLOT_FINALIZED_STATUS = 2;
const SLOT_DEAD_STATUS = 6;
const DEFAULT_PING_INTERVAL_MS = 30_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const STREAM_EVENT_BUFFER_LIMIT = 256;
const STREAM_EVENT_FLUSH_BATCH_SIZE = 64;

// Triton Dragon's Mouth docs target Yellowstone gRPC at backend software, not
// browsers. This module is only reached from Node route handlers.
type YellowstoneModule = typeof import("@triton-one/yellowstone-grpc");

interface YellowstoneRuntime {
  client: InstanceType<YellowstoneModule["default"]> | null;
  stream: ClientDuplexStream | null;
  eventQueue: Array<{
    stream: ClientDuplexStream;
    data: SubscribeUpdate;
  }>;
  queueFlushTimer: ReturnType<typeof setTimeout> | null;
  starting: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  pingTimer: ReturnType<typeof setInterval> | null;
  pingId: number;
}

declare global {
  var bundleIqYellowstoneRuntime: YellowstoneRuntime | undefined;
}

function getRuntime() {
  globalThis.bundleIqYellowstoneRuntime ??= {
    client: null,
    stream: null,
    eventQueue: [],
    queueFlushTimer: null,
    starting: false,
    reconnectTimer: null,
    pingTimer: null,
    pingId: 1,
  };

  return globalThis.bundleIqYellowstoneRuntime;
}

function getYellowstoneEndpoint() {
  return process.env.YELLOWSTONE_GRPC_ENDPOINT?.trim() ?? "";
}

function getYellowstoneToken() {
  return process.env.YELLOWSTONE_GRPC_TOKEN?.trim() ?? "";
}

function getYellowstoneCommitment(): YellowstoneCommitment {
  const commitment = process.env.YELLOWSTONE_COMMITMENT?.trim().toLowerCase();

  if (
    commitment === "processed" ||
    commitment === "confirmed" ||
    commitment === "finalized"
  ) {
    return commitment;
  }

  return "processed";
}

function getYellowstoneCommitmentLevel() {
  const commitment = getYellowstoneCommitment();

  if (commitment === "confirmed") {
    return CONFIRMED_COMMITMENT;
  }

  if (commitment === "finalized") {
    return FINALIZED_COMMITMENT;
  }

  return PROCESSED_COMMITMENT;
}

function getPingIntervalMs() {
  const rawInterval = Number.parseInt(
    process.env.YELLOWSTONE_GRPC_PING_INTERVAL_MS ?? "",
    10,
  );

  if (Number.isFinite(rawInterval) && rawInterval >= 10_000) {
    return rawInterval;
  }

  return DEFAULT_PING_INTERVAL_MS;
}

function isDevnetConfigured() {
  return (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet") === "devnet";
}

function isMainnetLikeEndpoint(endpoint: string) {
  return /mainnet|mainnet-beta/i.test(endpoint);
}

function getYellowstoneConfigIssue() {
  const endpoint = getYellowstoneEndpoint();
  const token = getYellowstoneToken();

  if (!isDevnetConfigured()) {
    return "Yellowstone is disabled because BundleIQ is configured for devnet only.";
  }

  if (!endpoint && !token) {
    // Missing Yellowstone config is reported as RPC fallback, not as a stream.
    return "Yellowstone is not configured: missing YELLOWSTONE_GRPC_ENDPOINT and YELLOWSTONE_GRPC_TOKEN. Using Solana devnet RPC fallback.";
  }

  if (!endpoint) {
    return "Yellowstone is not configured: missing YELLOWSTONE_GRPC_ENDPOINT. Using Solana devnet RPC fallback.";
  }

  if (!token) {
    return "Yellowstone is not configured: missing YELLOWSTONE_GRPC_TOKEN. Using Solana devnet RPC fallback.";
  }

  if (isMainnetLikeEndpoint(endpoint)) {
    return "Yellowstone endpoint appears to target mainnet; BundleIQ Yellowstone monitoring is devnet only.";
  }

  return null;
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function createSlotSubscribeRequest(fromSlot?: number | null): SubscribeRequest {
  const request: SubscribeRequest = {
    accounts: {},
    slots: {
      slots: {
        filterByCommitment: false,
        interslotUpdates: true,
      },
      incoming_slots: {
        filterByCommitment: false,
        interslotUpdates: true,
      },
    },
    transactions: {},
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    entry: {},
    accountsDataSlice: [],
    commitment: getYellowstoneCommitmentLevel(),
  };

  if (typeof fromSlot === "number" && Number.isFinite(fromSlot) && fromSlot > 0) {
    request.fromSlot = String(fromSlot);
  }

  return request;
}

function createPingRequest(): SubscribeRequest {
  const runtime = getRuntime();
  const pingId = runtime.pingId;

  runtime.pingId += 1;

  return {
    accounts: {},
    slots: {},
    transactions: {},
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    entry: {},
    accountsDataSlice: [],
    ping: { id: pingId },
  };
}

function writeStreamRequest(
  stream: ClientDuplexStream,
  request: SubscribeRequest,
) {
  return new Promise<void>((resolve, reject) => {
    stream.write(request, (error?: Error | null) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function parseSlot(slot: string | number | undefined) {
  if (slot === undefined) {
    return null;
  }

  const parsedSlot = Number.parseInt(String(slot), 10);

  return Number.isFinite(parsedSlot) ? parsedSlot : null;
}

function getSlotCommitmentStage(
  status: number,
): "processed" | "confirmed" | "finalized" | null {
  if (status === SLOT_PROCESSED_STATUS) {
    return "processed";
  }

  if (status === SLOT_CONFIRMED_STATUS) {
    return "confirmed";
  }

  if (status === SLOT_FINALIZED_STATUS) {
    return "finalized";
  }

  return null;
}

function handleStreamData(stream: ClientDuplexStream, data: SubscribeUpdate) {
  if (data.slot) {
    const slot = parseSlot(data.slot.slot);

    if (slot !== null) {
      recordYellowstoneSlotUpdate({
        slot,
        commitmentStage: getSlotCommitmentStage(data.slot.status),
        isSkipped: data.slot.status === SLOT_DEAD_STATUS,
      });
    }
  }

  if (data.pong) {
    recordYellowstonePong();
  }

  if (data.ping) {
    void writeStreamRequest(stream, createPingRequest()).catch((error) => {
      handleStreamFailure(`Yellowstone ping response failed: ${formatError(error)}`);
    });
  }
}

function scheduleQueueFlush() {
  const runtime = getRuntime();

  if (runtime.queueFlushTimer) {
    return;
  }

  runtime.queueFlushTimer = setTimeout(() => {
    runtime.queueFlushTimer = null;
    flushQueuedStreamEvents();
  }, 0);
}

function enqueueStreamData(stream: ClientDuplexStream, data: SubscribeUpdate) {
  const runtime = getRuntime();

  runtime.eventQueue.push({ stream, data });

  if (runtime.eventQueue.length > STREAM_EVENT_BUFFER_LIMIT) {
    runtime.eventQueue.shift();
    recordYellowstoneBackpressureDrop(runtime.eventQueue.length);
  } else {
    setYellowstoneBackpressureQueueDepth(runtime.eventQueue.length);
  }

  scheduleQueueFlush();
}

function flushQueuedStreamEvents() {
  const runtime = getRuntime();
  let processed = 0;

  while (
    runtime.eventQueue.length > 0 &&
    processed < STREAM_EVENT_FLUSH_BATCH_SIZE
  ) {
    const event = runtime.eventQueue.shift();

    if (event && event.stream === runtime.stream) {
      handleStreamData(event.stream, event.data);
    }

    processed += 1;
  }

  setYellowstoneBackpressureQueueDepth(runtime.eventQueue.length);

  if (runtime.eventQueue.length > 0) {
    scheduleQueueFlush();
  }
}

function clearReconnectTimer(runtime: YellowstoneRuntime) {
  if (runtime.reconnectTimer) {
    clearTimeout(runtime.reconnectTimer);
    runtime.reconnectTimer = null;
  }
}

function clearPingTimer(runtime: YellowstoneRuntime) {
  if (runtime.pingTimer) {
    clearInterval(runtime.pingTimer);
    runtime.pingTimer = null;
  }
}

function resetStream(runtime: YellowstoneRuntime) {
  clearPingTimer(runtime);

  if (runtime.stream) {
    markYellowstoneDisconnected("Yellowstone stream disconnected.");
    runtime.stream.removeAllListeners();
    runtime.stream.destroy();
    runtime.stream = null;
  }

  if (runtime.queueFlushTimer) {
    clearTimeout(runtime.queueFlushTimer);
    runtime.queueFlushTimer = null;
  }

  runtime.eventQueue = [];
  setYellowstoneBackpressureQueueDepth(0);
  runtime.client = null;
}

function scheduleReconnect(reason: string) {
  const runtime = getRuntime();
  const configIssue = getYellowstoneConfigIssue();

  if (configIssue) {
    resetStream(runtime);
    markYellowstoneUnavailable(configIssue);
    return;
  }

  resetStream(runtime);
  markYellowstoneReconnecting(reason);

  if (runtime.reconnectTimer) {
    return;
  }

  const { reconnectAttempts } = getYellowstoneSlotSnapshot();
  const reconnectDelay = Math.min(
    MAX_RECONNECT_DELAY_MS,
    1_000 * 2 ** Math.min(reconnectAttempts, 5),
  );

  runtime.reconnectTimer = setTimeout(() => {
    runtime.reconnectTimer = null;
    void ensureYellowstoneStream();
  }, reconnectDelay);
}

function handleStreamFailure(reason: string) {
  scheduleReconnect(reason);
}

function startPingLoop(stream: ClientDuplexStream) {
  const runtime = getRuntime();

  clearPingTimer(runtime);
  runtime.pingTimer = setInterval(() => {
    void writeStreamRequest(stream, createPingRequest()).catch((error) => {
      handleStreamFailure(`Yellowstone keepalive failed: ${formatError(error)}`);
    });
  }, getPingIntervalMs());
}

function getChannelOptions(): ChannelOptions {
  return {
    grpcConnectTimeout: 15_000,
    grpcTimeout: 15_000,
    grpcHttp2KeepAliveInterval: getPingIntervalMs(),
    grpcKeepAliveTimeout: 10_000,
    grpcKeepAliveWhileIdle: true,
    grpcTcpNodelay: true,
    grpcMaxDecodingMessageSize: 64 * 1024 * 1024,
    grpcMaxEncodingMessageSize: 8 * 1024 * 1024,
  };
}

async function startYellowstoneStream(endpoint: string, token: string) {
  const runtime = getRuntime();
  const yellowstone = await import("@triton-one/yellowstone-grpc");
  const YellowstoneClient = yellowstone.default;
  const client = new YellowstoneClient(
    endpoint,
    token.length > 0 ? token : undefined,
    getChannelOptions(),
  );

  await client.connect();

  const stream = await client.subscribe();
  const { processedSlot } = getYellowstoneSlotSnapshot();

  runtime.client = client;
  runtime.stream = stream;

  stream.on("data", (data: SubscribeUpdate) => enqueueStreamData(stream, data));
  stream.on("error", (error: Error) => {
    handleStreamFailure(`Yellowstone stream error: ${formatError(error)}`);
  });
  stream.on("end", () => {
    handleStreamFailure("Yellowstone stream ended.");
  });
  stream.on("close", () => {
    handleStreamFailure("Yellowstone stream closed.");
  });

  await writeStreamRequest(stream, createSlotSubscribeRequest(processedSlot));
  startPingLoop(stream);
  markYellowstoneConnected();
}

export function isYellowstoneConfigured() {
  return getYellowstoneConfigIssue() === null;
}

export async function ensureYellowstoneStream() {
  const runtime = getRuntime();
  const endpoint = getYellowstoneEndpoint();
  const token = getYellowstoneToken();
  const configIssue = getYellowstoneConfigIssue();

  setYellowstoneCommitment(getYellowstoneCommitment());

  if (configIssue) {
    resetStream(runtime);
    markYellowstoneUnavailable(configIssue);
    return false;
  }

  if (runtime.starting || runtime.stream) {
    return getYellowstoneSlotSnapshot().streamConnected;
  }

  try {
    runtime.starting = true;
    clearReconnectTimer(runtime);
    markYellowstoneConnecting();
    await startYellowstoneStream(endpoint, token);
    return true;
  } catch (error) {
    markYellowstoneError(`Yellowstone connection failed: ${formatError(error)}`);
    scheduleReconnect(`Yellowstone connection failed: ${formatError(error)}`);
    return false;
  } finally {
    runtime.starting = false;
  }
}
