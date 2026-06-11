export interface RetryPolicy {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  attempts: 4,
  baseDelayMs: 150,
  maxDelayMs: 1_200,
  jitter: true,
};

export function getBackoffDelay(attempt: number, policy = DEFAULT_RETRY_POLICY) {
  const exponentialDelay = policy.baseDelayMs * 2 ** Math.max(attempt - 1, 0);
  const boundedDelay = Math.min(exponentialDelay, policy.maxDelayMs);

  return policy.jitter ? Math.round(boundedDelay * 1.18) : boundedDelay;
}
