import type {
  SubscribeRequest,
  SubscribeUpdate,
} from "@triton-one/yellowstone-grpc";
import type { ChannelOptions, ClientDuplexStream } from "@grpc/grpc-js";

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
const DEFAULT_CONNECTION_STEP_TIMEOUT_MS = 15_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const STREAM_EVENT_BUFFER_LIMIT = 256;
const STREAM_EVENT_FLUSH_BATCH_SIZE = 64;

// Triton Dragon's Mouth docs target Yellowstone gRPC at backend software, not
// browsers. This module is only reached from Node route handlers.
type YellowstoneModule = typeof import("@triton-one/yellowstone-grpc");
type YellowstoneDuplexStream = ClientDuplexStream<
  SubscribeRequest,
  SubscribeUpdate
>;
type YellowstoneClientInstance = InstanceType<YellowstoneModule["default"]> & {
  connect?: () => Promise<void>;
};

interface YellowstoneRuntime {
  client: InstanceType<YellowstoneModule["default"]> | null;
  stream: YellowstoneDuplexStream | null;
  eventQueue: Array<{
    stream: YellowstoneDuplexStream;
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
  return (
    process.env.SOLINFRA_GRPC_ENDPOINT?.trim() ||
    process.env.YELLOWSTONE_GRPC_ENDPOINT?.trim() ||
    ""
  );
}

function hasEndpointProtocol(endpoint: string) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(endpoint);
}

function normalizeYellowstoneEndpoint(endpoint: string) {
  if (!endpoint || hasEndpointProtocol(endpoint)) {
    return endpoint;
  }

  return `https://${endpoint}`;
}

function getEndpointDebugInfo(endpoint: string) {
  const normalizedEndpoint = normalizeYellowstoneEndpoint(endpoint);

  try {
    const url = new URL(normalizedEndpoint);
    const port =
      url.port || (url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : "");

    return {
      configuredProtocol: hasEndpointProtocol(endpoint) ? endpoint.split("://", 1)[0] : "none",
      normalizedProtocol: url.protocol.replace(":", ""),
      host: url.hostname,
      port,
      inputLength: endpoint.length,
    };
  } catch {
    return {
      configuredProtocol: hasEndpointProtocol(endpoint) ? endpoint.split("://", 1)[0] : "none",
      normalizedProtocol: "invalid",
      host: "invalid",
      port: "",
      inputLength: endpoint.length,
    };
  }
}

function logYellowstoneDebug(
  event: string,
  details: Record<string, unknown> = {},
) {
  console.info("[yellowstone-debug]", event, details);
}

function logYellowstoneError(
  event: string,
  details: Record<string, unknown> = {},
) {
  console.error("[yellowstone-debug]", event, details);
}

function getYellowstoneApiKey() {
  return (
    process.env.SOLINFRA_API_KEY?.trim() ||
    process.env.YELLOWSTONE_GRPC_TOKEN?.trim() ||
    ""
  );
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

function getConnectionStepTimeoutMs() {
  const rawTimeout = Number.parseInt(
    process.env.YELLOWSTONE_GRPC_CONNECT_TIMEOUT_MS ?? "",
    10,
  );

  if (Number.isFinite(rawTimeout) && rawTimeout >= 1_000) {
    return rawTimeout;
  }

  return DEFAULT_CONNECTION_STEP_TIMEOUT_MS;
}

function withYellowstoneTimeout<T>(promise: Promise<T>, label: string) {
  const timeoutMs = getConnectionStepTimeoutMs();

  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

function getYellowstoneConfigIssue() {
  const endpoint = getYellowstoneEndpoint();
  const apiKey = getYellowstoneApiKey();

  if (!endpoint && !apiKey) {
    // Missing Yellowstone config is reported as RPC fallback, not as a stream.
    return "SolInfra Yellowstone is not configured: missing SOLINFRA_GRPC_ENDPOINT/YELLOWSTONE_GRPC_ENDPOINT and SOLINFRA_API_KEY/YELLOWSTONE_GRPC_TOKEN. Using Solana devnet RPC fallback.";
  }

  if (!endpoint) {
    return "SolInfra Yellowstone is not configured: missing SOLINFRA_GRPC_ENDPOINT or YELLOWSTONE_GRPC_ENDPOINT. Using Solana devnet RPC fallback.";
  }

  if (!apiKey) {
    return "SolInfra Yellowstone is not configured: missing SOLINFRA_API_KEY or YELLOWSTONE_GRPC_TOKEN. Using Solana devnet RPC fallback.";
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
      solinfra_slots: {
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

function getSubscribeRequestDebugInfo(request: SubscribeRequest) {
  return {
    slotFilters: Object.keys(request.slots),
    accountFilters: Object.keys(request.accounts).length,
    transactionFilters: Object.keys(request.transactions).length,
    blockFilters: Object.keys(request.blocks).length,
    blockMetaFilters: Object.keys(request.blocksMeta).length,
    commitment: request.commitment,
    fromSlot: request.fromSlot ?? null,
  };
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
  stream: YellowstoneDuplexStream,
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

function handleStreamData(stream: YellowstoneDuplexStream, data: SubscribeUpdate) {
  if (data.slot) {
    const slot = parseSlot(data.slot.slot);
    const parentSlot = parseSlot(data.slot.parent);

    if (slot !== null) {
      recordYellowstoneSlotUpdate({
        slot,
        parentSlot,
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

function enqueueStreamData(stream: YellowstoneDuplexStream, data: SubscribeUpdate) {
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
  logYellowstoneError("stream failure", { reason });
  scheduleReconnect(reason);
}

function startPingLoop(stream: YellowstoneDuplexStream) {
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
    "grpc.keepalive_time_ms": getPingIntervalMs(),
    "grpc.keepalive_timeout_ms": 10_000,
    "grpc.keepalive_permit_without_calls": 1,
    "grpc.max_receive_message_length": 64 * 1024 * 1024,
    "grpc.max_send_message_length": 8 * 1024 * 1024,
  };
}

async function startYellowstoneStream(endpoint: string, apiKey: string) {
  const runtime = getRuntime();
  const normalizedEndpoint = normalizeYellowstoneEndpoint(endpoint);

  logYellowstoneDebug("connection attempt started", {
    endpoint: getEndpointDebugInfo(endpoint),
    tokenDetected: apiKey.length > 0,
    tokenLength: apiKey.length,
  });

  const yellowstone = await import("@triton-one/yellowstone-grpc");
  const YellowstoneClient = yellowstone.default;
  // The SDK maps this constructor argument to the Yellowstone gRPC x-token
  // metadata header, which carries the SolInfra API key server-side only.
  const client: YellowstoneClientInstance = new YellowstoneClient(
    normalizedEndpoint,
    apiKey.length > 0 ? apiKey : undefined,
    getChannelOptions(),
  );

  logYellowstoneDebug("client instantiated", {
    endpoint: getEndpointDebugInfo(endpoint),
    hasConnectMethod: typeof client.connect === "function",
  });

  if (typeof client.connect === "function") {
    await withYellowstoneTimeout(client.connect(), "Yellowstone connect");
    logYellowstoneDebug("connection success", { phase: "connect" });
  }

  const stream = await withYellowstoneTimeout(
    client.subscribe(),
    "Yellowstone subscribe",
  );
  const { processedSlot } = getYellowstoneSlotSnapshot();
  const subscribeRequest = createSlotSubscribeRequest(processedSlot);

  logYellowstoneDebug("subscription stream created", {
    request: getSubscribeRequestDebugInfo(subscribeRequest),
  });

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

  await withYellowstoneTimeout(
    writeStreamRequest(stream, subscribeRequest),
    "Yellowstone slot subscription write",
  );
  logYellowstoneDebug("slot subscription started", {
    request: getSubscribeRequestDebugInfo(subscribeRequest),
  });
  startPingLoop(stream);
  markYellowstoneConnected();
  logYellowstoneDebug("connection success", { phase: "subscribe" });
}

export function isYellowstoneConfigured() {
  return getYellowstoneConfigIssue() === null;
}

export async function ensureYellowstoneStream() {
  const runtime = getRuntime();
  const endpoint = getYellowstoneEndpoint();
  const apiKey = getYellowstoneApiKey();
  const configIssue = getYellowstoneConfigIssue();

  setYellowstoneCommitment(getYellowstoneCommitment());

  if (configIssue) {
    logYellowstoneDebug("configuration unavailable", {
      endpoint: getEndpointDebugInfo(endpoint),
      tokenDetected: apiKey.length > 0,
      reason: configIssue,
    });
    resetStream(runtime);
    markYellowstoneUnavailable(configIssue);
    return false;
  }

  if (runtime.starting || runtime.stream) {
    logYellowstoneDebug("startup skipped", {
      starting: runtime.starting,
      hasStream: Boolean(runtime.stream),
      streamConnected: getYellowstoneSlotSnapshot().streamConnected,
    });
    return getYellowstoneSlotSnapshot().streamConnected;
  }

  try {
    runtime.starting = true;
    clearReconnectTimer(runtime);
    markYellowstoneConnecting();
    await startYellowstoneStream(endpoint, apiKey);
    return true;
  } catch (error) {
    const reason = `Yellowstone connection failed: ${formatError(error)}`;

    logYellowstoneError("connection failure", {
      endpoint: getEndpointDebugInfo(endpoint),
      tokenDetected: apiKey.length > 0,
      reason,
    });
    markYellowstoneError(reason);
    scheduleReconnect(reason);
    return false;
  } finally {
    runtime.starting = false;
  }
}
