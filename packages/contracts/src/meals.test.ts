import { describe, expect, it } from 'vitest';

import {
  mealCreateSchema,
  mealPlanCreateSchema,
  mealPlanRangeSchema,
  mealToShoppingSchema,
} from './index.js';

describe('meal contracts', () => {
  it('accepts a complete meal', () => {
    expect(
      mealCreateSchema.safeParse({
        name: 'Curry de pois chiches',
        description: 'Doux et rapide',
        referencePortions: 4,
        ingredients: [
          { name: 'Pois chiches', quantity: 400, unit: 'g' },
          { name: 'Lait de coco', quantity: 40, unit: 'cl' },
        ],
        tags: ['Végétarien', 'Rapide'],
        visibility: 'ALL_MEMBERS',
        clientMutationId: 'c50c8ae4-e704-4d5f-87b3-17b83d4eb55e',
      }).success,
    ).toBe(true);
  });

  it('rejects a meal without ingredients', () => {
    expect(
      mealCreateSchema.safeParse({
        name: 'Plat vide',
        referencePortions: 4,
        ingredients: [],
        tags: [],
        clientMutationId: 'c50c8ae4-e704-4d5f-87b3-17b83d4eb55e',
      }).success,
    ).toBe(false);
  });

  it('bounds meal-plan queries to 62 days', () => {
    expect(mealPlanRangeSchema.safeParse({ start: '2026-09-01', end: '2026-10-01' }).success).toBe(
      true,
    );
    expect(mealPlanRangeSchema.safeParse({ start: '2026-01-01', end: '2026-12-31' }).success).toBe(
      false,
    );
  });

  it('validates planning and shopping payloads', () => {
    expect(
      mealPlanCreateSchema.safeParse({
        mealId: '9fc75ff0-313d-4ac8-bbc1-00635c44c753',
        date: '2026-09-12',
        slot: 'DINNER',
        portions: 6,
        clientMutationId: 'c50c8ae4-e704-4d5f-87b3-17b83d4eb55e',
      }).success,
    ).toBe(true);
    expect(
      mealToShoppingSchema.safeParse({
        portions: 6,
        items: [
          {
            ingredientId: 'ae22a7ce-55f6-491e-92f9-1998a6509828',
            clientMutationId: '46992a21-b725-45dd-898a-1436287fd72c',
          },
        ],
      }).success,
    ).toBe(true);
  });
});
