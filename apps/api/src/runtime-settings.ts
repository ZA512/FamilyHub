export const DEFAULT_API_RATE_LIMIT_PER_MINUTE = 1_200;
export const DEFAULT_STORAGE_QUOTA_BYTES = 10_737_418_240;

export type RuntimeSettings = {
  apiRateLimitPerMinute: number;
};

export function readApiRateLimit(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 300 && value <= 10_000
    ? value
    : DEFAULT_API_RATE_LIMIT_PER_MINUTE;
}

export function readStorageQuota(value: unknown): number {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 104_857_600 &&
    value <= 10_995_116_277_760
    ? value
    : DEFAULT_STORAGE_QUOTA_BYTES;
}
