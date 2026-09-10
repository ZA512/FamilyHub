import { randomBytes } from 'node:crypto';

import type { AppConfig } from '@familyhub/config';
import {
  invitationAcceptSchema,
  invitationCreateSchema,
  invitationInspectSchema,
  type InvitationPreview,
  type PendingInvitation,
} from '@familyhub/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';

import {
  createSession,
  createSessionGuard,
  digest,
  requireCsrf,
  setSessionCookie,
} from './auth.js';
import { hashPassword } from './password.js';

type InvitationRow = {
  id: string;
  instance_id: string;
  instance_name: string;
  timezone: string;
  email: string;
  role: 'ADMIN' | 'MEMBER';
  expires_at: Date;
};

function requireAdmin(role: 'ADMIN' | 'MEMBER' | undefined, reply: FastifyReply) {
  if (role !== 'ADMIN') {
    return reply.code(403).send({ error: 'ADMIN_REQUIRED' });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function invitationUrl(origin: string, token: string): string {
  const url = new URL(origin);
  url.searchParams.set('invite', token);
  return url.toString();
}

export async function registerInvitationRoutes(
  app: FastifyInstance,
  pool: Pool,
  config: AppConfig,
) {
  const requireSession = createSessionGuard(pool);

  app.get('/api/v1/members/invitations', { preHandler: requireSession }, async (request, reply) => {
    const denied = requireAdmin(request.session?.role, reply);
    if (denied) return denied;

    const result = await pool.query<{
      id: string;
      email: string;
      role: 'ADMIN' | 'MEMBER';
      expires_at: Date;
      created_at: Date;
    }>(
      `SELECT id, email, role, expires_at, created_at
         FROM invite
         WHERE instance_id = $1
           AND consumed_at IS NULL
           AND revoked_at IS NULL
           AND expires_at > now()
         ORDER BY created_at DESC`,
      [request.session?.instanceId],
    );

    return {
      invitations: result.rows.map(
        (row): PendingInvitation => ({
          id: row.id,
          email: row.email,
          role: row.role,
          expiresAt: row.expires_at.toISOString(),
          createdAt: row.created_at.toISOString(),
        }),
      ),
    };
  });

  app.post(
    '/api/v1/members/invitations',
    {
      preHandler: [requireSession, requireCsrf],
      config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      const denied = requireAdmin(request.session?.role, reply);
      if (denied) return denied;

      const parsed = invitationCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'INVALID_REQUEST', details: parsed.error.flatten() });
      }

      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const existing = await client.query(
          `SELECT 1 FROM app_user u
           JOIN instance_member m ON m.user_id = u.id
           WHERE m.instance_id = $1 AND u.email = $2
           LIMIT 1`,
          [request.session?.instanceId, parsed.data.email],
        );
        if (existing.rowCount) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'MEMBER_ALREADY_EXISTS' });
        }

        await client.query(
          `UPDATE invite SET revoked_at = now()
           WHERE instance_id = $1 AND email = $2
             AND consumed_at IS NULL AND revoked_at IS NULL`,
          [request.session?.instanceId, parsed.data.email],
        );

        const result = await client.query<{
          id: string;
          email: string;
          role: 'ADMIN' | 'MEMBER';
          expires_at: Date;
          created_at: Date;
        }>(
          `INSERT INTO invite
             (instance_id, email, role, token_hash, expires_at, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, email, role, expires_at, created_at`,
          [
            request.session?.instanceId,
            parsed.data.email,
            parsed.data.role,
            digest(token),
            expiresAt,
            request.session?.id,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new Error('Invitation creation returned no row.');

        await client.query(
          `INSERT INTO admin_audit_log
             (instance_id, actor_member_id, action, target_type, target_id, details)
           VALUES ($1, $2, 'invitation.created', 'invitation', $3, $4::jsonb)`,
          [
            request.session?.instanceId,
            request.session?.id,
            row.id,
            JSON.stringify({ email: row.email, role: row.role }),
          ],
        );
        await client.query('COMMIT');

        return reply.code(201).send({
          invitation: {
            id: row.id,
            email: row.email,
            role: row.role,
            expiresAt: row.expires_at.toISOString(),
            createdAt: row.created_at.toISOString(),
          } satisfies PendingInvitation,
          inviteUrl: invitationUrl(config.FAMILYHUB_ORIGIN, token),
        });
      } catch (error) {
        await client.query('ROLLBACK');
        if (isUniqueViolation(error)) {
          return reply.code(409).send({ error: 'INVITATION_CONFLICT' });
        }
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.post(
    '/api/v1/invitations/inspect',
    { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const parsed = invitationInspectSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });

      const invitation = await findInvitation(pool, parsed.data.token);
      if (!invitation) return reply.code(404).send({ error: 'INVITATION_INVALID' });

      return {
        invitation: {
          instanceName: invitation.instance_name,
          email: invitation.email,
          role: invitation.role,
          expiresAt: invitation.expires_at.toISOString(),
        } satisfies InvitationPreview,
      };
    },
  );

  app.post(
    '/api/v1/invitations/accept',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const parsed = invitationAcceptSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'INVALID_REQUEST', details: parsed.error.flatten() });
      }

      const preview = await findInvitation(pool, parsed.data.token);
      if (!preview) return reply.code(404).send({ error: 'INVITATION_INVALID' });
      const passwordHash = await hashPassword(parsed.data.password);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const locked = await client.query<InvitationRow>(
          `SELECT inv.id, inv.instance_id, i.name AS instance_name, i.timezone,
                  inv.email, inv.role, inv.expires_at
           FROM invite inv
           JOIN instance i ON i.id = inv.instance_id
           WHERE inv.token_hash = $1
             AND inv.consumed_at IS NULL
             AND inv.revoked_at IS NULL
             AND inv.expires_at > now()
           FOR UPDATE OF inv`,
          [digest(parsed.data.token)],
        );
        const invitation = locked.rows[0];
        if (!invitation) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'INVITATION_INVALID' });
        }

        const user = await client.query<{ id: string }>(
          `INSERT INTO app_user
             (email, password_hash, first_name, last_name, timezone)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [
            invitation.email,
            passwordHash,
            parsed.data.firstName,
            parsed.data.lastName ?? null,
            invitation.timezone,
          ],
        );
        const userId = user.rows[0]?.id;
        if (!userId) throw new Error('User creation returned no row.');

        const member = await client.query<{ id: string }>(
          `INSERT INTO instance_member (instance_id, user_id, role)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [invitation.instance_id, userId, invitation.role],
        );
        const memberId = member.rows[0]?.id;
        if (!memberId) throw new Error('Member creation returned no row.');

        await client.query(
          `INSERT INTO group_membership (group_id, member_id)
           SELECT id, $2 FROM member_group
           WHERE instance_id = $1 AND is_system = true
           ON CONFLICT DO NOTHING`,
          [invitation.instance_id, memberId],
        );
        await client.query('UPDATE invite SET consumed_at = now() WHERE id = $1', [invitation.id]);
        await client.query(
          `INSERT INTO admin_audit_log
             (instance_id, actor_member_id, action, target_type, target_id, details)
           VALUES ($1, $2, 'invitation.accepted', 'member', $2, $3::jsonb)`,
          [invitation.instance_id, memberId, JSON.stringify({ email: invitation.email })],
        );

        const session = await createSession(client, memberId, config);
        await client.query('COMMIT');
        setSessionCookie(reply, session.token, config);

        return reply.code(201).send({
          member: {
            id: memberId,
            userId,
            instanceId: invitation.instance_id,
            instanceName: invitation.instance_name,
            firstName: parsed.data.firstName,
            email: invitation.email,
            role: invitation.role,
          },
          csrfToken: session.csrfToken,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        if (isUniqueViolation(error)) {
          return reply.code(409).send({ error: 'ACCOUNT_ALREADY_EXISTS' });
        }
        throw error;
      } finally {
        client.release();
      }
    },
  );
}

async function findInvitation(pool: Pool, token: string): Promise<InvitationRow | null> {
  const result = await pool.query<InvitationRow>(
    `SELECT inv.id, inv.instance_id, i.name AS instance_name, i.timezone,
            inv.email, inv.role, inv.expires_at
     FROM invite inv
     JOIN instance i ON i.id = inv.instance_id
     WHERE inv.token_hash = $1
       AND inv.consumed_at IS NULL
       AND inv.revoked_at IS NULL
       AND inv.expires_at > now()
     LIMIT 1`,
    [digest(token)],
  );
  return result.rows[0] ?? null;
}
