import { Connection } from "@solana/web3.js";

export const SOLANA_DEVNET_RPC_URL = "https://api.devnet.solana.com";
export const SOLANA_DEVNET_COMMITMENT = "confirmed" as const;

function resolveDevnetRpcUrl() {
  const configuredRpcUrl = process.env.SOLANA_RPC_URL?.trim();

  if (!configuredRpcUrl) {
    return SOLANA_DEVNET_RPC_URL;
  }

  return configuredRpcUrl.includes("devnet")
    ? configuredRpcUrl
    : SOLANA_DEVNET_RPC_URL;
}

export const devnetConnection = new Connection(
  resolveDevnetRpcUrl(),
  SOLANA_DEVNET_COMMITMENT,
);

export function getLatestDevnetBlockhash() {
  return devnetConnection.getLatestBlockhash(SOLANA_DEVNET_COMMITMENT);
}
