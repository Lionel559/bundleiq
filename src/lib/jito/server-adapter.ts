import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

import { loadJsonKeypairFromEnv, SecretKeyEnvError } from "@/lib/solana/keypair-env";
import type {
  BundleStatus,
  BundleSubmissionResult,
  JitoConstructedBundle,
  JitoBundleStatusCheck,
} from "@/types/jito";

export const JITO_DEFAULT_BLOCK_ENGINE_URL =
  "https://testnet.block-engine.jito.wtf";
export const JITO_DEFAULT_SOLANA_RPC_URL = "https://api.testnet.solana.com";
export const JITO_TESTNET_SECRET_KEY_ENV = "JITO_TESTNET_SECRET_KEY";
export const JITO_TESTNET_UNFUNDED_MESSAGE =
  "Testnet wallet is unfunded. Real Jito submission blocked.";

export const JITO_MIN_TIP_LAMPORTS = 1_000;
// Official Jito block-engine docs cap bundles at five signed transactions and
// recommend base64 encoding.
export const JITO_MAX_BUNDLE_TRANSACTIONS = 5;
const FETCH_RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

type JitoRpcMethod =
  | "getBundleStatuses"
  | "getInflightBundleStatuses"
  | "getTipAccounts"
  | "sendBundle";

interface JitoRpcResponse<T> {
  jsonrpc?: string;
  id?: string | number;
  result?: T;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

interface JitoTipTransaction {
  encodedTransaction: string;
  lastValidBlockHeight: number;
  tipAccount: string;
  tipLamports: number;
}

export interface JitoTestnetWalletFundingStatus {
  publicKey: string;
  balanceLamports: number;
  funded: boolean;
}

interface JitoBundleStatusesResult {
  context?: {
    slot?: number;
  };
  value: Array<{
    bundle_id?: string;
    transactions?: string[];
    slot?: number;
    confirmation_status?: string;
    confirmationStatus?: string;
    err?: unknown;
  } | null> | null;
}

interface JitoInflightBundleStatusesResult {
  value: Array<{
    bundle_id?: string;
    status?: string;
    landed_slot?: number | null;
  } | null> | null;
}

export interface SubmitJitoBundleInput {
  signedTransactions?: string[];
  tipLamports?: number;
  reason?: string;
}

export type ConstructJitoBundleInput = SubmitJitoBundleInput;

export interface SubmitPrebuiltJitoBundleInput {
  signedTransactions: string[];
  tipLamports?: number;
  reason?: string;
  tipAccount?: string | null;
  lastValidBlockHeight?: number;
}

export class JitoDisabledError extends Error {
  constructor() {
    super("Jito is disabled. Set JITO_ENABLED=true to enable testnet bundle submission.");
    this.name = "JitoDisabledError";
  }
}

export class JitoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JitoConfigError";
  }
}

export class JitoSubmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JitoSubmissionError";
  }
}

export function isJitoEnabled() {
  return process.env.JITO_ENABLED === "true";
}

function normalizeUrl(url: string) {
  return url.replace(/\/+$/, "");
}

function getJitoBlockEngineUrl() {
  const configuredUrl = process.env.JITO_BLOCK_ENGINE_URL?.trim();
  const url = normalizeUrl(configuredUrl || JITO_DEFAULT_BLOCK_ENGINE_URL);

  if (!/^https:\/\//i.test(url)) {
    throw new JitoConfigError("JITO_BLOCK_ENGINE_URL must be an HTTPS URL.");
  }

  if (/mainnet|mainnet-beta/i.test(url)) {
    throw new JitoConfigError(
      "Jito mainnet endpoints are disabled in BundleIQ; use the default testnet block engine.",
    );
  }

  return url;
}

function getJitoSolanaRpcUrl() {
  const configuredUrl = process.env.JITO_SOLANA_RPC_URL?.trim();
  const url = configuredUrl || JITO_DEFAULT_SOLANA_RPC_URL;

  if (/mainnet|mainnet-beta/i.test(url)) {
    throw new JitoConfigError(
      "Jito Solana RPC must target testnet; mainnet RPC is not allowed.",
    );
  }

  return url;
}

export function getJitoTipLamports(tipLamports?: number) {
  const configuredTip = Number.parseInt(process.env.JITO_TIP_LAMPORTS ?? "", 10);
  const requestedTip =
    typeof tipLamports === "number" && Number.isFinite(tipLamports)
      ? tipLamports
      : configuredTip;

  if (!Number.isFinite(requestedTip)) {
    return JITO_MIN_TIP_LAMPORTS;
  }

  return Math.max(Math.trunc(requestedTip), JITO_MIN_TIP_LAMPORTS);
}

function getJitoRpcPath(method: JitoRpcMethod) {
  if (method === "sendBundle") {
    return "/api/v1/bundles";
  }

  return `/api/v1/${method}`;
}

function createJitoConnection() {
  return new Connection(getJitoSolanaRpcUrl(), "processed");
}

function loadJitoTestnetKeypair() {
  try {
    return loadJsonKeypairFromEnv(JITO_TESTNET_SECRET_KEY_ENV, {
      purpose: "a funded Solana testnet keypair for the server-side Jito tip transaction",
    });
  } catch (error) {
    if (error instanceof SecretKeyEnvError) {
      throw new JitoConfigError(error.message);
    }

    throw error;
  }
}

export async function getJitoTestnetWalletFundingStatus(
  connection = createJitoConnection(),
): Promise<JitoTestnetWalletFundingStatus> {
  const wallet = loadJitoTestnetKeypair();
  const balanceLamports = await connection.getBalance(
    wallet.publicKey,
    "confirmed",
  );

  return {
    publicKey: wallet.publicKey.toBase58(),
    balanceLamports,
    funded: balanceLamports > 0,
  };
}

export async function assertJitoTestnetWalletFunded(
  connection = createJitoConnection(),
) {
  const fundingStatus = await getJitoTestnetWalletFundingStatus(connection);

  if (!fundingStatus.funded) {
    throw new JitoSubmissionError(JITO_TESTNET_UNFUNDED_MESSAGE);
  }

  return fundingStatus;
}

export function assertJitoEnabled() {
  if (!isJitoEnabled()) {
    throw new JitoDisabledError();
  }
}

function assertBundleSize(transactions: string[]) {
  if (transactions.length === 0) {
    throw new JitoSubmissionError("A Jito bundle must include at least one signed transaction.");
  }

  if (transactions.length > JITO_MAX_BUNDLE_TRANSACTIONS) {
    throw new JitoSubmissionError(
      `Jito bundles are limited to ${JITO_MAX_BUNDLE_TRANSACTIONS} signed transactions.`,
    );
  }
}

function assertUserSignedTransactions(transactions: string[]) {
  if (transactions.length === 0) {
    throw new JitoSubmissionError(
      "A Jito bundle must include at least one caller-provided signed transaction before the tip transaction.",
    );
  }

  if (transactions.length + 1 > JITO_MAX_BUNDLE_TRANSACTIONS) {
    throw new JitoSubmissionError(
      `Jito bundles are limited to ${JITO_MAX_BUNDLE_TRANSACTIONS} signed transactions including the tip; provide at most ${
        JITO_MAX_BUNDLE_TRANSACTIONS - 1
      } signed transactions before the tip.`,
    );
  }
}

function isBase64Transaction(encodedTransaction: string) {
  if (encodedTransaction.length === 0 || encodedTransaction.length % 4 !== 0) {
    return false;
  }

  return /^[A-Za-z0-9+/]+={0,2}$/.test(encodedTransaction);
}

function normalizeSignedTransactions(signedTransactions?: string[]) {
  const transactions = (signedTransactions ?? []).map((transaction) =>
    transaction.trim(),
  );

  if (!transactions.every(isBase64Transaction)) {
    throw new JitoSubmissionError(
      "Jito signed transactions must be base64-encoded strings.",
    );
  }

  return transactions;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatFetchError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRetryableResponse(response: Response) {
  return response.status === 429 || response.status >= 500;
}

async function fetchJitoRpcWithRetry(
  url: string,
  init: RequestInit,
  method: JitoRpcMethod,
) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= FETCH_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(url, init);

      if (
        attempt < FETCH_RETRY_DELAYS_MS.length &&
        isRetryableResponse(response)
      ) {
        await wait(FETCH_RETRY_DELAYS_MS[attempt]);
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;

      if (attempt >= FETCH_RETRY_DELAYS_MS.length) {
        break;
      }

      await wait(FETCH_RETRY_DELAYS_MS[attempt]);
    }
  }

  throw new JitoSubmissionError(
    `Jito ${method} fetch failed after ${FETCH_RETRY_DELAYS_MS.length} retries: ${formatFetchError(
      lastError,
    )}.`,
  );
}

async function callJitoRpcPayload<T>(method: JitoRpcMethod, params: unknown[]) {
  const url = `${getJitoBlockEngineUrl()}${getJitoRpcPath(method)}`;
  const authUuid = process.env.JITO_AUTH_UUID?.trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (authUuid) {
    headers["x-jito-auth"] = authUuid;
  }

  const response = await fetchJitoRpcWithRetry(
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `bundleiq-${method}-${Date.now()}`,
        method,
        params,
      }),
      cache: "no-store",
    },
    method,
  );

  if (!response.ok) {
    throw new JitoSubmissionError(
      `Jito ${method} failed with HTTP ${response.status}.`,
    );
  }

  const payload = (await response.json()) as JitoRpcResponse<T>;

  if (payload.error) {
    throw new JitoSubmissionError(
      `Jito ${method} error: ${payload.error.message ?? "unknown error"}.`,
    );
  }

  if (payload.result === undefined) {
    throw new JitoSubmissionError(`Jito ${method} returned no result.`);
  }

  return payload;
}

async function callJitoRpc<T>(method: JitoRpcMethod, params: unknown[]) {
  const payload = await callJitoRpcPayload<T>(method, params);

  return payload.result as T;
}

export async function resolveJitoTipAccount() {
  const configuredTipAccount = process.env.JITO_TIP_ACCOUNT?.trim();

  if (configuredTipAccount) {
    return new PublicKey(configuredTipAccount);
  }

  const tipAccounts = await callJitoRpc<string[]>("getTipAccounts", []);
  const firstTipAccount = tipAccounts[0];

  if (!firstTipAccount) {
    throw new JitoConfigError("Jito getTipAccounts returned no tip accounts.");
  }

  return new PublicKey(firstTipAccount);
}

async function sendBundleTransactions(encodedTransactions: string[]) {
  return callJitoRpc<string>("sendBundle", [
    encodedTransactions,
    {
      encoding: "base64",
    },
  ]);
}

function createSubmittedBundleResult({
  bundleId,
  tipLamports,
  transactionCount,
  userTransactionCount,
  tipAccount,
  lastValidBlockHeight,
  reason,
}: {
  bundleId: string;
  tipLamports: number;
  transactionCount: number;
  userTransactionCount: number;
  tipAccount?: string | null;
  lastValidBlockHeight?: number;
  reason?: string;
}): BundleSubmissionResult {
  return {
    bundleId,
    status: "submitted-not-landed",
    tipLamports,
    submittedAt: new Date().toISOString(),
    leaderSlot: 0,
    leaderDistance: 0,
    reason:
      reason ??
      "Jito testnet sendBundle returned a bundle_id; landing status was not inferred.",
    mode: "real-jito-testnet",
    network: "testnet",
    source: "real-jito-testnet",
    bundleSource: "real-jito-testnet",
    encoding: "base64",
    transactionCount,
    userTransactionCount,
    tipAccount: tipAccount ?? undefined,
    lastValidBlockHeight,
    initialStatus: "submitted-not-landed",
    statusSource: "sendBundle",
    statusCheckedAt: null,
  };
}

async function createJitoTipTransaction(
  tipLamports: number,
): Promise<JitoTipTransaction> {
  const connection = createJitoConnection();
  const payer = loadJitoTestnetKeypair();
  const tipAccount = await resolveJitoTipAccount();
  // Solana getLatestBlockhash returns lastValidBlockHeight; Jito submissions keep
  // that value with the signed tip transaction so expiration is tracked explicitly.
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("processed");
  const transaction = new Transaction({
    feePayer: payer.publicKey,
    blockhash,
    lastValidBlockHeight,
  }).add(
    // Jito low-latency send docs require a tip instruction for bundle auctions.
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: tipAccount,
      lamports: tipLamports,
    }),
  );

  transaction.sign(payer);

  return {
    encodedTransaction: transaction.serialize().toString("base64"),
    lastValidBlockHeight,
    tipAccount: tipAccount.toBase58(),
    tipLamports,
  };
}

export async function constructJitoBundle({
  signedTransactions,
  tipLamports,
  reason,
}: ConstructJitoBundleInput): Promise<JitoConstructedBundle> {
  const normalizedTransactions = normalizeSignedTransactions(signedTransactions);

  assertUserSignedTransactions(normalizedTransactions);

  const tipTransaction = await createJitoTipTransaction(
    getJitoTipLamports(tipLamports),
  );
  const bundleTransactions = [
    ...normalizedTransactions,
    tipTransaction.encodedTransaction,
  ];

  assertBundleSize(bundleTransactions);

  return {
    status: "constructed",
    encodedTransactions: bundleTransactions,
    encoding: "base64",
    transactionCount: bundleTransactions.length,
    userTransactionCount: normalizedTransactions.length,
    tipAccount: tipTransaction.tipAccount,
    tipLamports: tipTransaction.tipLamports,
    lastValidBlockHeight: tipTransaction.lastValidBlockHeight,
    constructedAt: new Date().toISOString(),
    mode: "jito-testnet",
    bundleSource: "constructed-only",
    reason:
      reason ??
      "Jito testnet bundle constructed with caller-signed transaction(s) and a signed tip transaction; not submitted.",
  };
}

function statusFromInflightStatus(status?: string): BundleStatus {
  const normalizedStatus = status?.toLowerCase();

  if (normalizedStatus === "landed") {
    return "landed";
  }

  if (normalizedStatus === "failed") {
    return "failed";
  }

  if (normalizedStatus === "invalid") {
    return "invalid";
  }

  if (normalizedStatus === "pending") {
    return "pending";
  }

  return "pending";
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStringField(value: unknown, field: string) {
  if (!isObjectRecord(value)) {
    return null;
  }

  const fieldValue = value[field];

  return typeof fieldValue === "string" ? fieldValue : null;
}

function getNumberField(value: unknown, field: string) {
  if (!isObjectRecord(value)) {
    return null;
  }

  const fieldValue = value[field];

  return typeof fieldValue === "number" && Number.isFinite(fieldValue)
    ? fieldValue
    : null;
}

function getField(value: unknown, field: string) {
  return isObjectRecord(value) ? value[field] : undefined;
}

function getStatusValueArray(result: unknown) {
  if (!isObjectRecord(result)) {
    return [];
  }

  return Array.isArray(result.value) ? result.value : [];
}

function findStatusByBundleId(result: unknown, bundleId: string) {
  return getStatusValueArray(result).find(
    (status) => getStringField(status, "bundle_id") === bundleId,
  );
}

function isJitoOkErr(err: unknown) {
  if (err === null || err === undefined) {
    return true;
  }

  if (typeof err !== "object" || Array.isArray(err)) {
    return false;
  }

  return "Ok" in err && (err as { Ok?: unknown }).Ok === null;
}

function getRawStatusPayload({
  inflightPayload,
  landedPayload,
}: {
  inflightPayload: JitoRpcResponse<JitoInflightBundleStatusesResult>;
  landedPayload: JitoRpcResponse<JitoBundleStatusesResult>;
}) {
  return {
    getInflightBundleStatuses: inflightPayload,
    getBundleStatuses: landedPayload,
  };
}

export async function submitJitoBundle({
  signedTransactions,
  tipLamports,
  reason,
}: SubmitJitoBundleInput): Promise<BundleSubmissionResult> {
  assertJitoEnabled();
  await assertJitoTestnetWalletFunded();

  const constructedBundle = await constructJitoBundle({
    signedTransactions,
    tipLamports,
    reason,
  });

  // Jito's sendBundle response is only a bundle id. Landing is checked later by
  // getBundleStatuses/getInflightBundleStatuses, so this status is deliberate.
  const bundleId = await sendBundleTransactions(
    constructedBundle.encodedTransactions,
  );

  return createSubmittedBundleResult({
    bundleId,
    tipLamports: constructedBundle.tipLamports,
    reason:
      reason ??
      "Jito testnet sendBundle returned a bundle_id; landing status was not inferred.",
    transactionCount: constructedBundle.transactionCount,
    userTransactionCount: constructedBundle.userTransactionCount,
    tipAccount: constructedBundle.tipAccount,
    lastValidBlockHeight: constructedBundle.lastValidBlockHeight,
  });
}

export async function submitPrebuiltJitoBundle({
  signedTransactions,
  tipLamports,
  reason,
  tipAccount,
  lastValidBlockHeight,
}: SubmitPrebuiltJitoBundleInput): Promise<BundleSubmissionResult> {
  assertJitoEnabled();
  await assertJitoTestnetWalletFunded();

  const normalizedTransactions = normalizeSignedTransactions(signedTransactions);

  assertBundleSize(normalizedTransactions);

  const bundleId = await sendBundleTransactions(normalizedTransactions);

  return createSubmittedBundleResult({
    bundleId,
    tipLamports: getJitoTipLamports(tipLamports),
    transactionCount: normalizedTransactions.length,
    userTransactionCount: normalizedTransactions.length,
    tipAccount,
    lastValidBlockHeight,
    reason:
      reason ??
      "Auto-signed Jito testnet memo bundle submitted; landing status was not inferred.",
  });
}

export async function checkJitoBundleStatuses(
  bundleIds: string[],
): Promise<JitoBundleStatusCheck[]> {
  assertJitoEnabled();

  const normalizedBundleIds = bundleIds.map((bundleId) => bundleId.trim());

  if (
    normalizedBundleIds.length === 0 ||
    normalizedBundleIds.length > JITO_MAX_BUNDLE_TRANSACTIONS
  ) {
    throw new JitoSubmissionError(
      `Check between 1 and ${JITO_MAX_BUNDLE_TRANSACTIONS} Jito bundle ids at a time.`,
    );
  }

  const checkedAt = new Date().toISOString();
  const inflightPayload =
    await callJitoRpcPayload<JitoInflightBundleStatusesResult>(
      "getInflightBundleStatuses",
      [normalizedBundleIds],
    );
  const landedPayload = await callJitoRpcPayload<JitoBundleStatusesResult>(
    "getBundleStatuses",
    [normalizedBundleIds],
  );
  const inflightStatuses = inflightPayload.result;
  const landedStatuses = landedPayload.result;

  return normalizedBundleIds.map((bundleId) => {
    const inflight = findStatusByBundleId(inflightStatuses, bundleId);
    const landed = findStatusByBundleId(landedStatuses, bundleId);
    const inflightStatus = statusFromInflightStatus(
      getStringField(inflight, "status") ?? undefined,
    );
    const landedError = getField(landed, "err");
    const status: BundleStatus = landed
      ? isJitoOkErr(landedError)
        ? "landed"
        : "failed"
      : inflightStatus;
    const inflightError =
      status === "failed" && !landedError
        ? getStringField(inflight, "status") ??
          "Jito reported the bundle as failed or invalid."
        : null;

    const confirmationLevel =
      getStringField(landed, "confirmation_status") ??
      getStringField(landed, "confirmationStatus");
    const landedSlot =
      status === "landed"
        ? getNumberField(landed, "slot") ??
          getNumberField(inflight, "landed_slot")
        : null;

    return {
      bundleId,
      status,
      checkedAt,
      statusSource: "bundle-status",
      inflightStatus: getStringField(inflight, "status"),
      confirmationStatus: confirmationLevel,
      confirmationLevel,
      landedSlot,
      error: landedError ?? inflightError,
      rawStatusPayload: getRawStatusPayload({
        inflightPayload,
        landedPayload,
      }),
    };
  });
}
