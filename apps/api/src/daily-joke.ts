import { createHash } from 'node:crypto';
import type { HomeDailyJoke } from '@familyhub/contracts';
import type { Pool } from 'pg';

import jokes from './content/jokes.json' with { type: 'json' };

export const jokeCatalog = jokes.map((joke) => ({
  ...joke,
  id: createHash('sha256')
    .update(
      joke.text
        .normalize('NFKC')
        .toLocaleLowerCase('fr')
        .replace(/[’‘]/g, "'")
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .digest('hex'),
}));

export function dailyJoke(
  date: string,
  refreshAt: Date,
  disabledIds: ReadonlySet<string> = new Set(),
): HomeDailyJoke | null {
  // The input is a civil date from PostgreSQL in the household's timezone.
  // Counting dates in UTC keeps each step at one day, including DST changes.
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  const index = ((day % jokes.length) + jokes.length) % jokes.length;
  // Keep today's choice stable when an unrelated joke is disabled. If today's
  // choice is removed, scan forward to the next available joke.
  for (let offset = 0; offset < jokeCatalog.length; offset++) {
    const joke = jokeCatalog[(index + offset) % jokeCatalog.length]!;
    if (!disabledIds.has(joke.id)) return { ...joke, date, refreshAt: refreshAt.toISOString() };
  }
  return null;
}

export async function readJokeState(pool: Pool, instanceId: string) {
  const result = await pool.query<{ date: string; refreshAt: Date; disabledIds: string[] }>(
    `SELECT to_char(now() AT TIME ZONE timezone, 'YYYY-MM-DD') AS date,
            (((now() AT TIME ZONE timezone)::date + 1)::timestamp
              AT TIME ZONE timezone) AS "refreshAt",
            ARRAY(SELECT joke_id FROM disabled_joke WHERE instance_id = $1) AS "disabledIds"
     FROM instance WHERE id = $1`,
    [instanceId],
  );
  const row = result.rows[0];
  const disabledIds = new Set(row?.disabledIds ?? []);
  return { disabledIds, dailyJoke: row ? dailyJoke(row.date, row.refreshAt, disabledIds) : null };
}
