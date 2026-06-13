import type { ChannelOptions, ClientDuplexStream } from "@grpc/grpc-js";
import type {
  SubscribeRequest,
  SubscribeUpdate,
} from "@triton-one/yellowstone-grpc";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";

const PROCESSED_COMMITMENT = 0 as const;
const CONFIRMED_COMMITMENT = 1 as const;
const FINALIZED_COMMITMENT = 2 as const;
const SLOT_PROCESSED_STATUS = 0;
const SLOT_CONFIRMED_STATUS = 1;
const SLOT_FINALIZED_STATUS = 2;
const SLOT_DEAD_STATUS = 6;
const DEFAULT_PORT = 3001;
const DEFAULT_PING_INTERVAL_MS = 30_000;
const DEFAULT_CONNECTION_STEP_TIMEOUT_MS = 15_000;
const DEFAULT_STALE_STREAM_TIMEOUT_MS = 90_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const STREAM_EVENT_BUFFER_LIMIT = 256;
const STREAM_EVENT_FLUSH_BATCH_SIZE = 64;

type YellowstoneModule = typeof import("@triton-one/yellowstone-grpc");
type YellowstoneDuplexStream = ClientDuplexStream<
  SubscribeRequest,
  SubscribeUpdate
>;
type YellowstoneClientInstance = InstanceType<YellowstoneModule["default"]> & {
  connect?: () => Promise<void>;
};

type YellowstoneCommitment = "processed" | "confirmed" | "finalized";
type YellowstoneStreamStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "unavailable"
  | "error";
type SlotCommitmentStage = YellowstoneCommitment | null;

interface StreamState {
  currentSlot: number | null;
  processedSlot: number | null;
  confirmedSlot: number | null;
  finalizedSlot: number | null;
  parentSlot: number | null;
  lastStreamUpdate: string | null;
  streamConnected: boolean;
  streamStatus: YellowstoneStreamStatus;
  reconnectAttempts: number;
  endpointRegion: string;
  commitment: YellowstoneCommitment;
  latestStreamedSlot: number | null;
  firstSeenAt: string | null;
  lastPongAt: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  streamError: string | null;
  skippedSlots: number;
  backpressureQueueDepth: number;
  backpressureDroppedUpdates: number;
  lastBackpressureDropAt: string | null;
}

interface YellowstoneRuntime {
  client: YellowstoneClientInstance | null;
  stream: YellowstoneDuplexStream | null;
  eventQueue: Array<{
    stream: YellowstoneDuplexStream;
    data: SubscribeUpdate;
  }>;
  queueFlushTimer: ReturnType<typeof setTimeout> | null;
  starting: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  pingTimer: ReturnType<typeof setInterval> | null;
  watchdogTimer: ReturnType<typeof setInterval> | null;
  pingId: number;
}

const requireYellowstonePackage = createRequire(
  path.join(__dirname, "..", "package.json"),
);
const startedAt = new Date().toISOString();
const skippedSlotIds = new Set<number>();

const state: StreamState = {
  currentSlot: null,
  processedSlot: null,
  confirmedSlot: null,
  finalizedSlot: null,
  parentSlot: null,
  lastStreamUpdate: null,
  streamConnected: false,
  streamStatus: "idle",
  reconnectAttempts: 0,
  endpointRegion: getEndpointRegion(),
  commitment: getYellowstoneCommitment(),
  latestStreamedSlot: null,
  firstSeenAt: null,
  lastPongAt: null,
  lastConnectedAt: null,
  lastDisconnectedAt: null,
  streamError: null,
  skippedSlots: 0,
  backpressureQueueDepth: 0,
  backpressureDroppedUpdates: 0,
  lastBackpressureDropAt: null,
};

const runtime: YellowstoneRuntime = {
  client: null,
  stream: null,
  eventQueue: [],
  queueFlushTimer: null,
  starting: false,
  reconnectTimer: null,
  pingTimer: null,
  watchdogTimer: null,
  pingId: 1,
};

function getYellowstoneEndpoint() {
  return (
    process.env.SOLINFRA_GRPC_ENDPOINT?.trim() ||
    process.env.YELLOWSTONE_GRPC_ENDPOINT?.trim() ||
    ""
  );
}

function getYellowstoneApiKey() {
  return (
    process.env.SOLINFRA_API_KEY?.trim() ||
    process.env.YELLOWSTONE_GRPC_TOKEN?.trim() ||
    ""
  );
}

function getEndpointRegion() {
  return process.env.SOLINFRA_ENDPOINT_REGION?.trim() || "FRA";
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
      url.port ||
      (url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : "");

    return {
      configuredProtocol: hasEndpointProtocol(endpoint)
        ? endpoint.split("://", 1)[0]
        : "none",
      normalizedProtocol: url.protocol.replace(":", ""),
      host: url.hostname,
      port,
      inputLength: endpoint.length,
    };
  } catch {
    return {
      configuredProtocol: hasEndpointProtocol(endpoint)
        ? endpoint.split("://", 1)[0]
        : "none",
      normalizedProtocol: "invalid",
      host: "invalid",
      port: "",
      inputLength: endpoint.length,
    };
  }
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

function getYellowstoneCommitmentLevel(): SubscribeRequest["commitment"] {
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

function getStaleStreamTimeoutMs() {
  const rawTimeout = Number.parseInt(
    process.env.YELLOWSTONE_GRPC_STALE_TIMEOUT_MS ?? "",
    10,
  );

  if (Number.isFinite(rawTimeout) && rawTimeout >= 30_000) {
    return rawTimeout;
  }

  return Math.max(DEFAULT_STALE_STREAM_TIMEOUT_MS, getPingIntervalMs() * 3);
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
    return "SolInfra Yellowstone is not configured: missing SOLINFRA_GRPC_ENDPOINT and SOLINFRA_API_KEY.";
  }

  if (!endpoint) {
    return "SolInfra Yellowstone is not configured: missing SOLINFRA_GRPC_ENDPOINT.";
  }

  if (!apiKey) {
    return "SolInfra Yellowstone is not configured: missing SOLINFRA_API_KEY.";
  }

  return null;
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function logInfo(event: string, details: Record<string, unknown> = {}) {
  console.info("[yellowstone-worker]", event, details);
}

function logError(event: string, details: Record<string, unknown> = {}) {
  console.error("[yellowstone-worker]", event, details);
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

function getSlotCommitmentStage(status: number): SlotCommitmentStage {
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

function recordPong() {
  state.lastPongAt = new Date().toISOString();
}

function recordSlotUpdate({
  slot,
  parentSlot,
  commitmentStage,
  isSkipped,
}: {
  slot: number;
  parentSlot?: number | null;
  commitmentStage: SlotCommitmentStage;
  isSkipped?: boolean;
}) {
  const observedAtIso = new Date().toISOString();
  const isNewCurrentSlot = state.currentSlot === null || slot > state.currentSlot;

  if (isNewCurrentSlot) {
    state.currentSlot = slot;
    state.parentSlot = parentSlot ?? null;
    state.firstSeenAt ??= observedAtIso;
  } else if (slot === state.currentSlot && parentSlot !== undefined) {
    state.parentSlot = parentSlot;
  }

  state.latestStreamedSlot = Math.max(state.latestStreamedSlot ?? 0, slot);
  state.lastStreamUpdate = observedAtIso;
  state.streamConnected = true;
  state.streamStatus = "connected";
  state.streamError = null;

  if (commitmentStage === "processed") {
    state.processedSlot = Math.max(state.processedSlot ?? 0, slot);
  }

  if (commitmentStage === "confirmed") {
    state.confirmedSlot = Math.max(state.confirmedSlot ?? 0, slot);
  }

  if (commitmentStage === "finalized") {
    state.finalizedSlot = Math.max(state.finalizedSlot ?? 0, slot);
  }

  if (isSkipped) {
    skippedSlotIds.add(slot);
    state.skippedSlots = skippedSlotIds.size;
  }
}

function handleStreamData(stream: YellowstoneDuplexStream, data: SubscribeUpdate) {
  if (data.slot) {
    const slot = parseSlot(data.slot.slot);
    const parentSlot = parseSlot(data.slot.parent);

    if (slot !== null) {
      recordSlotUpdate({
        slot,
        parentSlot,
        commitmentStage: getSlotCommitmentStage(data.slot.status),
        isSkipped: data.slot.status === SLOT_DEAD_STATUS,
      });
    }
  }

  if (data.pong) {
    recordPong();
  }

  if (data.ping) {
    void writeStreamRequest(stream, createPingRequest()).catch((error) => {
      handleStreamFailure(`Yellowstone ping response failed: ${formatError(error)}`);
    });
  }
}

function setBackpressureQueueDepth(depth: number) {
  state.backpressureQueueDepth = Math.max(0, depth);
}

function recordBackpressureDrop(depth: number) {
  state.backpressureDroppedUpdates += 1;
  state.backpressureQueueDepth = Math.max(0, depth);
  state.lastBackpressureDropAt = new Date().toISOString();
}

function scheduleQueueFlush() {
  if (runtime.queueFlushTimer) {
    return;
  }

  runtime.queueFlushTimer = setTimeout(() => {
    runtime.queueFlushTimer = null;
    flushQueuedStreamEvents();
  }, 0);
}

function enqueueStreamData(stream: YellowstoneDuplexStream, data: SubscribeUpdate) {
  runtime.eventQueue.push({ stream, data });

  if (runtime.eventQueue.length > STREAM_EVENT_BUFFER_LIMIT) {
    runtime.eventQueue.shift();
    recordBackpressureDrop(runtime.eventQueue.length);
  } else {
    setBackpressureQueueDepth(runtime.eventQueue.length);
  }

  scheduleQueueFlush();
}

function flushQueuedStreamEvents() {
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

  setBackpressureQueueDepth(runtime.eventQueue.length);

  if (runtime.eventQueue.length > 0) {
    scheduleQueueFlush();
  }
}

function clearReconnectTimer() {
  if (runtime.reconnectTimer) {
    clearTimeout(runtime.reconnectTimer);
    runtime.reconnectTimer = null;
  }
}

function clearPingTimer() {
  if (runtime.pingTimer) {
    clearInterval(runtime.pingTimer);
    runtime.pingTimer = null;
  }
}

function resetStream(error: string, status: YellowstoneStreamStatus) {
  clearPingTimer();

  if (runtime.stream) {
    runtime.stream.removeAllListeners();
    runtime.stream.destroy();
    runtime.stream = null;
  }

  if (runtime.queueFlushTimer) {
    clearTimeout(runtime.queueFlushTimer);
    runtime.queueFlushTimer = null;
  }

  runtime.eventQueue = [];
  runtime.client = null;
  setBackpressureQueueDepth(0);

  state.streamConnected = false;
  state.streamStatus = status;
  state.lastDisconnectedAt = new Date().toISOString();
  state.streamError = error;
}

function scheduleReconnect(reason: string) {
  if (runtime.reconnectTimer) {
    return;
  }

  const configIssue = getYellowstoneConfigIssue();

  if (configIssue) {
    resetStream(configIssue, "unavailable");
    return;
  }

  resetStream(reason, "reconnecting");
  state.reconnectAttempts += 1;

  const reconnectDelay = Math.min(
    MAX_RECONNECT_DELAY_MS,
    1_000 * 2 ** Math.min(state.reconnectAttempts, 5),
  );

  logInfo("reconnect scheduled", { reason, reconnectDelay });

  runtime.reconnectTimer = setTimeout(() => {
    runtime.reconnectTimer = null;
    void ensureYellowstoneStream();
  }, reconnectDelay);
}

function handleStreamFailure(reason: string) {
  logError("stream failure", { reason });
  scheduleReconnect(reason);
}

function startPingLoop(stream: YellowstoneDuplexStream) {
  clearPingTimer();
  runtime.pingTimer = setInterval(() => {
    void writeStreamRequest(stream, createPingRequest()).catch((error) => {
      handleStreamFailure(`Yellowstone keepalive failed: ${formatError(error)}`);
    });
  }, getPingIntervalMs());
}

function startWatchdog() {
  if (runtime.watchdogTimer) {
    return;
  }

  runtime.watchdogTimer = setInterval(() => {
    if (runtime.starting || runtime.reconnectTimer) {
      return;
    }

    if (!runtime.stream) {
      void ensureYellowstoneStream();
      return;
    }

    const lastActivity = state.lastStreamUpdate ?? state.lastPongAt ?? state.lastConnectedAt;

    if (!lastActivity) {
      return;
    }

    const inactiveForMs = Date.now() - new Date(lastActivity).getTime();

    if (inactiveForMs > getStaleStreamTimeoutMs()) {
      handleStreamFailure(
        `Yellowstone stream stale for ${inactiveForMs}ms without slot or pong updates.`,
      );
    }
  }, Math.max(15_000, getPingIntervalMs()));
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

async function loadYellowstoneModule(): Promise<YellowstoneModule> {
  return requireYellowstonePackage(
    "@triton-one/yellowstone-grpc",
  ) as YellowstoneModule;
}

async function startYellowstoneStream(endpoint: string, apiKey: string) {
  const normalizedEndpoint = normalizeYellowstoneEndpoint(endpoint);

  logInfo("connection attempt started", {
    endpoint: getEndpointDebugInfo(endpoint),
    endpointRegion: state.endpointRegion,
    tokenDetected: apiKey.length > 0,
  });

  const yellowstone = await loadYellowstoneModule();
  const YellowstoneClient = yellowstone.default;
  const client = new YellowstoneClient(
    normalizedEndpoint,
    apiKey.length > 0 ? apiKey : undefined,
    getChannelOptions(),
  ) as YellowstoneClientInstance;

  if (typeof client.connect === "function") {
    await withYellowstoneTimeout(client.connect(), "Yellowstone connect");
  }

  const stream = await withYellowstoneTimeout(
    client.subscribe(),
    "Yellowstone subscribe",
  );
  const subscribeRequest = createSlotSubscribeRequest(state.processedSlot);

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

  state.streamConnected = true;
  state.streamStatus = "connected";
  state.streamError = null;
  state.lastConnectedAt = new Date().toISOString();
  startPingLoop(stream);

  logInfo("slot subscription started", {
    request: getSubscribeRequestDebugInfo(subscribeRequest),
  });
}

async function ensureYellowstoneStream() {
  const endpoint = getYellowstoneEndpoint();
  const apiKey = getYellowstoneApiKey();
  const configIssue = getYellowstoneConfigIssue();

  state.commitment = getYellowstoneCommitment();
  state.endpointRegion = getEndpointRegion();

  if (configIssue) {
    resetStream(configIssue, "unavailable");
    logError("configuration unavailable", {
      endpoint: getEndpointDebugInfo(endpoint),
      tokenDetected: apiKey.length > 0,
      reason: configIssue,
    });
    return false;
  }

  if (runtime.starting || runtime.stream) {
    return state.streamConnected;
  }

  try {
    runtime.starting = true;
    clearReconnectTimer();
    state.streamConnected = false;
    state.streamStatus = "connecting";
    state.streamError = null;
    await startYellowstoneStream(endpoint, apiKey);
    return true;
  } catch (error) {
    const reason = `Yellowstone connection failed: ${formatError(error)}`;

    state.streamConnected = false;
    state.streamStatus = "error";
    state.lastDisconnectedAt = new Date().toISOString();
    state.streamError = reason;
    logError("connection failure", {
      endpoint: getEndpointDebugInfo(endpoint),
      tokenDetected: apiKey.length > 0,
      reason,
    });
    scheduleReconnect(reason);
    return false;
  } finally {
    runtime.starting = false;
  }
}

function parseAllowedOrigins() {
  const rawOrigins =
    process.env.CORS_ORIGIN?.trim() ||
    process.env.DASHBOARD_ORIGIN?.trim() ||
    process.env.VERCEL_DASHBOARD_ORIGIN?.trim() ||
    "*";

  return rawOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function getCorsOrigin(requestOrigin: string | undefined) {
  const allowedOrigins = parseAllowedOrigins();

  if (allowedOrigins.includes("*")) {
    return "*";
  }

  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  return allowedOrigins[0] ?? "*";
}

function getCorsHeaders(req: IncomingMessage) {
  return {
    "Access-Control-Allow-Origin": getCorsOrigin(req.headers.origin),
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function sendJson(
  req: IncomingMessage,
  res: ServerResponse,
  statusCode: number,
  body: unknown,
) {
  const payload = JSON.stringify(body);

  res.writeHead(statusCode, {
    ...getCorsHeaders(req),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function getPublicStreamStatus() {
  return {
    currentSlot: state.currentSlot,
    processedSlot: state.processedSlot,
    confirmedSlot: state.confirmedSlot,
    finalizedSlot: state.finalizedSlot,
    parentSlot: state.parentSlot,
    lastStreamUpdate: state.lastStreamUpdate,
    streamConnected: state.streamConnected,
    streamStatus: state.streamStatus,
    reconnectAttempts: state.reconnectAttempts,
    endpointRegion: state.endpointRegion,
    commitment: state.commitment,
    latestStreamedSlot: state.latestStreamedSlot,
    firstSeenAt: state.firstSeenAt,
    lastPongAt: state.lastPongAt,
    lastConnectedAt: state.lastConnectedAt,
    lastDisconnectedAt: state.lastDisconnectedAt,
    streamError: state.streamError,
    skippedSlots: state.skippedSlots,
    backpressureQueueDepth: state.backpressureQueueDepth,
    backpressureDroppedUpdates: state.backpressureDroppedUpdates,
    lastBackpressureDropAt: state.lastBackpressureDropAt,
  };
}

function getWorkerHealth() {
  return {
    ok: state.streamStatus === "connected",
    service: "bundleiq-yellowstone-worker",
    startedAt,
    uptimeSeconds: Math.floor(process.uptime()),
    yellowstoneConfigured: getYellowstoneConfigIssue() === null,
    streamConnected: state.streamConnected,
    streamStatus: state.streamStatus,
    currentSlot: state.currentSlot,
    lastStreamUpdate: state.lastStreamUpdate,
    reconnectAttempts: state.reconnectAttempts,
    endpointRegion: state.endpointRegion,
  };
}

function handleRequest(req: IncomingMessage, res: ServerResponse) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, getCorsHeaders(req));
    res.end();
    return;
  }

  if (req.method !== "GET") {
    sendJson(req, res, 405, { error: "Method not allowed" });
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/") {
    sendJson(req, res, 200, getWorkerHealth());
    return;
  }

  if (url.pathname === "/stream-status") {
    sendJson(req, res, 200, getPublicStreamStatus());
    return;
  }

  if (url.pathname === "/favicon.ico") {
    res.writeHead(204, getCorsHeaders(req));
    res.end();
    return;
  }

  sendJson(req, res, 404, { error: "Not found" });
}

function getPort() {
  const rawPort = Number.parseInt(process.env.PORT ?? "", 10);

  if (Number.isFinite(rawPort) && rawPort > 0) {
    return rawPort;
  }

  return DEFAULT_PORT;
}

const server = createServer(handleRequest);

function shutdown(signal: NodeJS.Signals) {
  logInfo("shutdown requested", { signal });
  clearReconnectTimer();
  clearPingTimer();

  if (runtime.watchdogTimer) {
    clearInterval(runtime.watchdogTimer);
    runtime.watchdogTimer = null;
  }

  if (runtime.stream) {
    runtime.stream.removeAllListeners();
    runtime.stream.destroy();
    runtime.stream = null;
  }

  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("uncaughtException", (error) => {
  logError("uncaught exception", { reason: formatError(error) });
  scheduleReconnect(`Uncaught exception: ${formatError(error)}`);
});
process.on("unhandledRejection", (error) => {
  logError("unhandled rejection", { reason: formatError(error) });
  scheduleReconnect(`Unhandled rejection: ${formatError(error)}`);
});

server.listen(getPort(), () => {
  logInfo("http server started", {
    port: getPort(),
    endpointRegion: state.endpointRegion,
  });
  startWatchdog();
  void ensureYellowstoneStream();
});
