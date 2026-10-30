import type { HomeDailyJoke } from '@familyhub/contracts';

import jokes from './content/jokes.json' with { type: 'json' };

export function dailyJoke(date: string, refreshAt: Date): HomeDailyJoke {
  // The input is a civil date from PostgreSQL in the household's timezone.
  // Counting dates in UTC keeps each step at one day, including DST changes.
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  const index = ((day % jokes.length) + jokes.length) % jokes.length;
  const joke = jokes[index]!;
  return { ...joke, date, refreshAt: refreshAt.toISOString() };
}
