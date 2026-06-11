import { Keypair } from "@solana/web3.js";

export class SecretKeyEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretKeyEnvError";
  }
}

interface LoadJsonKeypairOptions {
  errorFactory?: (message: string) => Error;
  purpose: string;
}

export function loadJsonKeypairFromEnv(
  envName: string,
  { errorFactory, purpose }: LoadJsonKeypairOptions,
) {
  const createError =
    errorFactory ?? ((message: string) => new SecretKeyEnvError(message));
  const rawSecretKey = process.env[envName]?.trim();

  if (!rawSecretKey) {
    throw createError(
      `${envName} is missing. Add ${purpose} as a JSON array in your environment.`,
    );
  }

  if (!rawSecretKey.startsWith("[") || !rawSecretKey.endsWith("]")) {
    throw createError(
      `${envName} must use JSON array format only, for example [1,2,3,...].`,
    );
  }

  let parsedSecretKey: unknown;

  try {
    parsedSecretKey = JSON.parse(rawSecretKey);
  } catch {
    throw createError(`${envName} must be valid JSON array format.`);
  }

  if (!Array.isArray(parsedSecretKey)) {
    throw createError(`${envName} must be a JSON array of 64 byte values.`);
  }

  if (
    parsedSecretKey.length !== 64 ||
    !parsedSecretKey.every(
      (value) =>
        Number.isInteger(value) &&
        typeof value === "number" &&
        value >= 0 &&
        value <= 255,
    )
  ) {
    throw createError(
      `${envName} must be a JSON array of 64 integers between 0 and 255.`,
    );
  }

  return Keypair.fromSecretKey(Uint8Array.from(parsedSecretKey as number[]));
}
