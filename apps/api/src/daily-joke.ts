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
  rotation: { afterId?: string | null; excludedId?: string | null } = {},
): HomeDailyJoke | null {
  // The input is a civil date from PostgreSQL in the household's timezone.
  // Counting dates in UTC keeps each step at one day, including DST changes.
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  const previousIndex = jokeCatalog.findIndex((joke) => joke.id === rotation.afterId);
  const index =
    previousIndex >= 0
      ? (previousIndex + 1) % jokes.length
      : ((day % jokes.length) + jokes.length) % jokes.length;
  let fallback: HomeDailyJoke | null = null;
  for (let offset = 0; offset < jokeCatalog.length; offset++) {
    const joke = jokeCatalog[(index + offset) % jokeCatalog.length]!;
    if (disabledIds.has(joke.id)) continue;
    const candidate = { ...joke, date, refreshAt: refreshAt.toISOString() };
    if (joke.id !== rotation.excludedId) return candidate;
    fallback = candidate;
  }
  // With only one active joke, a different choice is impossible.
  return fallback;
}

export async function readJokeState(pool: Pool, instanceId: string) {
  for (;;) {
    const result = await pool.query<{
      date: string;
      previousDate: string;
      refreshAt: Date;
      disabledIds: string[];
      selectionDate: string | null;
      selectedJokeId: string | null;
      previousJokeId: string | null;
    }>(
      `SELECT to_char(now() AT TIME ZONE i.timezone, 'YYYY-MM-DD') AS date,
              to_char((now() AT TIME ZONE i.timezone)::date - 1, 'YYYY-MM-DD') AS "previousDate",
              (((now() AT TIME ZONE i.timezone)::date + 1)::timestamp
                AT TIME ZONE i.timezone) AS "refreshAt",
              ARRAY(SELECT joke_id FROM disabled_joke WHERE instance_id = $1) AS "disabledIds",
              to_char(s.selected_date, 'YYYY-MM-DD') AS "selectionDate",
              s.joke_id AS "selectedJokeId", s.previous_joke_id AS "previousJokeId"
       FROM instance i
       LEFT JOIN daily_joke_selection s ON s.instance_id = i.id
       WHERE i.id = $1`,
      [instanceId],
    );
    const row = result.rows[0];
    const disabledIds = new Set(row?.disabledIds ?? []);
    if (!row) return { disabledIds, dailyJoke: null };
    const current = jokeCatalog.find((joke) => joke.id === row.selectedJokeId);
    if (row.selectionDate === row.date && current && !disabledIds.has(current.id)) {
      return {
        disabledIds,
        dailyJoke: { ...current, date: row.date, refreshAt: row.refreshAt.toISOString() },
      };
    }

    // On the first run after the upgrade, reconstruct yesterday's legacy choice
    // to avoid repeating a replacement that was already shown before this table existed.
    const previousJokeId =
      row.selectionDate === row.date
        ? row.previousJokeId
        : (row.selectedJokeId ??
          dailyJoke(row.previousDate, row.refreshAt, disabledIds)?.id ??
          null);
    const next = dailyJoke(row.date, row.refreshAt, disabledIds, {
      afterId: row.selectedJokeId,
      excludedId: previousJokeId,
    });
    if (!next) return { disabledIds, dailyJoke: null };

    // Compare-and-set: simultaneous requests must agree on a single choice.
    // A request that loses the race reads the winner instead of advancing again.
    const saved = await pool.query(
      `INSERT INTO daily_joke_selection (instance_id, selected_date, joke_id, previous_joke_id)
       VALUES ($1, $2::date, $3, $4)
       ON CONFLICT (instance_id) DO UPDATE
       SET selected_date = EXCLUDED.selected_date, joke_id = EXCLUDED.joke_id,
           previous_joke_id = EXCLUDED.previous_joke_id
       WHERE daily_joke_selection.selected_date IS NOT DISTINCT FROM $5::date
         AND daily_joke_selection.joke_id IS NOT DISTINCT FROM $6::text
       RETURNING joke_id`,
      [instanceId, row.date, next.id, previousJokeId, row.selectionDate, row.selectedJokeId],
    );
    if (saved.rows.length) return { disabledIds, dailyJoke: next };
  }
}
