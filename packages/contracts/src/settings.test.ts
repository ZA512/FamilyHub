import { describe, expect, it } from 'vitest';

import { instanceSettingsUpdateSchema } from './index.js';

describe('instance settings contracts', () => {
  it('accepte une limite API adaptée à un foyer', () => {
    expect(
      instanceSettingsUpdateSchema.parse({
        apiRateLimitPerMinute: 2_500,
        storageQuotaBytes: 5_368_709_120,
        mealPlanWeekStartsOn: 6,
        mealReferencePortions: 6,
      }),
    ).toEqual({
      apiRateLimitPerMinute: 2_500,
      storageQuotaBytes: 5_368_709_120,
      mealPlanWeekStartsOn: 6,
      mealReferencePortions: 6,
    });
  });

  it.each([0, 299, 10_001, 1_200.5])('refuse la limite API %s', (apiRateLimitPerMinute) => {
    expect(() =>
      instanceSettingsUpdateSchema.parse({
        apiRateLimitPerMinute,
        storageQuotaBytes: 5_368_709_120,
        mealPlanWeekStartsOn: 1,
        mealReferencePortions: 4,
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
          mealPlanWeekStartsOn: 1,
          mealReferencePortions: 4,
        }),
      ).toThrow();
    },
  );

  it.each([-1, 7, 1.5])('refuse le premier jour de semaine %s', (mealPlanWeekStartsOn) => {
    expect(() =>
      instanceSettingsUpdateSchema.parse({
        apiRateLimitPerMinute: 1_200,
        storageQuotaBytes: 5_368_709_120,
        mealPlanWeekStartsOn,
        mealReferencePortions: 4,
      }),
    ).toThrow();
  });

  it.each([0, 101, 1.5])('refuse %s portions de référence', (mealReferencePortions) => {
    expect(() => instanceSettingsUpdateSchema.parse({
      apiRateLimitPerMinute: 1_200,
      storageQuotaBytes: 5_368_709_120,
      mealPlanWeekStartsOn: 1,
      mealReferencePortions,
    })).toThrow();
  });
});
