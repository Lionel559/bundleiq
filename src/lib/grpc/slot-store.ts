import {
  calculateConfirmedToFinalizedDelta,
  calculateProcessedToConfirmedDelta,
  promoteSlotCommitment,
  type CommitmentBuffer,
  type SlotCommitmentStage,
} from "./commitment-buffer";

export type YellowstoneCommitment = "processed" | "confirmed" | "finalized";

export type YellowstoneStreamStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "unavailable"
  | "error";

export interface YellowstoneSlotSnapshot {
  currentSlot: number | null;
  processedSlot: number | null;
  confirmedSlot: number | null;
  finalizedSlot: number | null;
  skippedSlots: number;
  processedToConfirmedDeltaMs: number | null;
  confirmedToFinalizedDeltaMs: number | null;
  streamConnected: boolean;
  streamStatus: YellowstoneStreamStatus;
  commitment: YellowstoneCommitment;
  lastStreamUpdate: string | null;
  lastPongAt: string | null;
  lastDisconnectedAt: string | null;
  reconnectAttempts: number;
  streamError: string | null;
  backpressureQueueDepth: number;
  backpressureDroppedUpdates: number;
  lastBackpressureDropAt: string | null;
}

export interface YellowstoneStreamStatusResponse
  extends Omit<YellowstoneSlotSnapshot, "currentSlot"> {
  source: "yellowstone" | "rpc-fallback";
  currentSlot: number;
}

interface SlotStoreState extends YellowstoneSlotSnapshot {
  commitmentBuffer: CommitmentBuffer;
  skippedSlotIds: Record<string, true>;
}

declare global {
  var bundleIqYellowstoneSlotStore: SlotStoreState | undefined;
}

function createInitialState(): SlotStoreState {
  return {
    currentSlot: null,
    processedSlot: null,
    confirmedSlot: null,
    finalizedSlot: null,
    skippedSlots: 0,
    processedToConfirmedDeltaMs: null,
    confirmedToFinalizedDeltaMs: null,
    streamConnected: false,
    streamStatus: "idle",
    commitment: "processed",
    lastStreamUpdate: null,
    lastPongAt: null,
    lastDisconnectedAt: null,
    reconnectAttempts: 0,
    streamError: null,
    backpressureQueueDepth: 0,
    backpressureDroppedUpdates: 0,
    lastBackpressureDropAt: null,
    commitmentBuffer: {},
    skippedSlotIds: {},
  };
}

function getStore() {
  globalThis.bundleIqYellowstoneSlotStore ??= createInitialState();
  return globalThis.bundleIqYellowstoneSlotStore;
}

export function getYellowstoneSlotSnapshot(): YellowstoneSlotSnapshot {
  const {
    commitmentBuffer,
    skippedSlotIds,
    ...snapshot
  } = getStore();
  void commitmentBuffer;
  void skippedSlotIds;

  return { ...snapshot };
}

export function setYellowstoneCommitment(commitment: YellowstoneCommitment) {
  const store = getStore();

  store.commitment = commitment;
}

export function markYellowstoneConnecting() {
  const store = getStore();

  store.streamConnected = false;
  store.streamStatus = "connecting";
  store.streamError = null;
}

export function markYellowstoneConnected() {
  const store = getStore();

  store.streamConnected = true;
  store.streamStatus = "connected";
  store.streamError = null;
}

export function markYellowstoneDisconnected(error: string) {
  const store = getStore();

  store.streamConnected = false;
  store.streamStatus = "disconnected";
  store.lastDisconnectedAt = new Date().toISOString();
  store.streamError = error;
}

export function markYellowstoneUnavailable(error: string) {
  const store = getStore();

  store.streamConnected = false;
  store.streamStatus = "unavailable";
  store.lastDisconnectedAt = new Date().toISOString();
  store.streamError = error;
}

export function markYellowstoneReconnecting(error: string) {
  const store = getStore();

  store.streamConnected = false;
  store.streamStatus = "reconnecting";
  store.lastDisconnectedAt = new Date().toISOString();
  store.reconnectAttempts += 1;
  store.streamError = error;
}

export function markYellowstoneError(error: string) {
  const store = getStore();

  store.streamConnected = false;
  store.streamStatus = "error";
  store.lastDisconnectedAt = new Date().toISOString();
  store.streamError = error;
}

export function setYellowstoneBackpressureQueueDepth(depth: number) {
  const store = getStore();

  store.backpressureQueueDepth = Math.max(0, depth);
}

export function recordYellowstoneBackpressureDrop(depth: number) {
  const store = getStore();

  store.backpressureDroppedUpdates += 1;
  store.backpressureQueueDepth = Math.max(0, depth);
  store.lastBackpressureDropAt = new Date().toISOString();
}

export function recordYellowstonePong() {
  const store = getStore();

  store.lastPongAt = new Date().toISOString();
}

export function recordYellowstoneSlotUpdate({
  slot,
  commitmentStage,
  isSkipped,
}: {
  slot: number;
  commitmentStage: SlotCommitmentStage | null;
  isSkipped?: boolean;
}) {
  const store = getStore();
  const observedAt = Date.now();

  store.currentSlot = Math.max(store.currentSlot ?? 0, slot);
  store.lastStreamUpdate = new Date(observedAt).toISOString();

  if (commitmentStage === "processed") {
    store.processedSlot = Math.max(store.processedSlot ?? 0, slot);
  }

  if (commitmentStage === "confirmed") {
    store.confirmedSlot = Math.max(store.confirmedSlot ?? 0, slot);
  }

  if (commitmentStage === "finalized") {
    store.finalizedSlot = Math.max(store.finalizedSlot ?? 0, slot);
  }

  if (commitmentStage) {
    promoteSlotCommitment(
      store.commitmentBuffer,
      slot,
      commitmentStage,
      observedAt,
    );
    store.processedToConfirmedDeltaMs = calculateProcessedToConfirmedDelta(
      store.commitmentBuffer,
    );
    store.confirmedToFinalizedDeltaMs = calculateConfirmedToFinalizedDelta(
      store.commitmentBuffer,
    );
  }

  if (isSkipped) {
    store.skippedSlotIds[String(slot)] = true;
    store.skippedSlots = Object.keys(store.skippedSlotIds).length;
  }

  if (store.streamStatus !== "connected") {
    store.streamStatus = "connected";
  }

  store.streamConnected = true;
  store.streamError = null;
}
