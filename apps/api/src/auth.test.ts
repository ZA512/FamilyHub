import cookie from '@fastify/cookie';
import { loadConfig } from '@familyhub/config';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearSessionCookie,
  createSession,
  createSessionGuard,
  digest,
  SESSION_COOKIE,
} from './auth.js';

const config = loadConfig({
  DATABASE_URL: 'postgresql://familyhub:test-password@localhost/familyhub',
  SESSION_SECRET: 'a'.repeat(32),
  SETUP_TOKEN: 'b'.repeat(32),
  FAMILYHUB_ORIGIN: 'https://familyhub.example',
  SESSION_TTL_HOURS: '8760',
});
const sessionRow = {
  session_id: 'session-id',
  csrf_hash: digest('csrf-token'),
  member_id: 'member-id',
  user_id: 'user-id',
  instance_id: 'instance-id',
  instance_name: 'Foyer',
  first_name: 'Jade',
  email: 'jade@example.test',
  role: 'MEMBER',
  locale: 'fr',
  avatar_attachment_id: null,
};
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function setup(rows = [sessionRow]) {
  const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows }));
  const pool = { query } as unknown as Pool;
  const app = Fastify();
  apps.push(app);
  app.decorate('config', config);
  app.decorateRequest('session', undefined);
  await app.register(cookie);
  const requireSession = createSessionGuard(pool);
  app.route({
    method: ['GET', 'POST'],
    url: '/protected',
    preHandler: requireSession,
    handler: async (request) => ({ memberId: request.session!.id }),
  });
  app.post('/logout', { preHandler: requireSession }, async (_request, reply) => {
    clearSessionCookie(reply, config);
    return reply.code(204).send();
  });
  return { app, pool, query };
}

describe('sessions à expiration glissante', () => {
  it('crée une session valable 365 jours', async () => {
    const { pool, query } = await setup();
    const before = Date.now();
    const session = await createSession(pool, 'member-id', config);
    const ttl = 365 * 24 * 60 * 60 * 1000;
    expect(session.expiresAt.getTime()).toBeGreaterThanOrEqual(before + ttl);
    expect(session.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + ttl);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO session'), [
      'member-id',
      digest(session.token),
      digest(session.csrfToken),
      session.expiresAt,
    ]);
  });

  it('repousse l’expiration en base et renouvelle le cookie à chaque requête authentifiée', async () => {
    const { app, query } = await setup();
    for (const method of ['GET', 'POST'] as const) {
      const response = await app.inject({
        method,
        url: '/protected',
        cookies: {
          [SESSION_COOKIE]: 'existing-session-token',
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ memberId: 'member-id' });
      expect(response.cookies).toEqual([
        expect.objectContaining({
          name: SESSION_COOKIE,
          value: 'existing-session-token',
          maxAge: 31_536_000,
          path: '/',
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        }),
      ]);
    }
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining(
        "SET expires_at = now() + ($2::double precision * interval '1 hour')",
      ),
      [digest('existing-session-token'), 8760],
    );
    expect(query.mock.calls[0]![0]).toContain('last_seen_at = now()');
  });

  it('refuse les sessions expirées, révoquées ou les membres désactivés et efface le cookie', async () => {
    const { app, query } = await setup([]);
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      cookies: {
        [SESSION_COOKIE]: 'invalid-session-token',
      },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'AUTHENTICATION_REQUIRED' });
    expect(response.cookies).toEqual([
      expect.objectContaining({ name: SESSION_COOKIE, value: '', maxAge: 0 }),
    ]);
    const sql = query.mock.calls[0]![0];
    expect(sql).toContain('s.revoked_at IS NULL');
    expect(sql).toContain('s.expires_at > now()');
    expect(sql).toContain("m.status = 'ACTIVE'");
  });

  it('n’accède pas à la base en l’absence de cookie', async () => {
    const { app, query } = await setup();
    const response = await app.inject({ method: 'GET', url: '/protected' });
    expect(response.statusCode).toBe(401);
    expect(response.cookies).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('laisse la déconnexion effacer le cookie renouvelé par le garde de session', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/logout',
      cookies: {
        [SESSION_COOKIE]: 'existing-session-token',
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.cookies).toEqual([
      expect.objectContaining({ name: SESSION_COOKIE, value: '', maxAge: 0 }),
    ]);
  });
});
