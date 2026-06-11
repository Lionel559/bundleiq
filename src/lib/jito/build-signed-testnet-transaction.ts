import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import { loadJsonKeypairFromEnv, SecretKeyEnvError } from "@/lib/solana/keypair-env";
import {
  assertJitoTestnetWalletFunded,
  getJitoTipLamports,
  JITO_DEFAULT_SOLANA_RPC_URL,
  JITO_TESTNET_SECRET_KEY_ENV,
  JitoConfigError,
  JitoSubmissionError,
  resolveJitoTipAccount,
} from "@/lib/jito/server-adapter";

export const SOLANA_TESTNET_RPC_URL_ENV = "SOLANA_TESTNET_RPC_URL";

const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);

export interface SignedTestnetMemoTransaction {
  signedTransaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
  signerPublicKey: string;
  tipAccount: string | null;
  tipLamports: number;
  hasJitoTipInstruction: boolean;
}

function getSolanaTestnetRpcUrl() {
  const configuredUrl = process.env[SOLANA_TESTNET_RPC_URL_ENV]?.trim();
  const url = configuredUrl || JITO_DEFAULT_SOLANA_RPC_URL;

  if (/mainnet|mainnet-beta/i.test(url)) {
    throw new JitoConfigError(
      `${SOLANA_TESTNET_RPC_URL_ENV} must target testnet; mainnet RPC is not allowed.`,
    );
  }

  return url;
}

function loadJitoTestnetMemoSigner() {
  try {
    return loadJsonKeypairFromEnv(JITO_TESTNET_SECRET_KEY_ENV, {
      purpose: "a funded Solana testnet keypair for server-side Jito memo signing",
    });
  } catch (error) {
    if (error instanceof SecretKeyEnvError) {
      throw new JitoConfigError(error.message);
    }

    throw error;
  }
}

async function resolveAvailableJitoTipAccount() {
  try {
    return await resolveJitoTipAccount();
  } catch (error) {
    if (error instanceof JitoSubmissionError) {
      return null;
    }

    if (
      error instanceof JitoConfigError &&
      error.message === "Jito getTipAccounts returned no tip accounts."
    ) {
      return null;
    }

    throw error;
  }
}

export async function buildSignedTestnetMemoTransaction(
  tipLamports?: number,
): Promise<SignedTestnetMemoTransaction> {
  const connection = new Connection(getSolanaTestnetRpcUrl(), "processed");
  await assertJitoTestnetWalletFunded(connection);

  const signer = loadJitoTestnetMemoSigner();
  const tipAccount = await resolveAvailableJitoTipAccount();
  const resolvedTipLamports = getJitoTipLamports(tipLamports);
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("processed");
  const transaction = new Transaction({
    feePayer: signer.publicKey,
    blockhash,
    lastValidBlockHeight,
  }).add(
    new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(`BundleIQ Jito testnet memo ${Date.now()}`),
    }),
  );

  if (tipAccount) {
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: tipAccount,
        lamports: resolvedTipLamports,
      }),
    );
  }

  transaction.sign(signer);

  return {
    signedTransaction: transaction.serialize().toString("base64"),
    blockhash,
    lastValidBlockHeight,
    signerPublicKey: signer.publicKey.toBase58(),
    tipAccount: tipAccount?.toBase58() ?? null,
    tipLamports: resolvedTipLamports,
    hasJitoTipInstruction: Boolean(tipAccount),
  };
}
