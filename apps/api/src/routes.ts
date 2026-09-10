import {
  essentialModuleKeys,
  functionalModuleKeys,
  loginRequestSchema,
  moduleKeySchema,
  moduleUpdateSchema,
  setupRequestSchema,
  type ModuleConfig,
} from '@familyhub/contracts';
import type { AppConfig } from '@familyhub/config';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

import {
  clearSessionCookie,
  constantTimeEqual,
  createSession,
  createSessionGuard,
  deriveCsrfToken,
  digest,
  requireCsrf,
  SESSION_COOKIE,
  setSessionCookie,
} from './auth.js';
import { registerMemberRoutes } from './member-routes.js';
import { registerInvitationRoutes } from './invitation-routes.js';
import { registerNotificationRoutes } from './notification-routes.js';
import { hashPassword, verifyPassword } from './password.js';
import { registerProfileRoutes } from './profile-routes.js';
import { registerSearchRoutes } from './search-routes.js';
import { registerShoppingRoutes } from './shopping-routes.js';

export async function registerRoutes(app: FastifyInstance, pool: Pool, config: AppConfig) {
  const requireSession = createSessionGuard(pool);
  const dummyPasswordHash = await hashPassword('familyhub-password-verification-placeholder');

  app.get('/api/v1/health/live', async () => ({ status: 'ok' }));

  app.get('/api/v1/health/ready', async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  app.get('/api/v1/setup/status', async () => {
    const result = await pool.query<{ configured: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM instance) AS configured',
    );
    return { configured: result.rows[0]?.configured ?? false };
  });

  app.post(
    '/api/v1/setup',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const parsed = setupRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'INVALID_REQUEST', details: parsed.error.flatten() });
      }

      if (!constantTimeEqual(parsed.data.setupToken, config.SETUP_TOKEN)) {
        return reply.code(403).send({ error: 'SETUP_TOKEN_INVALID' });
      }

      const passwordHash = await hashPassword(parsed.data.password);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('LOCK TABLE instance IN EXCLUSIVE MODE');
        const existing = await client.query('SELECT id FROM instance LIMIT 1');
        if (existing.rowCount) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'INSTANCE_ALREADY_CONFIGURED' });
        }

        const instance = await client.query<{ id: string; name: string }>(
          `INSERT INTO instance (name, timezone) VALUES ($1, $2) RETURNING id, name`,
          [parsed.data.instanceName, config.FAMILYHUB_TIMEZONE],
        );
        const instanceRow = instance.rows[0];
        if (!instanceRow) throw new Error('Instance creation returned no row.');

        const user = await client.query<{ id: string }>(
          `INSERT INTO app_user (email, password_hash, first_name, timezone)
         VALUES ($1, $2, $3, $4) RETURNING id`,
          [parsed.data.email, passwordHash, parsed.data.firstName, config.FAMILYHUB_TIMEZONE],
        );
        const userRow = user.rows[0];
        if (!userRow) throw new Error('User creation returned no row.');

        const member = await client.query<{ id: string }>(
          `INSERT INTO instance_member (instance_id, user_id, role)
         VALUES ($1, $2, 'ADMIN') RETURNING id`,
          [instanceRow.id, userRow.id],
        );
        const memberRow = member.rows[0];
        if (!memberRow) throw new Error('Member creation returned no row.');

        const group = await client.query<{ id: string }>(
          `INSERT INTO member_group (instance_id, name, description, is_system)
         VALUES ($1, 'Tout le monde', 'Tous les membres actifs du foyer', true)
         RETURNING id`,
          [instanceRow.id],
        );
        if (group.rows[0]) {
          await client.query('INSERT INTO group_membership (group_id, member_id) VALUES ($1, $2)', [
            group.rows[0].id,
            memberRow.id,
          ]);
        }

        for (const moduleKey of essentialModuleKeys) {
          await client.query(
            'INSERT INTO module_config (instance_id, module_key, enabled) VALUES ($1, $2, true)',
            [instanceRow.id, moduleKey],
          );
        }
        for (const moduleKey of functionalModuleKeys) {
          await client.query(
            'INSERT INTO module_config (instance_id, module_key, enabled) VALUES ($1, $2, $3)',
            [instanceRow.id, moduleKey, !['contacts', 'documents'].includes(moduleKey)],
          );
        }

        await client.query(
          `INSERT INTO admin_audit_log (instance_id, actor_member_id, action, target_type, target_id)
         VALUES ($1, $2, 'instance.created', 'instance', $1)`,
          [instanceRow.id, memberRow.id],
        );

        const session = await createSession(client, memberRow.id, config);
        await client.query('COMMIT');
        setSessionCookie(reply, session.token, config);

        return reply.code(201).send({
          instance: instanceRow,
          member: {
            id: memberRow.id,
            userId: userRow.id,
            instanceId: instanceRow.id,
            instanceName: instanceRow.name,
            firstName: parsed.data.firstName,
            email: parsed.data.email,
            role: 'ADMIN',
          },
          csrfToken: session.csrfToken,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.post(
    '/api/v1/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const parsed = loginRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'INVALID_REQUEST' });
      }

      const result = await pool.query<{
        user_id: string;
        member_id: string;
        instance_id: string;
        instance_name: string;
        email: string;
        first_name: string;
        password_hash: string;
        role: 'ADMIN' | 'MEMBER';
      }>(
        `SELECT u.id AS user_id, m.id AS member_id, m.instance_id, i.name AS instance_name, u.email,
              u.first_name, u.password_hash, m.role
       FROM app_user u
       JOIN instance_member m ON m.user_id = u.id
       JOIN instance i ON i.id = m.instance_id
       WHERE u.email = $1 AND m.status = 'ACTIVE'
       LIMIT 1`,
        [parsed.data.email],
      );

      const row = result.rows[0];
      const passwordValid = await verifyPassword(
        row?.password_hash ?? dummyPasswordHash,
        parsed.data.password,
      );
      if (!row || !passwordValid) {
        return reply.code(401).send({ error: 'INVALID_CREDENTIALS' });
      }

      const session = await createSession(pool, row.member_id, config);
      setSessionCookie(reply, session.token, config);
      return {
        member: {
          id: row.member_id,
          userId: row.user_id,
          instanceId: row.instance_id,
          instanceName: row.instance_name,
          firstName: row.first_name,
          email: row.email,
          role: row.role,
        },
        csrfToken: session.csrfToken,
      };
    },
  );

  app.get('/api/v1/me', { preHandler: requireSession }, async (request) => {
    const session = request.session;
    if (!session) return { member: null };
    const sessionToken = request.cookies[SESSION_COOKIE];
    const csrfToken = sessionToken ? deriveCsrfToken(sessionToken, config) : null;
    if (csrfToken) {
      await pool.query(
        `UPDATE session SET csrf_hash = $1, last_seen_at = now()
         WHERE id = $2 AND csrf_hash <> $1`,
        [digest(csrfToken), session.sessionId],
      );
    }
    return {
      member: {
        id: session.id,
        userId: session.userId,
        instanceId: session.instanceId,
        instanceName: session.instanceName,
        firstName: session.firstName,
        email: session.email,
        role: session.role,
      },
      csrfToken,
    };
  });

  app.post(
    '/api/v1/auth/logout',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (request.session) {
        await pool.query('UPDATE session SET revoked_at = now() WHERE id = $1', [
          request.session.sessionId,
        ]);
      }
      clearSessionCookie(reply, config);
      return reply.code(204).send();
    },
  );

  app.get('/api/v1/modules', { preHandler: requireSession }, async (request) => {
    const result = await pool.query<{ module_key: string; enabled: boolean }>(
      `SELECT module_key, enabled FROM module_config
       WHERE instance_id = $1 ORDER BY module_key`,
      [request.session?.instanceId],
    );
    return {
      modules: result.rows.map(
        (row): ModuleConfig => ({
          key: moduleKeySchema.parse(row.module_key),
          enabled: row.enabled,
        }),
      ),
    };
  });

  app.patch<{ Params: { key: string } }>(
    '/api/v1/modules/:key',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (request.session?.role !== 'ADMIN') {
        return reply.code(403).send({ error: 'ADMIN_REQUIRED' });
      }

      const moduleKey = moduleKeySchema.safeParse(request.params.key);
      if (!moduleKey.success) return reply.code(404).send({ error: 'MODULE_NOT_FOUND' });

      const parsed = moduleUpdateSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      if (
        (essentialModuleKeys as readonly string[]).includes(moduleKey.data) &&
        !parsed.data.enabled
      ) {
        return reply.code(409).send({ error: 'ESSENTIAL_MODULE' });
      }

      const result = await pool.query<{ module_key: string; enabled: boolean }>(
        `UPDATE module_config SET enabled = $1, updated_at = now()
         WHERE instance_id = $2 AND module_key = $3
         RETURNING module_key, enabled`,
        [parsed.data.enabled, request.session.instanceId, moduleKey.data],
      );

      await pool.query(
        `INSERT INTO admin_audit_log
          (instance_id, actor_member_id, action, target_type, details)
         VALUES ($1, $2, 'module.updated', 'module', $3::jsonb)`,
        [
          request.session.instanceId,
          request.session.id,
          JSON.stringify({
            moduleKey: moduleKey.data,
            enabled: parsed.data.enabled,
          }),
        ],
      );

      const row = result.rows[0];
      if (!row) return reply.code(404).send({ error: 'MODULE_NOT_FOUND' });
      return {
        module: {
          key: moduleKey.data,
          enabled: row.enabled,
        } satisfies ModuleConfig,
      };
    },
  );

  await registerInvitationRoutes(app, pool, config);
  await registerMemberRoutes(app, pool);
  await registerNotificationRoutes(app, pool);
  await registerProfileRoutes(app, pool);
  await registerSearchRoutes(app, pool);
  await registerShoppingRoutes(app, pool);
}
