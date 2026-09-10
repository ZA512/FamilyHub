import { describe, expect, it } from 'vitest';

import { moduleKeySchema, moduleUpdateSchema } from './index.js';

describe('module contracts', () => {
  it('refuse une clé de module inconnue', () => {
    expect(moduleKeySchema.safeParse('unknown').success).toBe(false);
  });

  it('exige un état booléen', () => {
    expect(moduleUpdateSchema.safeParse({ enabled: 'yes' }).success).toBe(false);
  });
});
