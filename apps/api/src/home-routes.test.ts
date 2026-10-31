import cookie from '@fastify/cookie';
import { loadConfig } from '@familyhub/config';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { dailyJoke } from './daily-joke.js';
import { registerHomeRoutes } from './home-routes.js';

describe('blague dans l’accueil authentifié', () => {
  it('utilise la date et le prochain minuit du foyer fournis par la base', async () => {
    const date = '2026-10-30';
    const refreshAt = new Date('2026-10-30T23:00:00Z');
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('UPDATE session'))
        return {
          rows: [
            {
              session_id: 'session',
              member_id: 'member',
              instance_id: 'household',
              locale: 'fr',
            },
          ],
        };
      if (sql.includes('to_char(now()'))
        return {
          rows: [
            {
              date,
              refreshAt,
              disabledIds: [],
              selectionDate: date,
              selectedJokeId: dailyJoke(date, refreshAt)!.id,
              previousJokeId: null,
            },
          ],
        };
      return { rows: [] };
    });
    const app = Fastify();
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
    await registerHomeRoutes(app, { query } as unknown as Pool);
    try {
      const unauthorized = await app.inject({ method: 'GET', url: '/api/v1/home' });
      expect(unauthorized.statusCode).toBe(401);
      expect(query).not.toHaveBeenCalled();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/home',
        cookies: { familyhub_session: 'test-session' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        dailyJoke: dailyJoke(date, refreshAt),
        todayMeals: [],
        attention: [],
        activity: [],
        unreadNotificationCount: 0,
      });
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('to_char(now() AT TIME ZONE i.timezone'),
        ['household'],
      );
    } finally {
      await app.close();
    }
  });
});
