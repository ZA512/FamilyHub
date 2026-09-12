import { describe, expect, it } from 'vitest';

import { instanceSettingsUpdateSchema } from './index.js';

describe('instance settings contracts', () => {
  it('accepte une limite API adaptée à un foyer', () => {
    expect(instanceSettingsUpdateSchema.parse({ apiRateLimitPerMinute: 2_500 })).toEqual({
      apiRateLimitPerMinute: 2_500,
    });
  });

  it.each([0, 299, 10_001, 1_200.5])('refuse la limite API %s', (apiRateLimitPerMinute) => {
    expect(() => instanceSettingsUpdateSchema.parse({ apiRateLimitPerMinute })).toThrow();
  });
});
