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

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function setup(
  role = 'ADMIN',
  instanceId = 'household',
  store = new Map<string, Set<string>>(),
) {
  const disabled = store.get(instanceId) ?? new Set<string>();
  store.set(instanceId, disabled);
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
    if (sql.includes('to_char(now()'))
      return { rows: [{ date, refreshAt, disabledIds: [...disabled] }] };
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
  return { app, query, disabled, get, change };
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
    expect(query.mock.calls.some(([sql]) => /INSERT|DELETE/.test(sql))).toBe(false);
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
    expect((await change(today.id, true)).json().dailyJoke).toEqual(today);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM disabled_joke'), [
      'household',
      today.id,
    ]);
  });

  it('isole les décisions entre foyers et garde un choix stable pour les autres désactivations', async () => {
    const store = new Map<string, Set<string>>();
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
});
