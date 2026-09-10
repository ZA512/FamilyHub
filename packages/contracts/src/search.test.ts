import { describe, expect, it } from 'vitest';

import { searchQuerySchema } from './index.js';

describe('search contracts', () => {
  it('normalise une recherche valide', () => {
    expect(searchQuerySchema.parse({ q: '  shampoing ' })).toEqual({ q: 'shampoing' });
  });

  it('refuse une recherche trop courte', () => {
    expect(() => searchQuerySchema.parse({ q: 'a' })).toThrow();
  });
});
