import { describe, expect, it } from 'vitest';

import { contactCreateSchema, contactsQuerySchema } from './index.js';

const base = {
  firstName: '  Marie ',
  email: ' Marie@EXAMPLE.COM ',
  clientMutationId: '3afae80e-0f94-44d6-b280-99c21bb80a6f',
};

describe('contacts contracts', () => {
  it('normalizes fields and applies safe sharing defaults', () => {
    const parsed = contactCreateSchema.parse(base);
    expect(parsed.firstName).toBe('Marie');
    expect(parsed.email).toBe('marie@example.com');
    expect(parsed.visibility).toBe('ALL_MEMBERS');
    expect(parsed.tags).toEqual([]);
  });

  it('accepts an empty optional email as null', () => {
    expect(contactCreateSchema.parse({ ...base, email: '' }).email).toBeNull();
  });

  it('rejects invalid email addresses', () => {
    expect(contactCreateSchema.safeParse({ ...base, email: 'invalide' }).success).toBe(false);
  });

  it('requires the selected audience', () => {
    expect(contactCreateSchema.safeParse({ ...base, visibility: 'SELECTED_USERS' }).success).toBe(false);
  });

  it('requires both pagination cursor values', () => {
    expect(contactsQuerySchema.safeParse({ before: new Date().toISOString() }).success).toBe(false);
  });
});
