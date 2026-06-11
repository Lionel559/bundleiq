import { DevnetWalletEnvError } from "@/lib/solana/devnet-wallet";
import {
  DevnetWalletFundingError,
  submitDevnetMemoTransaction,
} from "@/lib/solana/transaction-submitter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    const lifecycle = await submitDevnetMemoTransaction();

    return Response.json({ lifecycle });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to submit devnet memo transaction.";
    const status =
      error instanceof DevnetWalletEnvError ||
      error instanceof DevnetWalletFundingError
        ? 400
        : 500;

    return Response.json(
      {
        error: message,
      },
      {
        status,
      },
    );
  }
}
