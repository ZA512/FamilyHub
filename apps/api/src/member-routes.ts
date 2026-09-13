import {
  groupCreateSchema,
  groupUpdateSchema,
  type FamilyGroup,
  type FamilyMember,
} from '@familyhub/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';

import { createSessionGuard, requireCsrf } from './auth.js';

const idParamsSchema = z.object({ id: z.string().uuid() });
const membershipParamsSchema = z.object({
  id: z.string().uuid(),
  memberId: z.string().uuid(),
});

function requireAdmin(role: 'ADMIN' | 'MEMBER' | undefined, reply: FastifyReply) {
  if (role !== 'ADMIN') {
    return reply.code(403).send({ error: 'ADMIN_REQUIRED' });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export async function registerMemberRoutes(app: FastifyInstance, pool: Pool) {
  const requireSession = createSessionGuard(pool);

  app.get('/api/v1/members', { preHandler: requireSession }, async (request) => {
    const result = await pool.query<{
      id: string;
      first_name: string;
      last_name: string | null;
      email: string | null;
      avatar_id: string | null;
      role: 'ADMIN' | 'MEMBER';
      status: 'ACTIVE' | 'INACTIVE';
      joined_at: Date;
      group_ids: string[];
    }>(
      `SELECT m.id, u.first_name, u.last_name,
              CASE WHEN m.id = $2 OR $3 = 'ADMIN' OR COALESCE(p.visibility, 'ALL_MEMBERS') = 'ALL_MEMBERS'
                THEN u.email ELSE NULL END AS email,
              CASE WHEN m.id = $2 OR $3 = 'ADMIN' OR COALESCE(p.visibility, 'ALL_MEMBERS') = 'ALL_MEMBERS'
                THEN p.avatar_attachment_id ELSE NULL END AS avatar_id,
              m.role, m.status, m.joined_at,
              COALESCE(array_agg(gm.group_id) FILTER (WHERE gm.group_id IS NOT NULL), '{}') AS group_ids
       FROM instance_member m
       JOIN app_user u ON u.id = m.user_id
       LEFT JOIN member_profile_preference p ON p.member_id = m.id
       LEFT JOIN group_membership gm ON gm.member_id = m.id
       WHERE m.instance_id = $1
       GROUP BY m.id, u.id, p.visibility, p.avatar_attachment_id
       ORDER BY (m.status = 'ACTIVE') DESC, lower(u.first_name), lower(u.email)`,
      [request.session?.instanceId, request.session?.id, request.session?.role],
    );

    return {
      members: result.rows.map(
        (row): FamilyMember => ({
          id: row.id,
          firstName: row.first_name,
          lastName: row.last_name,
          email: row.email,
          avatarUrl: row.avatar_id ? `/api/v1/attachments/${row.avatar_id}/content` : null,
          role: row.role,
          status: row.status,
          joinedAt: row.joined_at.toISOString(),
          groupIds: row.group_ids,
        }),
      ),
    };
  });

  app.get('/api/v1/groups', { preHandler: requireSession }, async (request) => {
    const result = await pool.query<{
      id: string;
      name: string;
      description: string | null;
      is_system: boolean;
      member_ids: string[];
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT g.id, g.name, g.description, g.is_system, g.created_at, g.updated_at,
              COALESCE(array_agg(gm.member_id) FILTER (WHERE gm.member_id IS NOT NULL), '{}') AS member_ids
       FROM member_group g
       LEFT JOIN group_membership gm ON gm.group_id = g.id
       WHERE g.instance_id = $1
       GROUP BY g.id
       ORDER BY g.is_system DESC, lower(g.name)`,
      [request.session?.instanceId],
    );

    return {
      groups: result.rows.map(
        (row): FamilyGroup => ({
          id: row.id,
          name: row.name,
          description: row.description,
          isSystem: row.is_system,
          memberIds: row.member_ids,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        }),
      ),
    };
  });

  app.post(
    '/api/v1/groups',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      const denied = requireAdmin(request.session?.role, reply);
      if (denied) return denied;

      const parsed = groupCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'INVALID_REQUEST', details: parsed.error.flatten() });
      }

      try {
        const result = await pool.query<{
          id: string;
          name: string;
          description: string | null;
          is_system: boolean;
          created_at: Date;
          updated_at: Date;
        }>(
          `INSERT INTO member_group (instance_id, name, description)
           VALUES ($1, $2, $3)
           RETURNING id, name, description, is_system, created_at, updated_at`,
          [request.session?.instanceId, parsed.data.name, parsed.data.description ?? null],
        );
        const row = result.rows[0];
        if (!row) throw new Error('Group creation returned no row.');

        await pool.query(
          `INSERT INTO admin_audit_log
             (instance_id, actor_member_id, action, target_type, target_id, details)
           VALUES ($1, $2, 'group.created', 'group', $3, $4::jsonb)`,
          [
            request.session?.instanceId,
            request.session?.id,
            row.id,
            JSON.stringify({ name: row.name }),
          ],
        );

        return reply.code(201).send({
          group: {
            id: row.id,
            name: row.name,
            description: row.description,
            isSystem: row.is_system,
            memberIds: [],
            createdAt: row.created_at.toISOString(),
            updatedAt: row.updated_at.toISOString(),
          } satisfies FamilyGroup,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return reply.code(409).send({ error: 'GROUP_NAME_ALREADY_EXISTS' });
        }
        throw error;
      }
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/groups/:id',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      const denied = requireAdmin(request.session?.role, reply);
      if (denied) return denied;

      const params = idParamsSchema.safeParse(request.params);
      const parsed = groupUpdateSchema.safeParse(request.body);
      if (!params.success || !parsed.success) {
        return reply.code(400).send({ error: 'INVALID_REQUEST' });
      }

      const current = await pool.query<{ is_system: boolean }>(
        'SELECT is_system FROM member_group WHERE id = $1 AND instance_id = $2',
        [params.data.id, request.session?.instanceId],
      );
      if (!current.rows[0]) return reply.code(404).send({ error: 'GROUP_NOT_FOUND' });
      if (current.rows[0].is_system) {
        return reply.code(409).send({ error: 'SYSTEM_GROUP_IMMUTABLE' });
      }

      const values: unknown[] = [];
      const updates: string[] = [];
      if (parsed.data.name !== undefined) {
        values.push(parsed.data.name);
        updates.push(`name = $${values.length}`);
      }
      if (parsed.data.description !== undefined) {
        values.push(parsed.data.description);
        updates.push(`description = $${values.length}`);
      }
      values.push(params.data.id, request.session?.instanceId);

      try {
        const result = await pool.query<{
          id: string;
          name: string;
          description: string | null;
          is_system: boolean;
          created_at: Date;
          updated_at: Date;
        }>(
          `UPDATE member_group
           SET ${updates.join(', ')}, updated_at = now()
           WHERE id = $${values.length - 1} AND instance_id = $${values.length}
           RETURNING id, name, description, is_system, created_at, updated_at`,
          values,
        );
        const row = result.rows[0];
        if (!row) return reply.code(404).send({ error: 'GROUP_NOT_FOUND' });

        const members = await pool.query<{ member_id: string }>(
          'SELECT member_id FROM group_membership WHERE group_id = $1 ORDER BY member_id',
          [row.id],
        );
        await pool.query(
          `INSERT INTO admin_audit_log
             (instance_id, actor_member_id, action, target_type, target_id, details)
           VALUES ($1, $2, 'group.updated', 'group', $3, $4::jsonb)`,
          [request.session?.instanceId, request.session?.id, row.id, JSON.stringify(parsed.data)],
        );

        return {
          group: {
            id: row.id,
            name: row.name,
            description: row.description,
            isSystem: row.is_system,
            memberIds: members.rows.map((member) => member.member_id),
            createdAt: row.created_at.toISOString(),
            updatedAt: row.updated_at.toISOString(),
          } satisfies FamilyGroup,
        };
      } catch (error) {
        if (isUniqueViolation(error)) {
          return reply.code(409).send({ error: 'GROUP_NAME_ALREADY_EXISTS' });
        }
        throw error;
      }
    },
  );

  app.put<{ Params: { id: string; memberId: string } }>(
    '/api/v1/groups/:id/members/:memberId',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      const denied = requireAdmin(request.session?.role, reply);
      if (denied) return denied;
      return updateMembership(request, reply, pool, true);
    },
  );

  app.delete<{ Params: { id: string; memberId: string } }>(
    '/api/v1/groups/:id/members/:memberId',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      const denied = requireAdmin(request.session?.role, reply);
      if (denied) return denied;
      return updateMembership(request, reply, pool, false);
    },
  );
}

async function updateMembership(
  request: FastifyRequest<{ Params: { id: string; memberId: string } }>,
  reply: FastifyReply,
  pool: Pool,
  add: boolean,
) {
  const params = membershipParamsSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });

  const targets = await pool.query<{
    group_exists: boolean;
    member_exists: boolean;
    is_system: boolean;
  }>(
    `SELECT
       EXISTS (SELECT 1 FROM member_group WHERE id = $1 AND instance_id = $3) AS group_exists,
       EXISTS (SELECT 1 FROM instance_member WHERE id = $2 AND instance_id = $3) AS member_exists,
       COALESCE((SELECT is_system FROM member_group WHERE id = $1 AND instance_id = $3), false) AS is_system`,
    [params.data.id, params.data.memberId, request.session?.instanceId],
  );
  const target = targets.rows[0];
  if (!target?.group_exists) return reply.code(404).send({ error: 'GROUP_NOT_FOUND' });
  if (!target.member_exists) return reply.code(404).send({ error: 'MEMBER_NOT_FOUND' });
  if (target.is_system) return reply.code(409).send({ error: 'SYSTEM_GROUP_IMMUTABLE' });

  const changed = add
    ? await pool.query(
        `INSERT INTO group_membership (group_id, member_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING member_id`,
        [params.data.id, params.data.memberId],
      )
    : await pool.query(
        'DELETE FROM group_membership WHERE group_id = $1 AND member_id = $2 RETURNING member_id',
        [params.data.id, params.data.memberId],
      );

  if (changed.rowCount) {
    await pool.query(
      `INSERT INTO admin_audit_log
         (instance_id, actor_member_id, action, target_type, target_id, details)
       VALUES ($1, $2, $3, 'group', $4, $5::jsonb)`,
      [
        request.session?.instanceId,
        request.session?.id,
        add ? 'group.member_added' : 'group.member_removed',
        params.data.id,
        JSON.stringify({ memberId: params.data.memberId }),
      ],
    );
  }

  return reply.code(204).send();
}
