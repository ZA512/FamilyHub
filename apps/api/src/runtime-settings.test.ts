import { describe, expect, it } from 'vitest';

import {
  DEFAULT_API_RATE_LIMIT_PER_MINUTE,
  DEFAULT_STORAGE_QUOTA_BYTES,
  readApiRateLimit,
  readStorageQuota,
} from './runtime-settings.js';

describe('runtime settings', () => {
  it('accepte un plafond API valide', () => {
    expect(readApiRateLimit(2_500)).toBe(2_500);
  });

  it.each([undefined, null, '1200', 299, 10_001, 12.5])(
    'utilise la valeur sûre pour %s',
    (value) => {
      expect(readApiRateLimit(value)).toBe(DEFAULT_API_RATE_LIMIT_PER_MINUTE);
    },
  );
});

describe('readStorageQuota', () => {
  it('accepts a quota within the supported range', () => {
    expect(readStorageQuota(5_368_709_120)).toBe(5_368_709_120);
  });

  it('falls back for malformed or unsafe values', () => {
    expect(readStorageQuota('large')).toBe(DEFAULT_STORAGE_QUOTA_BYTES);
    expect(readStorageQuota(1)).toBe(DEFAULT_STORAGE_QUOTA_BYTES);
  });
});
