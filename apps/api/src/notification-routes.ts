import {
  notificationReadSchema,
  type FamilyNotification,
  type ModuleKey,
} from '@familyhub/contracts';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';

import { createSessionGuard, requireCsrf } from './auth.js';

const notificationIdSchema = z.string().uuid();

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
`;

function serializeNotification(row: NotificationRow): FamilyNotification {
  return {
    ...row,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function registerNotificationRoutes(app: FastifyInstance, pool: Pool) {
  const requireSession = createSessionGuard(pool);

  app.get('/api/v1/notifications', { preHandler: requireSession }, async (request) => {
    const [notifications, count] = await Promise.all([
      pool.query<NotificationRow>(
        `${selectNotification}
         WHERE n.instance_id = $1 AND n.recipient_member_id = $2
         ORDER BY n.read_at NULLS FIRST, n.created_at DESC
         LIMIT 50`,
        [request.session?.instanceId, request.session?.id],
      ),
      pool.query<{ unreadCount: number }>(
        `SELECT count(*)::int AS "unreadCount"
         FROM notification
         WHERE instance_id = $1 AND recipient_member_id = $2 AND read_at IS NULL`,
        [request.session?.instanceId, request.session?.id],
      ),
    ]);

    return {
      notifications: notifications.rows.map(serializeNotification),
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
      return { notification: serializeNotification(row) };
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
