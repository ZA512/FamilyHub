import { profileUpdateSchema, type MemberProfile } from '@familyhub/contracts';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

import { createSessionGuard, requireCsrf } from './auth.js';

type ProfileRow = {
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
  birth_date: string | null;
  timezone: string;
};

function serializeProfile(row: ProfileRow): MemberProfile {
  return {
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    birthDate: row.birth_date,
    timezone: row.timezone,
  };
}

export async function registerProfileRoutes(app: FastifyInstance, pool: Pool) {
  const requireSession = createSessionGuard(pool);

  app.get('/api/v1/profile', { preHandler: requireSession }, async (request, reply) => {
    const result = await pool.query<ProfileRow>(
      `SELECT u.first_name, u.last_name, u.email, u.phone, u.birth_date, u.timezone
       FROM app_user u
       JOIN instance_member m ON m.user_id = u.id
       WHERE u.id = $1 AND m.id = $2 AND m.instance_id = $3
       LIMIT 1`,
      [request.session?.userId, request.session?.id, request.session?.instanceId],
    );
    const row = result.rows[0];
    if (!row) return reply.code(404).send({ error: 'PROFILE_NOT_FOUND' });
    return { profile: serializeProfile(row) };
  });

  app.patch(
    '/api/v1/profile',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      const parsed = profileUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'INVALID_REQUEST', details: parsed.error.flatten() });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query<ProfileRow>(
          `UPDATE app_user u
           SET first_name = $1, last_name = $2, phone = $3, birth_date = $4,
               timezone = $5, updated_at = now()
           FROM instance_member m
           WHERE u.id = $6 AND m.user_id = u.id AND m.id = $7 AND m.instance_id = $8
           RETURNING u.first_name, u.last_name, u.email, u.phone, u.birth_date, u.timezone`,
          [
            parsed.data.firstName,
            parsed.data.lastName,
            parsed.data.phone,
            parsed.data.birthDate,
            parsed.data.timezone,
            request.session?.userId,
            request.session?.id,
            request.session?.instanceId,
          ],
        );
        const row = result.rows[0];
        if (!row) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'PROFILE_NOT_FOUND' });
        }

        await client.query(
          `INSERT INTO admin_audit_log
             (instance_id, actor_member_id, action, target_type, target_id, details)
           VALUES ($1, $2, 'profile.updated', 'member', $2, $3::jsonb)`,
          [
            request.session?.instanceId,
            request.session?.id,
            JSON.stringify({ fields: ['firstName', 'lastName', 'phone', 'birthDate', 'timezone'] }),
          ],
        );
        await client.query('COMMIT');
        return { profile: serializeProfile(row) };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );
}
