import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  type Commitment,
} from "@solana/web3.js";

import { loadDevnetKeypair } from "./devnet-wallet";
import { devnetConnection } from "./connection";
import type {
  DevnetMemoLifecycleResult,
  LifecycleStageDeltas,
} from "./lifecycle-tracker";

const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);
const DEVNET_MIN_FEE_LAMPORTS = 5_000;

export class DevnetWalletFundingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevnetWalletFundingError";
  }
}

function nowIso() {
  return new Date().toISOString();
}

function timestampDelta(from: string, to: string) {
  return Math.max(new Date(to).getTime() - new Date(from).getTime(), 0);
}

function calculateDeltas({
  submittedAt,
  processedAt,
  confirmedAt,
  finalizedAt,
}: Pick<
  DevnetMemoLifecycleResult,
  "submittedAt" | "processedAt" | "confirmedAt" | "finalizedAt"
>): LifecycleStageDeltas {
  return {
    submittedToProcessedMs: timestampDelta(submittedAt, processedAt),
    submittedToConfirmedMs: timestampDelta(submittedAt, confirmedAt),
    submittedToFinalizedMs: timestampDelta(submittedAt, finalizedAt),
    totalLatencyMs: timestampDelta(submittedAt, finalizedAt),
  };
}

function commitmentRank(commitment?: string) {
  if (commitment === "finalized") {
    return 3;
  }

  if (commitment === "confirmed") {
    return 2;
  }

  if (commitment === "processed") {
    return 1;
  }

  return 0;
}

async function waitForSignatureCommitment(
  signature: string,
  targetCommitment: Commitment,
  timeoutMs: number,
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const { value } = await devnetConnection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = value[0];

    if (status?.err) {
      throw new Error(`Devnet transaction failed before ${targetCommitment}.`);
    }

    const confirmationStatus =
      status?.confirmationStatus ??
      (status?.confirmations === null ? "finalized" : undefined);

    if (commitmentRank(confirmationStatus) >= commitmentRank(targetCommitment)) {
      return {
        slot: status?.slot ?? 0,
        observedAt: nowIso(),
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for devnet ${targetCommitment} commitment.`);
}

export async function submitDevnetMemoTransaction(): Promise<DevnetMemoLifecycleResult> {
  const wallet = loadDevnetKeypair();
  const balance = await devnetConnection.getBalance(wallet.publicKey, "confirmed");

  if (balance < DEVNET_MIN_FEE_LAMPORTS) {
    throw new DevnetWalletFundingError(
      "Devnet wallet is unfunded. Fund SOLANA_DEVNET_SECRET_KEY on devnet before submitting a memo transaction.",
    );
  }

  // Solana getLatestBlockhash returns lastValidBlockHeight; keep it with the
  // signed transaction so confirmation can respect blockhash expiration.
  const { blockhash, lastValidBlockHeight } =
    await devnetConnection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({
    feePayer: wallet.publicKey,
    blockhash,
    lastValidBlockHeight,
  }).add(
    new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(`BundleIQ devnet memo lifecycle ${Date.now()}`),
    }),
  );

  transaction.sign(wallet);

  const signature = await devnetConnection.sendRawTransaction(
    transaction.serialize(),
    {
      preflightCommitment: "confirmed",
      skipPreflight: false,
    },
  );
  const submittedAt = nowIso();
  const processed = await waitForSignatureCommitment(signature, "processed", 30_000);
  const confirmed = await waitForSignatureCommitment(signature, "confirmed", 45_000);
  const finalized = await waitForSignatureCommitment(signature, "finalized", 90_000);
  const lifecycle = {
    signature,
    slot: finalized.slot || confirmed.slot || processed.slot,
    submittedAt,
    processedAt: processed.observedAt,
    confirmedAt: confirmed.observedAt,
    finalizedAt: finalized.observedAt,
    status: "finalized" as const,
  };

  return {
    ...lifecycle,
    deltas: calculateDeltas(lifecycle),
  };
}
