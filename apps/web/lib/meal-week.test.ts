import { describe, expect, it } from 'vitest';

import { normalizeWeekStartsOn, startOfMealWeek } from './meal-week';

describe('meal planning week', () => {
  it('defaults invalid settings to Monday', () => {
    expect(normalizeWeekStartsOn(undefined)).toBe(1);
    expect(normalizeWeekStartsOn(null)).toBe(1);
    expect(normalizeWeekStartsOn(7)).toBe(1);
  });

  it('starts a Saturday-to-Friday planning week on Saturday', () => {
    expect(startOfMealWeek(new Date(2026, 8, 14), 6)).toEqual(
      new Date(2026, 8, 12),
    );
    expect(startOfMealWeek(new Date(2026, 8, 18), 6)).toEqual(
      new Date(2026, 8, 12),
    );
    expect(startOfMealWeek(new Date(2026, 8, 19), 6)).toEqual(
      new Date(2026, 8, 19),
    );
  });

  it('preserves the existing Monday default', () => {
    expect(startOfMealWeek(new Date(2026, 8, 20), 1)).toEqual(
      new Date(2026, 8, 14),
    );
  });
});
