import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";

import {
  SecretKeyEnvError,
  loadJsonKeypairFromEnv,
} from "@/lib/solana/keypair-env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const JITO_TESTNET_SECRET_KEY_ENV = "JITO_TESTNET_SECRET_KEY";
const SOLANA_TESTNET_RPC_URL_ENV = "SOLANA_TESTNET_RPC_URL";
const DEFAULT_SOLANA_TESTNET_RPC_URL = "https://api.testnet.solana.com";

function getSolanaTestnetRpcUrl() {
  const configuredUrl = process.env[SOLANA_TESTNET_RPC_URL_ENV]?.trim();

  return configuredUrl && !/mainnet|mainnet-beta/i.test(configuredUrl)
    ? configuredUrl
    : DEFAULT_SOLANA_TESTNET_RPC_URL;
}

export async function GET() {
  try {
    const wallet = loadJsonKeypairFromEnv(JITO_TESTNET_SECRET_KEY_ENV, {
      purpose: "a funded Jito testnet-only secret key",
    });
    const testnetConnection = new Connection(getSolanaTestnetRpcUrl(), "confirmed");
    const balanceLamports = await testnetConnection.getBalance(
      wallet.publicKey,
      "confirmed",
    );

    return Response.json({
      publicKey: wallet.publicKey.toBase58(),
      balanceLamports,
      balanceSol: balanceLamports / LAMPORTS_PER_SOL,
      network: "testnet",
      funded: balanceLamports > 0,
    });
  } catch (error) {
    const message =
      error instanceof SecretKeyEnvError
        ? error.message
        : "Unable to read testnet wallet status.";

    return Response.json(
      {
        error: message,
        network: "testnet",
        funded: false,
      },
      {
        status: error instanceof SecretKeyEnvError ? 400 : 500,
      },
    );
  }
}
