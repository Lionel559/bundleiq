import { SOLANA_DEVNET_COMMITMENT, devnetConnection, getLatestDevnetBlockhash } from "./connection";

export interface LatestBlockhashInfo {
  blockhash: string;
  lastValidBlockHeight: number;
  commitment: typeof SOLANA_DEVNET_COMMITMENT;
}

export interface SolanaStatus {
  currentSlot: number;
  blockHeight: number;
  blockhash: string;
  lastValidBlockHeight: number;
  commitment: typeof SOLANA_DEVNET_COMMITMENT;
}

export function getCurrentSlot() {
  return devnetConnection.getSlot(SOLANA_DEVNET_COMMITMENT);
}

export function getBlockHeight() {
  return devnetConnection.getBlockHeight(SOLANA_DEVNET_COMMITMENT);
}

export async function getLatestBlockhashInfo(): Promise<LatestBlockhashInfo> {
  const { blockhash, lastValidBlockHeight } = await getLatestDevnetBlockhash();

  return {
    blockhash,
    lastValidBlockHeight,
    commitment: SOLANA_DEVNET_COMMITMENT,
  };
}
