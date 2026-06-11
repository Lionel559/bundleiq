import {
  getBlockHeight,
  getCurrentSlot,
  getLatestBlockhashInfo,
} from "@/lib/solana/slot-monitor";

export const dynamic = "force-dynamic";

export async function GET() {
  const [currentSlot, blockHeight, blockhashInfo] = await Promise.all([
    getCurrentSlot(),
    getBlockHeight(),
    getLatestBlockhashInfo(),
  ]);

  return Response.json({
    currentSlot,
    blockHeight,
    blockhash: blockhashInfo.blockhash,
    lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
    commitment: blockhashInfo.commitment,
  });
}
