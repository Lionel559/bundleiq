import { ensureYellowstoneStream } from "@/lib/grpc/yellowstone-client";
import {
  getYellowstoneSlotSnapshot,
  type YellowstoneStreamStatusResponse,
} from "@/lib/grpc/slot-store";
import { devnetConnection } from "@/lib/solana/connection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
      currentSlot: streamSnapshot.currentSlot!,
    };

    return Response.json(response);
  }

  const fallbackSlots = await getRpcFallbackSlots();
  const response: YellowstoneStreamStatusResponse = {
    ...streamSnapshot,
    ...fallbackSlots,
    source: "rpc-fallback",
    processedToConfirmedDeltaMs: null,
    confirmedToFinalizedDeltaMs: null,
    streamConnected: false,
    streamError:
      streamSnapshot.streamError ??
      "Yellowstone stream is unavailable; using Solana devnet RPC fallback.",
  };

  return Response.json(response);
}
