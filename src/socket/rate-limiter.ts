interface UserRate {
  timestamps: number[];
}

const userRates: Map<string, UserRate> = new Map();

const MAX_MESSAGES = 5;
const WINDOW_MS = 10_000;

export function isRateLimited(socketId: string): boolean {
  const now = Date.now();
  let rate = userRates.get(socketId);

  if (!rate) {
    rate = { timestamps: [] };
    userRates.set(socketId, rate);
  }

  // Remove timestamps outside the window
  rate.timestamps = rate.timestamps.filter((t) => now - t < WINDOW_MS);

  if (rate.timestamps.length >= MAX_MESSAGES) {
    return true;
  }

  rate.timestamps.push(now);
  return false;
}

export function clearRateLimit(socketId: string): void {
  userRates.delete(socketId);
}
