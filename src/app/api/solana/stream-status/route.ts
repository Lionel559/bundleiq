import { ensureYellowstoneStream } from "@/lib/grpc/yellowstone-client";
import {
  getYellowstoneSlotSnapshot,
  type YellowstoneStreamStatusResponse,
} from "@/lib/grpc/slot-store";
import { devnetConnection } from "@/lib/solana/connection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STREAM_SOURCE = "SolInfra Yellowstone" as const;
const ENDPOINT_REGION = "FRA" as const;

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

export async function GET() {
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
