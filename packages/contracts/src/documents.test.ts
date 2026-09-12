import { describe, expect, it } from 'vitest';

import { documentCreateSchema, documentsQuerySchema } from './index.js';

const base = {
  title: '  Assurance habitation ',
  category: ' Administration ',
  attachmentId: '67b7acee-7d64-4198-9e16-71840e922c12',
  clientMutationId: '3afae80e-0f94-44d6-b280-99c21bb80a6f',
};

describe('documents contracts', () => {
  it('normalizes fields and applies sharing defaults', () => {
    const parsed = documentCreateSchema.parse(base);
    expect(parsed.title).toBe('Assurance habitation');
    expect(parsed.category).toBe('Administration');
    expect(parsed.visibility).toBe('ALL_MEMBERS');
    expect(parsed.tags).toEqual([]);
  });

  it('requires an attachment', () => {
    expect(documentCreateSchema.safeParse({ ...base, attachmentId: undefined }).success).toBe(false);
  });

  it('requires the selected audience', () => {
    expect(documentCreateSchema.safeParse({ ...base, visibility: 'GROUPS' }).success).toBe(false);
  });

  it('requires both pagination cursor values', () => {
    expect(documentsQuerySchema.safeParse({ before: new Date().toISOString() }).success).toBe(false);
  });
});
