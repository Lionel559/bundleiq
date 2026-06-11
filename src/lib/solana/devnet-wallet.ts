import { SecretKeyEnvError, loadJsonKeypairFromEnv } from "./keypair-env";

export const SOLANA_DEVNET_SECRET_KEY_ENV = "SOLANA_DEVNET_SECRET_KEY";

export class DevnetWalletEnvError extends SecretKeyEnvError {
  constructor(message: string) {
    super(message);
    this.name = "DevnetWalletEnvError";
  }
}

export function loadDevnetKeypair() {
  return loadJsonKeypairFromEnv(SOLANA_DEVNET_SECRET_KEY_ENV, {
    errorFactory: (message) => new DevnetWalletEnvError(message),
    purpose: "a funded devnet-only secret key",
  });
}
