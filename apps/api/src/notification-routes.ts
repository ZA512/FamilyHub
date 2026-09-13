import {
  notificationReadSchema,
  notificationPreferenceSchema,
  pushSubscriptionSchema,
  pushUnsubscribeSchema,
  type FamilyNotification,
  type ModuleKey,
  type NotificationPreference,
} from '@familyhub/contracts';
import type { AppConfig } from '@familyhub/config';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';

import { createSessionGuard, requireCsrf } from './auth.js';
import { importantNotificationTypes } from './notification-policy.js';
import { localizeNotification } from './notification-copy.js';

const notificationIdSchema = z.string().uuid();

type NotificationPreferenceRow = {
  level: NotificationPreference['level'];
  mutedModules: ModuleKey[];
  quietStart: string | null;
  quietEnd: string | null;
};

type NotificationRow = {
  id: string;
  type: string;
  moduleKey: ModuleKey | null;
  title: string;
  body: string | null;
  actorName: string | null;
  resourceType: string | null;
  resourceId: string | null;
  readAt: Date | null;
  createdAt: Date;
};

const selectNotification = `
  SELECT n.id, n.type, n.module_key AS "moduleKey", n.title, n.body,
         actor.first_name AS "actorName", n.resource_type AS "resourceType",
         n.resource_id AS "resourceId", n.read_at AS "readAt", n.created_at AS "createdAt"
  FROM notification n
  LEFT JOIN instance_member actor_member ON actor_member.id = n.actor_member_id
  LEFT JOIN app_user actor ON actor.id = actor_member.user_id
  LEFT JOIN notification_preference np ON np.member_id = n.recipient_member_id
`;

function serializeNotification(
  row: NotificationRow,
  locale: 'fr' | 'en' | undefined,
): FamilyNotification {
  const localized = localizeNotification(locale, row);
  return {
    ...localized,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function registerNotificationRoutes(
  app: FastifyInstance,
  pool: Pool,
  config: AppConfig,
) {
  const requireSession = createSessionGuard(pool);

  app.get('/api/v1/push/config', { preHandler: requireSession }, async () => ({
    enabled: Boolean(config.VAPID_PUBLIC_KEY),
    publicKey: config.VAPID_PUBLIC_KEY ?? null,
  }));

  app.post(
    '/api/v1/push/subscriptions',
    {
      preHandler: [requireSession, requireCsrf],
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      if (!config.VAPID_PUBLIC_KEY) return reply.code(503).send({ error: 'WEB_PUSH_DISABLED' });
      const parsed = pushSubscriptionSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      await pool.query(
        `INSERT INTO device_subscription
           (member_id, instance_id, endpoint, p256dh, auth, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (endpoint) DO UPDATE SET
           member_id = excluded.member_id,
           instance_id = excluded.instance_id,
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           user_agent = excluded.user_agent,
           updated_at = now()`,
        [
          request.session?.id,
          request.session?.instanceId,
          parsed.data.endpoint,
          parsed.data.keys.p256dh,
          parsed.data.keys.auth,
          request.headers['user-agent']?.slice(0, 500) ?? null,
        ],
      );
      return reply.code(201).send({ subscribed: true });
    },
  );

  app.delete(
    '/api/v1/push/subscriptions',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      const parsed = pushUnsubscribeSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      await pool.query(
        `DELETE FROM device_subscription
         WHERE endpoint = $1 AND instance_id = $2 AND member_id = $3`,
        [parsed.data.endpoint, request.session?.instanceId, request.session?.id],
      );
      return reply.code(204).send();
    },
  );

  app.get('/api/v1/notification-preferences', { preHandler: requireSession }, async (request) => {
    const result = await pool.query<NotificationPreferenceRow>(
      `SELECT level, muted_modules AS "mutedModules",
                to_char(quiet_start, 'HH24:MI') AS "quietStart",
                to_char(quiet_end, 'HH24:MI') AS "quietEnd"
         FROM notification_preference
         WHERE instance_id = $1 AND member_id = $2`,
      [request.session?.instanceId, request.session?.id],
    );
    return {
      preferences: result.rows[0] ?? {
        level: 'ALL',
        mutedModules: [],
        quietStart: null,
        quietEnd: null,
      },
    };
  });

  app.patch(
    '/api/v1/notification-preferences',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      const parsed = notificationPreferenceSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const result = await pool.query<NotificationPreferenceRow>(
        `INSERT INTO notification_preference
           (member_id, instance_id, level, muted_modules, quiet_start, quiet_end)
         VALUES ($1, $2, $3, $4::text[], $5::time, $6::time)
         ON CONFLICT (member_id) DO UPDATE SET
           level = excluded.level,
           muted_modules = excluded.muted_modules,
           quiet_start = excluded.quiet_start,
           quiet_end = excluded.quiet_end,
           updated_at = now()
         RETURNING level, muted_modules AS "mutedModules",
                   to_char(quiet_start, 'HH24:MI') AS "quietStart",
                   to_char(quiet_end, 'HH24:MI') AS "quietEnd"`,
        [
          request.session?.id,
          request.session?.instanceId,
          parsed.data.level,
          parsed.data.mutedModules,
          parsed.data.quietStart,
          parsed.data.quietEnd,
        ],
      );
      return { preferences: result.rows[0] };
    },
  );

  app.get('/api/v1/notifications', { preHandler: requireSession }, async (request) => {
    const [notifications, count] = await Promise.all([
      pool.query<NotificationRow>(
        `${selectNotification}
         WHERE n.instance_id = $1 AND n.recipient_member_id = $2
           AND NOT COALESCE(n.module_key = ANY(COALESCE(np.muted_modules, ARRAY[]::text[])), false)
           AND (COALESCE(np.level, 'ALL') = 'ALL' OR n.type = ANY($3::text[]))
         ORDER BY n.read_at NULLS FIRST, n.created_at DESC
         LIMIT 50`,
        [request.session?.instanceId, request.session?.id, importantNotificationTypes],
      ),
      pool.query<{ unreadCount: number }>(
        `SELECT count(*)::int AS "unreadCount"
         FROM notification n
         LEFT JOIN notification_preference np ON np.member_id = n.recipient_member_id
         WHERE n.instance_id = $1 AND n.recipient_member_id = $2 AND n.read_at IS NULL
           AND NOT COALESCE(n.module_key = ANY(COALESCE(np.muted_modules, ARRAY[]::text[])), false)
           AND (COALESCE(np.level, 'ALL') = 'ALL' OR n.type = ANY($3::text[]))`,
        [request.session?.instanceId, request.session?.id, importantNotificationTypes],
      ),
    ]);

    return {
      notifications: notifications.rows.map((row) =>
        serializeNotification(row, request.session?.locale),
      ),
      unreadCount: count.rows[0]?.unreadCount ?? 0,
    };
  });

  app.patch<{ Params: { id: string } }>(
    '/api/v1/notifications/:id',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      const notificationId = notificationIdSchema.safeParse(request.params.id);
      const parsed = notificationReadSchema.safeParse(request.body);
      if (!notificationId.success) {
        return reply.code(404).send({ error: 'NOTIFICATION_NOT_FOUND' });
      }
      if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });

      const updated = await pool.query<{ id: string }>(
        `UPDATE notification
         SET read_at = CASE WHEN $1 THEN COALESCE(read_at, now()) ELSE NULL END
         WHERE id = $2 AND instance_id = $3 AND recipient_member_id = $4
         RETURNING id`,
        [parsed.data.read, notificationId.data, request.session?.instanceId, request.session?.id],
      );
      if (!updated.rowCount) return reply.code(404).send({ error: 'NOTIFICATION_NOT_FOUND' });

      const result = await pool.query<NotificationRow>(
        `${selectNotification}
         WHERE n.id = $1 AND n.instance_id = $2 AND n.recipient_member_id = $3`,
        [notificationId.data, request.session?.instanceId, request.session?.id],
      );
      const row = result.rows[0];
      if (!row) return reply.code(404).send({ error: 'NOTIFICATION_NOT_FOUND' });
      return {
        notification: serializeNotification(row, request.session?.locale),
      };
    },
  );

  app.patch(
    '/api/v1/notifications',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      const parsed = notificationReadSchema.safeParse(request.body);
      if (!parsed.success || !parsed.data.read) {
        return reply.code(400).send({ error: 'INVALID_REQUEST' });
      }
      await pool.query(
        `UPDATE notification SET read_at = COALESCE(read_at, now())
         WHERE instance_id = $1 AND recipient_member_id = $2 AND read_at IS NULL`,
        [request.session?.instanceId, request.session?.id],
      );
      return { unreadCount: 0 };
    },
  );
}
