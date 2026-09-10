import type { HomeActivity, HomeAttention, HomeSummary } from '@familyhub/contracts';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

import { createSessionGuard } from './auth.js';

type ActivityRow = Omit<HomeActivity, 'occurredAt'> & { occurredAt: Date };

export async function registerHomeRoutes(app: FastifyInstance, pool: Pool) {
  const requireSession = createSessionGuard(pool);

  app.get('/api/v1/home', { preHandler: requireSession }, async (request) => {
    const [unreadResult, shoppingResult, activityResult] = await Promise.all([
      pool.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM notification
         WHERE instance_id = $1 AND recipient_member_id = $2 AND read_at IS NULL`,
        [request.session?.instanceId, request.session?.id],
      ),
      pool.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM shopping_item i
         WHERE i.instance_id = $1 AND i.deleted_at IS NULL AND i.purchased_at IS NULL
           AND EXISTS (
             SELECT 1 FROM module_config mc
             WHERE mc.instance_id = i.instance_id
               AND mc.module_key = 'shopping' AND mc.enabled = true
           )`,
        [request.session?.instanceId],
      ),
      pool.query<ActivityRow>(
        `SELECT * FROM (
           SELECT concat('shopping.added:', i.id) AS id,
                  'shopping.added'::text AS type, requester.first_name AS "actorName",
                  i.name AS subject, i.created_at AS "occurredAt", 'shopping'::text AS view
           FROM shopping_item i
           JOIN instance_member requester_member ON requester_member.id = i.requested_by
           JOIN app_user requester ON requester.id = requester_member.user_id
           WHERE i.instance_id = $1 AND i.deleted_at IS NULL
             AND EXISTS (
               SELECT 1 FROM module_config mc
               WHERE mc.instance_id = i.instance_id
                 AND mc.module_key = 'shopping' AND mc.enabled = true
             )

           UNION ALL

           SELECT concat('shopping.purchased:', i.id) AS id,
                  'shopping.purchased'::text AS type, purchaser.first_name AS "actorName",
                  i.name AS subject, i.purchased_at AS "occurredAt", 'shopping'::text AS view
           FROM shopping_item i
           JOIN instance_member purchaser_member ON purchaser_member.id = i.purchased_by
           JOIN app_user purchaser ON purchaser.id = purchaser_member.user_id
           WHERE i.instance_id = $1 AND i.deleted_at IS NULL AND i.purchased_at IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM module_config mc
               WHERE mc.instance_id = i.instance_id
                 AND mc.module_key = 'shopping' AND mc.enabled = true
             )
         ) events
         ORDER BY "occurredAt" DESC
         LIMIT 12`,
        [request.session?.instanceId],
      ),
    ]);

    const unreadNotificationCount = unreadResult.rows[0]?.count ?? 0;
    const pendingShoppingCount = shoppingResult.rows[0]?.count ?? 0;
    const attention: HomeAttention[] = [];

    if (unreadNotificationCount) {
      attention.push({
        id: 'notifications',
        count: unreadNotificationCount,
        title: 'Notifications',
        detail: `${unreadNotificationCount} nouvelle${unreadNotificationCount > 1 ? 's' : ''} à consulter`,
        view: 'notifications',
      });
    }
    if (pendingShoppingCount) {
      attention.push({
        id: 'shopping',
        count: pendingShoppingCount,
        title: 'Liste de courses',
        detail: `${pendingShoppingCount} article${pendingShoppingCount > 1 ? 's' : ''} à acheter`,
        view: 'shopping',
      });
    }

    return {
      attention,
      activity: activityResult.rows.map(
        (row): HomeActivity => ({
          ...row,
          occurredAt: row.occurredAt.toISOString(),
        }),
      ),
      unreadNotificationCount,
    } satisfies HomeSummary;
  });
}
