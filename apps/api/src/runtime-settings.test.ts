import { describe, expect, it } from 'vitest';

import { DEFAULT_API_RATE_LIMIT_PER_MINUTE, readApiRateLimit } from './runtime-settings.js';

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
