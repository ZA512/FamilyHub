export const DEFAULT_API_RATE_LIMIT_PER_MINUTE = 1_200;

export type RuntimeSettings = {
  apiRateLimitPerMinute: number;
};

export function readApiRateLimit(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 300 && value <= 10_000
    ? value
    : DEFAULT_API_RATE_LIMIT_PER_MINUTE;
}
