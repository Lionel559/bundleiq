export const LAMPORTS_PER_SOL = 1_000_000_000;

const integerFormatter = new Intl.NumberFormat("en-US");
const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});
const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "UTC",
});

export function compactSignature(signature: string, leading = 5, trailing = 5) {
  if (signature.length <= leading + trailing) {
    return signature;
  }

  return `${signature.slice(0, leading)}...${signature.slice(-trailing)}`;
}

export function formatLamports(lamports: number) {
  return `${integerFormatter.format(lamports)} lamports`;
}

export function formatSolFromLamports(lamports: number, digits = 6) {
  return `${(lamports / LAMPORTS_PER_SOL).toFixed(digits)} SOL`;
}

export function formatPercent(value: number) {
  return `${percentFormatter.format(value)}%`;
}

export function formatSlot(slot: number) {
  return integerFormatter.format(slot);
}

export function formatTimestamp(timestamp: string) {
  return timeFormatter.format(new Date(timestamp));
}

export function formatDuration(ms: number) {
  if (ms < 1_000) {
    return `${Math.round(ms)}ms`;
  }

  return `${(ms / 1_000).toFixed(1)}s`;
}
