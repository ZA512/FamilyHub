import { describe, expect, it } from 'vitest';

import { shoppingItemCreateSchema, shoppingItemUpdateSchema } from './index.js';

describe('shopping item contracts', () => {
  it('normalise les champs facultatifs vides', () => {
    const result = shoppingItemCreateSchema.parse({
      name: '  Pommes  ',
      quantity: ' ',
      note: null,
      clientMutationId: '1f5fb7e5-8851-4a83-8a83-11e0fc5857b4',
    });

    expect(result).toEqual({
      name: 'Pommes',
      quantity: null,
      note: null,
      clientMutationId: '1f5fb7e5-8851-4a83-8a83-11e0fc5857b4',
    });
  });

  it('refuse une création sans nom', () => {
    expect(() =>
      shoppingItemCreateSchema.parse({
        name: ' ',
        clientMutationId: '1f5fb7e5-8851-4a83-8a83-11e0fc5857b4',
      }),
    ).toThrow();
  });

  it('refuse une mise à jour vide', () => {
    expect(() => shoppingItemUpdateSchema.parse({})).toThrow();
  });
});
