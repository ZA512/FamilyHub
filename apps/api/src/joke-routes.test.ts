import cookie from '@fastify/cookie';
import { loadConfig } from '@familyhub/config';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { digest } from './auth.js';
import { dailyJoke, jokeCatalog } from './daily-joke.js';
import { registerJokeRoutes } from './joke-routes.js';

const apps: FastifyInstance[] = [];
const date = '2026-10-30';
const refreshAt = new Date('2026-10-30T23:00:00Z');
const today = dailyJoke(date, refreshAt)!;
type Selection = { date: string; jokeId: string; previousJokeId: string | null };
type HouseholdState = { disabled: Set<string>; selection: Selection | null };

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function setup(
  role = 'ADMIN',
  instanceId = 'household',
  store = new Map<string, HouseholdState>(),
) {
  const state = store.get(instanceId) ?? { disabled: new Set<string>(), selection: null };
  const { disabled } = state;
  store.set(instanceId, state);
  const clock = { date, refreshAt };
  const query = vi.fn(async (sql: string, values: unknown[] = []): Promise<{ rows: object[] }> => {
    if (sql.includes('UPDATE session'))
      return {
        rows: [
          {
            session_id: 'session',
            member_id: 'admin',
            instance_id: instanceId,
            role,
            locale: 'fr',
            csrf_hash: digest('csrf-token'),
          },
        ],
      };
    if (sql.includes('to_char(now()')) {
      const previousDate = new Date(Date.parse(`${clock.date}T00:00:00Z`) - 86_400_000)
        .toISOString()
        .slice(0, 10);
      return {
        rows: [
          {
            ...clock,
            previousDate,
            disabledIds: [...disabled],
            selectionDate: state.selection?.date ?? null,
            selectedJokeId: state.selection?.jokeId ?? null,
            previousJokeId: state.selection?.previousJokeId ?? null,
          },
        ],
      };
    }
    if (sql.includes('INSERT INTO daily_joke_selection')) {
      if (
        state.selection &&
        (state.selection.date !== values[4] || state.selection.jokeId !== values[5])
      )
        return { rows: [] };
      state.selection = {
        date: values[1] as string,
        jokeId: values[2] as string,
        previousJokeId: values[3] as string | null,
      };
      return { rows: [{ joke_id: state.selection.jokeId }] };
    }
    if (sql.includes('INSERT INTO disabled_joke')) disabled.add(values[1] as string);
    if (sql.includes('DELETE FROM disabled_joke')) disabled.delete(values[1] as string);
    return { rows: [] };
  });
  const app = Fastify();
  apps.push(app);
  app.decorate(
    'config',
    loadConfig({
      DATABASE_URL: 'postgresql://familyhub:test-password@localhost/familyhub',
      SESSION_SECRET: 'a'.repeat(32),
      SETUP_TOKEN: 'b'.repeat(32),
    }),
  );
  app.decorateRequest('session', undefined);
  await app.register(cookie);
  await registerJokeRoutes(app, { query } as unknown as Pool);
  const cookies = { familyhub_session: 'session-token' };
  const get = (url = '/api/v1/admin/jokes') => app.inject({ method: 'GET', url, cookies });
  const change = (id = today.id, enabled: unknown = false, csrf = 'csrf-token') =>
    app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/jokes/${id}`,
      cookies,
      headers: { 'x-csrf-token': csrf },
      payload: { enabled },
    });
  return { app, query, disabled, get, change, clock, state };
}

describe('modération des blagues', () => {
  it('exige une session et réserve le catalogue et les modifications aux administrateurs', async () => {
    const { app, query, get, change } = await setup('MEMBER');
    for (const url of ['/api/v1/admin/jokes', '/api/v1/jokes/daily']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    }
    expect(query).not.toHaveBeenCalled();
    expect((await get()).statusCode).toBe(403);
    expect((await change()).statusCode).toBe(403);
    expect((await get('/api/v1/jokes/daily')).json()).toEqual({ dailyJoke: today });
    expect(query.mock.calls.some(([sql]) => /INSERT INTO disabled_joke|DELETE/.test(sql))).toBe(
      false,
    );
  });

  it('exige le jeton CSRF et refuse les identifiants et états invalides', async () => {
    const { change, disabled } = await setup();
    expect((await change(today.id, false, '')).statusCode).toBe(403);
    expect((await change('unknown')).statusCode).toBe(404);
    expect((await change(today.id, 'false')).statusCode).toBe(400);
    expect(disabled.size).toBe(0);
  });

  it('remplace immédiatement la blague du jour, persiste la désactivation et permet de la réactiver', async () => {
    const { get, change, query } = await setup();
    const response = await change();
    expect(response.statusCode).toBe(200);
    expect(response.json().joke).toMatchObject({ id: today.id, enabled: false });
    const replacement = response.json().dailyJoke;
    expect(replacement.id).not.toBe(today.id);
    expect(replacement.date).toBe(date);
    expect((await get('/api/v1/jokes/daily')).json().dailyJoke).toEqual(replacement);
    const catalog = (await get()).json();
    expect(catalog.jokes).toHaveLength(jokeCatalog.length);
    expect(catalog.jokes.find((joke: { id: string }) => joke.id === today.id).enabled).toBe(false);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO disabled_joke'), [
      'household',
      today.id,
      'admin',
    ]);
    expect((await change(today.id, true)).json().dailyJoke).toEqual(replacement);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM disabled_joke'), [
      'household',
      today.id,
    ]);
  });

  it('isole les décisions entre foyers et garde un choix stable pour les autres désactivations', async () => {
    const store = new Map<string, HouseholdState>();
    const first = await setup('ADMIN', 'first-household', store);
    const second = await setup('ADMIN', 'second-household', store);
    const other = jokeCatalog.find((joke) => joke.id !== today.id)!;
    expect((await first.change(other.id)).json().dailyJoke).toEqual(today);
    await first.change();
    expect((await second.get('/api/v1/jokes/daily')).json().dailyJoke).toEqual(today);
    const replacement = (await first.get('/api/v1/jokes/daily')).json().dailyJoke;
    const anotherAdmin = await setup('ADMIN', 'first-household', store);
    expect((await anotherAdmin.get('/api/v1/jokes/daily')).json().dailyJoke).toEqual(replacement);
  });

  it('renvoie une absence de blague lorsque toutes sont désactivées', async () => {
    const { disabled, get } = await setup();
    for (const joke of jokeCatalog) disabled.add(joke.id);
    const response = await get('/api/v1/jokes/daily');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({ dailyJoke: null });
  });

  it('change à minuit après une ou plusieurs remplacements la veille', async () => {
    const { get, change, clock } = await setup();
    let last = (await get('/api/v1/jokes/daily')).json().dailyJoke;
    for (let index = 0; index < 3; index++) {
      last = (await change(last.id)).json().dailyJoke;
    }
    clock.date = '2026-10-31';
    clock.refreshAt = new Date('2026-10-31T23:00:00Z');
    const next = (await get('/api/v1/jokes/daily')).json().dailyJoke;
    expect(next.id).not.toBe(last.id);
    expect(next.date).toBe('2026-10-31');
    expect((await get()).json().dailyJoke).toEqual(next);
    expect((await get('/api/v1/jokes/daily')).json().dailyJoke).toEqual(next);
  });

  it('évite aussi la répétition lors de la première lecture après la mise à jour', async () => {
    const { get, disabled, clock, state } = await setup();
    disabled.add(today.id);
    const yesterdayReplacement = dailyJoke(date, refreshAt, disabled)!;
    clock.date = '2026-10-31';
    expect(state.selection).toBeNull();
    const next = (await get('/api/v1/jokes/daily')).json().dailyJoke;
    expect(next.id).not.toBe(yesterdayReplacement.id);
  });

  it('ne réaffiche pas celle d’hier si l’administrateur désactive celle d’aujourd’hui', async () => {
    const { get, change, clock, state, disabled } = await setup();
    const previous = (await get('/api/v1/jokes/daily')).json().dailyJoke;
    clock.date = '2026-10-31';
    const next = (await get('/api/v1/jokes/daily')).json().dailyJoke;
    for (const joke of jokeCatalog) {
      if (![previous.id, next.id].includes(joke.id)) disabled.add(joke.id);
    }
    const third = jokeCatalog.find((joke) => ![previous.id, next.id].includes(joke.id))!;
    disabled.delete(third.id);
    const replacement = (await change(next.id)).json().dailyJoke;
    expect(replacement.id).toBe(third.id);
    expect(state.selection?.previousJokeId).toBe(previous.id);
  });

  it('garde un choix commun lors de chargements simultanés à minuit et après redémarrage', async () => {
    const store = new Map<string, HouseholdState>();
    const first = await setup('ADMIN', 'household', store);
    const previous = (await first.get('/api/v1/jokes/daily')).json().dailyJoke;
    first.clock.date = '2026-10-31';
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => first.get('/api/v1/jokes/daily')),
    );
    const ids = responses.map((response) => response.json().dailyJoke.id);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).not.toBe(previous.id);
    const restarted = await setup('ADMIN', 'household', store);
    restarted.clock.date = '2026-10-31';
    expect((await restarted.get('/api/v1/jokes/daily')).json().dailyJoke.id).toBe(ids[0]);
  });

  it('alterne quand il ne reste que deux blagues actives et retrouve le catalogue après réactivation', async () => {
    const { get, clock, disabled } = await setup();
    const active = jokeCatalog.slice(0, 2);
    for (const joke of jokeCatalog.slice(2)) disabled.add(joke.id);
    const ids: string[] = [];
    for (let day = 0; day < 6; day++) {
      clock.date = new Date(Date.UTC(2026, 9, 30 + day)).toISOString().slice(0, 10);
      ids.push((await get('/api/v1/jokes/daily')).json().dailyJoke.id);
      if (day) expect(ids[day]).not.toBe(ids[day - 1]);
    }
    expect(new Set(ids)).toEqual(new Set(active.map((joke) => joke.id)));
    for (const joke of active) disabled.add(joke.id);
    expect((await get('/api/v1/jokes/daily')).json().dailyJoke).toBeNull();
    disabled.delete(active[0]!.id);
    expect((await get('/api/v1/jokes/daily')).json().dailyJoke.id).toBe(active[0]!.id);
  });
});
