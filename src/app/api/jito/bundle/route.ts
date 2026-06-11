import {
  assertJitoEnabled,
  JitoConfigError,
  JitoDisabledError,
  JitoSubmissionError,
  JITO_TESTNET_UNFUNDED_MESSAGE,
  submitPrebuiltJitoBundle,
  submitJitoBundle,
  type SubmitJitoBundleInput,
} from "@/lib/jito/server-adapter";
import { buildSignedTestnetMemoTransaction } from "@/lib/jito/build-signed-testnet-transaction";
import {
  recordRealJitoSubmission,
  removeRealJitoTestnetEvidence,
} from "@/lib/jito/evidence-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getStatusCode(error: unknown) {
  if (
    error instanceof JitoConfigError ||
    error instanceof JitoDisabledError ||
    error instanceof JitoSubmissionError
  ) {
    return 400;
  }

  return 500;
}

function parseRequestBody(body: unknown): SubmitJitoBundleInput {
  if (!body || typeof body !== "object") {
    return {};
  }

  const candidate = body as Record<string, unknown>;
  const signedTransactions = candidate.signedTransactions;

  if (
    signedTransactions !== undefined &&
    (!Array.isArray(signedTransactions) ||
      !signedTransactions.every((transaction) => typeof transaction === "string"))
  ) {
    throw new JitoSubmissionError(
      "signedTransactions must be an array of base64 signed transaction strings.",
    );
  }

  return {
    signedTransactions: signedTransactions as string[] | undefined,
    tipLamports:
      typeof candidate.tipLamports === "number"
        ? candidate.tipLamports
        : undefined,
    reason: typeof candidate.reason === "string" ? candidate.reason : undefined,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const input = parseRequestBody(body);
    const autoSignedTransaction = input.signedTransactions
      ? null
      : await (async () => {
          assertJitoEnabled();

          return buildSignedTestnetMemoTransaction(input.tipLamports);
        })();
    const bundle = autoSignedTransaction
      ? await submitPrebuiltJitoBundle({
          signedTransactions: [autoSignedTransaction.signedTransaction],
          tipLamports: autoSignedTransaction.tipLamports,
          tipAccount: autoSignedTransaction.tipAccount,
          lastValidBlockHeight: autoSignedTransaction.lastValidBlockHeight,
          reason:
            input.reason ??
            "Auto-signed server-side Jito testnet memo bundle submitted; landing status was not inferred.",
        })
      : await submitJitoBundle(input);
    const evidence = recordRealJitoSubmission(bundle);

    return Response.json({
      bundle,
      evidence,
      autoSignedTransaction: autoSignedTransaction
        ? {
            blockhash: autoSignedTransaction.blockhash,
            lastValidBlockHeight: autoSignedTransaction.lastValidBlockHeight,
            signerPublicKey: autoSignedTransaction.signerPublicKey,
            tipAccount: autoSignedTransaction.tipAccount,
            tipLamports: autoSignedTransaction.tipLamports,
            hasJitoTipInstruction: autoSignedTransaction.hasJitoTipInstruction,
          }
        : null,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === JITO_TESTNET_UNFUNDED_MESSAGE
    ) {
      removeRealJitoTestnetEvidence();
    }

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to submit Jito testnet bundle.",
      },
      {
        status: getStatusCode(error),
      },
    );
  }
}
