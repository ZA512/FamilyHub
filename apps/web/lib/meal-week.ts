import type { WeekStartsOn } from '@familyhub/contracts';

export function normalizeWeekStartsOn(value: unknown): WeekStartsOn {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 6
    ? value
    : 1;
}

export function startOfMealWeek(date: Date, weekStartsOn: WeekStartsOn): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysSinceStart = (result.getDay() - weekStartsOn + 7) % 7;
  result.setDate(result.getDate() - daysSinceStart);
  return result;
}
