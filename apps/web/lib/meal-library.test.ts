import { describe, expect, it } from 'vitest';

import type { FamilyMeal, MealListMember } from '@familyhub/contracts';
import { filterMeals } from './meal-library';

const members: MealListMember[] = [
  { id: 'alice', firstName: 'Alice' },
  { id: 'bob', firstName: 'Bob' },
];

const meals = [
  {
    id: 'carbonara',
    name: 'Carbonara',
    ingredients: [
      { id: 'cream', name: 'Crème fraîche', quantity: 1, unit: 'pot' },
    ],
    preferences: [{ memberId: 'alice', memberName: 'Alice', value: 1 }],
  },
  {
    id: 'pizza',
    name: 'Pizza maison',
    ingredients: [
      { id: 'tomato', name: 'Sauce tomate', quantity: 1, unit: 'pot' },
    ],
    preferences: [{ memberId: 'bob', memberName: 'Bob', value: -1 }],
  },
] as FamilyMeal[];

describe('meal library filters', () => {
  it('searches titles and ingredients without accents', () => {
    expect(
      filterMeals(meals, members, {
        query: 'creme fraiche',
        memberId: 'all',
        preference: 'all',
      }).map((meal) => meal.id),
    ).toEqual(['carbonara']);
    expect(
      filterMeals(meals, members, {
        query: 'pizza',
        memberId: 'all',
        preference: 'all',
      }).map((meal) => meal.id),
    ).toEqual(['pizza']);
  });

  it('combines a member and their opinion', () => {
    expect(
      filterMeals(meals, members, {
        query: '',
        memberId: 'alice',
        preference: '1',
      }).map((meal) => meal.id),
    ).toEqual(['carbonara']);
  });

  it('treats a missing opinion as neutral', () => {
    expect(
      filterMeals(meals, members, {
        query: '',
        memberId: 'bob',
        preference: '0',
      }).map((meal) => meal.id),
    ).toEqual(['carbonara']);
  });
});
