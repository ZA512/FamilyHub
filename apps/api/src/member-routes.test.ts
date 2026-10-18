import cookie from '@fastify/cookie';
import { loadConfig } from '@familyhub/config';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { digest, SESSION_COOKIE } from './auth.js';
import { registerMemberRoutes } from './member-routes.js';
import { verifyPassword } from './password.js';

const instanceId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const memberId = '33333333-3333-4333-8333-333333333333';
const userId = '44444444-4444-4444-8444-444444444444';
const password = 'Nouveau mot de passe familial';
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function setup(role: 'ADMIN' | 'MEMBER' = 'ADMIN') {
  const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] as object[] }));
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  const sessionQuery = vi.fn(async () => ({
    rows: [
      {
        session_id: 'session-id',
        csrf_hash: digest('csrf-token'),
        member_id: actorId,
        user_id: 'admin-user-id',
        instance_id: instanceId,
        instance_name: 'Foyer',
        first_name: 'Admin',
        email: 'admin@example.test',
        role,
        locale: 'fr',
        avatar_attachment_id: null,
      },
    ],
  }));
  const pool = { query: sessionQuery, connect } as unknown as Pool;
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
  await registerMemberRoutes(app, pool);

  function changePassword(payload: object = { password }, id = memberId, csrf = 'csrf-token') {
    return app.inject({
      method: 'PUT',
      url: `/api/v1/members/${id}/password`,
      cookies: { [SESSION_COOKIE]: 'admin-session' },
      headers: { 'x-csrf-token': csrf },
      payload,
    });
  }

  return { app, query, release, connect, sessionQuery, changePassword };
}

describe('administration des mots de passe des membres', () => {
  it('exige une session authentifiée', async () => {
    const { app, connect } = await setup();
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/members/${memberId}/password`,
      payload: { password },
    });
    expect(response.statusCode).toBe(401);
    expect(connect).not.toHaveBeenCalled();
  });

  it('refuse un membre non administrateur', async () => {
    const { changePassword, connect } = await setup('MEMBER');
    const response = await changePassword();
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'ADMIN_REQUIRED' });
    expect(connect).not.toHaveBeenCalled();
  });

  it('refuse un jeton CSRF incorrect', async () => {
    const { changePassword, connect } = await setup();
    const response = await changePassword({ password }, memberId, 'incorrect');
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'CSRF_TOKEN_INVALID' });
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([{}, { password: 'trop court' }, { password: 'a'.repeat(201) }])(
    'refuse un mot de passe invalide : %j',
    async (payload) => {
      const { changePassword, connect } = await setup();
      expect((await changePassword(payload)).statusCode).toBe(400);
      expect(connect).not.toHaveBeenCalled();
    },
  );

  it('refuse un identifiant invalide', async () => {
    const { changePassword, connect } = await setup();
    expect((await changePassword({ password }, 'incorrect')).statusCode).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });

  it('limite la modification au foyer et refuse un membre absent ou appartenant à un autre foyer', async () => {
    const { changePassword, query, release } = await setup();
    const response = await changePassword();
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'MEMBER_NOT_FOUND' });
    expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('m.instance_id = $3'), [
      expect.any(String),
      memberId,
      instanceId,
    ]);
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM session'),
      expect.anything(),
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it('enregistre un hachage Argon2, révoque les sessions du compte et audite sans secret dans une transaction', async () => {
    const { changePassword, query, release } = await setup();
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: userId }] });
    const response = await changePassword();
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    const storedHash = query.mock.calls[1]![1]![0] as string;
    expect(storedHash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(storedHash, password)).toBe(true);
    expect(await verifyPassword(storedHash, 'Ancien mot de passe')).toBe(false);
    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(query).toHaveBeenNthCalledWith(3, expect.stringContaining('WHERE user_id = $1'), [
      userId,
    ]);
    const audit = query.mock.calls[3]!;
    expect(audit[0]).toContain('member.password_updated');
    expect(audit[1]).toEqual([instanceId, actorId, memberId]);
    expect(JSON.stringify(audit)).not.toContain(storedHash);
    expect(JSON.stringify(query.mock.calls)).not.toContain(password);
    expect(query).toHaveBeenLastCalledWith('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it.each([3, 4])(
    'annule le changement si la requête %i (révocation ou audit) échoue',
    async (failedQuery) => {
      const { changePassword, query, release } = await setup();
      query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: userId }] });
      if (failedQuery === 4) query.mockResolvedValueOnce({ rows: [] });
      query.mockRejectedValueOnce(new Error('Database unavailable'));
      expect((await changePassword()).statusCode).toBe(500);
      expect(query).toHaveBeenLastCalledWith('ROLLBACK');
      expect(query).not.toHaveBeenCalledWith('COMMIT');
      expect(release).toHaveBeenCalledOnce();
    },
  );
});
