import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { profileUpdateSchema, type MemberProfile } from '@familyhub/contracts';
import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';

import { createSessionGuard, requireCsrf } from './auth.js';

type ProfileRow = {
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
  birth_date: string | null;
  timezone: string;
  locale: 'fr' | 'en';
  profile_visibility: 'ALL_MEMBERS' | 'PRIVATE';
  avatar_attachment_id: string | null;
};

function serializeProfile(row: ProfileRow): MemberProfile {
  return {
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    birthDate: row.birth_date,
    timezone: row.timezone,
    locale: row.locale,
    profileVisibility: row.profile_visibility,
    avatarAttachmentId: row.avatar_attachment_id,
    avatarUrl: row.avatar_attachment_id
      ? `/api/v1/attachments/${row.avatar_attachment_id}/content`
      : null,
  };
}

async function synchronizeBirthday(
  client: PoolClient,
  memberId: string,
  instanceId: string,
  firstName: string,
  lastName: string | null,
  birthDate: string | null,
  timezone: string,
  visibility: 'ALL_MEMBERS' | 'PRIVATE',
  currentEventId: string | null,
): Promise<void> {
  if (!birthDate) {
    if (currentEventId) {
      await client.query('DELETE FROM resource WHERE id = $1 AND instance_id = $2', [
        currentEventId,
        instanceId,
      ]);
    }
    await client.query(
      'UPDATE member_profile_preference SET birthday_event_id = NULL WHERE member_id = $1',
      [memberId],
    );
    return;
  }

  const startAt = new Date(`${birthDate}T00:00:00.000Z`);
  const endAt = new Date(startAt.getTime() + 86_400_000);
  const displayName = [firstName, lastName].filter(Boolean).join(' ');
  let eventId = currentEventId;

  if (eventId) {
    const updated = await client.query(
      `UPDATE calendar_event
       SET title = $1, event_type = 'BIRTHDAY', start_at = $2, end_at = $3,
           all_day = true, recurrence = 'YEARLY', recurrence_interval = 1,
           recurrence_until = NULL, recurrence_timezone = $4,
           updated_at = now(), version = version + 1
       WHERE id = $5 AND instance_id = $6
       RETURNING id`,
      [`Anniversaire de ${displayName}`, startAt, endAt, timezone, eventId, instanceId],
    );
    if (!updated.rowCount) eventId = null;
  }

  if (!eventId) {
    const resource = await client.query<{ id: string }>(
      `INSERT INTO resource (instance_id, resource_type, created_by, visibility)
       VALUES ($1, 'calendar_event', $2, $3)
       RETURNING id`,
      [instanceId, memberId, visibility],
    );
    eventId = resource.rows[0]!.id;
    await client.query(
      `INSERT INTO calendar_event
         (id, instance_id, title, event_type, start_at, end_at, all_day,
          recurrence, recurrence_interval, recurrence_timezone, client_mutation_id)
       VALUES ($1, $2, $3, 'BIRTHDAY', $4, $5, true, 'YEARLY', 1, $6, $1)`,
      [eventId, instanceId, `Anniversaire de ${displayName}`, startAt, endAt, timezone],
    );
    await client.query(
      `INSERT INTO calendar_event_participant (event_id, member_id, response, responded_at)
       VALUES ($1, $2, 'YES', now())`,
      [eventId, memberId],
    );
    await client.query(
      `UPDATE member_profile_preference
       SET birthday_event_id = $2, updated_at = now()
       WHERE member_id = $1`,
      [memberId, eventId],
    );
  }

  await client.query(
    `UPDATE resource SET visibility = $2, updated_at = now()
     WHERE id = $1 AND instance_id = $3`,
    [eventId, visibility, instanceId],
  );
}

const selectProfile = `SELECT u.first_name, u.last_name, u.email, u.phone, u.birth_date, u.timezone,
  COALESCE(p.locale, 'fr') AS locale,
  COALESCE(p.visibility, 'ALL_MEMBERS') AS profile_visibility,
  p.avatar_attachment_id
 FROM app_user u
 JOIN instance_member m ON m.user_id = u.id
 LEFT JOIN member_profile_preference p ON p.member_id = m.id`;

export async function registerProfileRoutes(app: FastifyInstance, pool: Pool) {
  const requireSession = createSessionGuard(pool);

  app.get('/api/v1/profile', { preHandler: requireSession }, async (request, reply) => {
    const result = await pool.query<ProfileRow>(
      `${selectProfile}
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
      let obsoleteAvatarStorageKey: string | null = null;
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [request.session!.id]);
        const currentPreference = await client.query<{
          avatar_attachment_id: string | null;
        }>(
          `SELECT avatar_attachment_id
           FROM member_profile_preference
           WHERE member_id = $1
           FOR UPDATE`,
          [request.session!.id],
        );
        const currentAvatarId = currentPreference.rows[0]?.avatar_attachment_id ?? null;
        if (parsed.data.avatarAttachmentId) {
          const avatar = await client.query(
            `SELECT 1 FROM attachment
             WHERE id = $1 AND instance_id = $2 AND uploaded_by = $3
               AND status = 'READY' AND upload_purpose = 'AVATAR'
               AND detected_mime LIKE 'image/%'`,
            [parsed.data.avatarAttachmentId, request.session!.instanceId, request.session!.id],
          );
          if (!avatar.rowCount) {
            await client.query('ROLLBACK');
            return reply.code(400).send({ error: 'INVALID_AVATAR' });
          }
        }

        const updated = await client.query(
          `UPDATE app_user u
           SET first_name = $1, last_name = $2, phone = $3, birth_date = $4,
               timezone = $5, updated_at = now()
           FROM instance_member m
           WHERE u.id = $6 AND m.user_id = u.id AND m.id = $7 AND m.instance_id = $8
           RETURNING u.id`,
          [
            parsed.data.firstName,
            parsed.data.lastName,
            parsed.data.phone,
            parsed.data.birthDate,
            parsed.data.timezone,
            request.session!.userId,
            request.session!.id,
            request.session!.instanceId,
          ],
        );
        if (!updated.rowCount) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'PROFILE_NOT_FOUND' });
        }

        const preference = await client.query<{ birthday_event_id: string | null }>(
          `INSERT INTO member_profile_preference
             (member_id, avatar_attachment_id, locale, visibility)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (member_id) DO UPDATE
           SET avatar_attachment_id = EXCLUDED.avatar_attachment_id,
               locale = EXCLUDED.locale,
               visibility = EXCLUDED.visibility,
               updated_at = now()
           RETURNING birthday_event_id`,
          [
            request.session!.id,
            parsed.data.avatarAttachmentId,
            parsed.data.locale,
            parsed.data.profileVisibility,
          ],
        );

        await synchronizeBirthday(
          client,
          request.session!.id,
          request.session!.instanceId,
          parsed.data.firstName,
          parsed.data.lastName,
          parsed.data.birthDate,
          parsed.data.timezone,
          parsed.data.profileVisibility,
          preference.rows[0]?.birthday_event_id ?? null,
        );

        if (currentAvatarId && currentAvatarId !== parsed.data.avatarAttachmentId) {
          const removedAvatar = await client.query<{ storage_key: string }>(
            `DELETE FROM attachment
             WHERE id = $1 AND instance_id = $2 AND uploaded_by = $3
               AND upload_purpose = 'AVATAR'
             RETURNING storage_key`,
            [currentAvatarId, request.session!.instanceId, request.session!.id],
          );
          obsoleteAvatarStorageKey = removedAvatar.rows[0]?.storage_key ?? null;
        }

        await client.query(
          `INSERT INTO admin_audit_log
             (instance_id, actor_member_id, action, target_type, target_id, details)
           VALUES ($1, $2, 'profile.updated', 'member', $2, $3::jsonb)`,
          [
            request.session!.instanceId,
            request.session!.id,
            JSON.stringify({
              fields: [
                'firstName',
                'lastName',
                'phone',
                'birthDate',
                'timezone',
                'avatar',
                'locale',
                'profileVisibility',
              ],
            }),
          ],
        );
        const result = await client.query<ProfileRow>(
          `${selectProfile}
           WHERE u.id = $1 AND m.id = $2 AND m.instance_id = $3
           LIMIT 1`,
          [request.session!.userId, request.session!.id, request.session!.instanceId],
        );
        await client.query('COMMIT');
        if (obsoleteAvatarStorageKey) {
          try {
            await rm(join(request.server.config.ATTACHMENTS_DIR, obsoleteAvatarStorageKey), {
              force: true,
            });
          } catch (error) {
            request.log.warn({ error }, 'Could not remove the obsolete avatar file.');
          }
        }
        return { profile: serializeProfile(result.rows[0]!) };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );
}
