import { describe, expect, it } from 'vitest';

import { instanceSettingsUpdateSchema } from './index.js';

describe('instance settings contracts', () => {
  it('accepte une limite API adaptée à un foyer', () => {
    expect(
      instanceSettingsUpdateSchema.parse({
        apiRateLimitPerMinute: 2_500,
        storageQuotaBytes: 5_368_709_120,
      }),
    ).toEqual({
      apiRateLimitPerMinute: 2_500,
      storageQuotaBytes: 5_368_709_120,
    });
  });

  it.each([0, 299, 10_001, 1_200.5])('refuse la limite API %s', (apiRateLimitPerMinute) => {
    expect(() =>
      instanceSettingsUpdateSchema.parse({
        apiRateLimitPerMinute,
        storageQuotaBytes: 5_368_709_120,
      }),
    ).toThrow();
  });

  it.each([0, 104_857_599, 10_995_116_277_761, 1_200.5])(
    'refuse le quota de stockage %s',
    (storageQuotaBytes) => {
      expect(() =>
        instanceSettingsUpdateSchema.parse({
          apiRateLimitPerMinute: 1_200,
          storageQuotaBytes,
        }),
      ).toThrow();
    },
  );
});
