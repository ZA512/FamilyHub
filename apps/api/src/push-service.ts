import type { AppConfig } from '@familyhub/config';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import webPush from 'web-push';

import { importantNotificationTypes, isImportantNotification } from './notification-policy.js';

type PushTarget = {
  subscriptionId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  type: string;
  title: string;
  body: string | null;
};

export async function startPushDelivery(app: FastifyInstance, pool: Pool, config: AppConfig) {
  if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY || !config.VAPID_SUBJECT) {
    app.log.info('Web Push disabled: VAPID is not configured.');
    return async () => undefined;
  }

  webPush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY);
  const listener = await pool.connect();
  let closed = false;

  async function deliver(notificationId: string) {
    const targets = await pool.query<PushTarget>(
      `SELECT ds.id AS "subscriptionId", ds.endpoint, ds.p256dh, ds.auth,
              n.type, n.title, n.body
       FROM notification n
       JOIN device_subscription ds
         ON ds.member_id = n.recipient_member_id AND ds.instance_id = n.instance_id
       JOIN instance_member m ON m.id = n.recipient_member_id
       JOIN app_user u ON u.id = m.user_id
       LEFT JOIN notification_preference np ON np.member_id = n.recipient_member_id
       WHERE n.id = $1
         AND NOT COALESCE(n.module_key = ANY(COALESCE(np.muted_modules, ARRAY[]::text[])), false)
         AND (COALESCE(np.level, 'ALL') = 'ALL' OR n.type = ANY($2::text[]))
         AND (
           np.quiet_start IS NULL OR np.quiet_end IS NULL OR
           CASE WHEN np.quiet_start < np.quiet_end THEN
             NOT ((now() AT TIME ZONE u.timezone)::time >= np.quiet_start
               AND (now() AT TIME ZONE u.timezone)::time < np.quiet_end)
           ELSE
             NOT ((now() AT TIME ZONE u.timezone)::time >= np.quiet_start
               OR (now() AT TIME ZONE u.timezone)::time < np.quiet_end)
           END
         )`,
      [notificationId, importantNotificationTypes],
    );

    await Promise.all(
      targets.rows.map(async (target) => {
        const reservation = await pool.query(
          `INSERT INTO notification_delivery (notification_id, subscription_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING notification_id`,
          [notificationId, target.subscriptionId],
        );
        if (!reservation.rowCount) return;
        try {
          await webPush.sendNotification(
            {
              endpoint: target.endpoint,
              keys: { p256dh: target.p256dh, auth: target.auth },
            },
            JSON.stringify({
              title: target.title,
              body: target.body,
              tag: `familyhub-${target.type.toLowerCase()}`,
              url: '/',
            }),
            {
              TTL: 86_400,
              urgency: isImportantNotification(target.type) ? 'high' : 'normal',
            },
          );
        } catch (error) {
          const statusCode =
            typeof error === 'object' && error && 'statusCode' in error
              ? Number(error.statusCode)
              : 0;
          if (statusCode === 404 || statusCode === 410) {
            await pool.query('DELETE FROM device_subscription WHERE id = $1', [
              target.subscriptionId,
            ]);
          } else {
            await pool.query(
              `DELETE FROM notification_delivery
               WHERE notification_id = $1 AND subscription_id = $2`,
              [notificationId, target.subscriptionId],
            );
            app.log.warn(
              { error, notificationId, subscriptionId: target.subscriptionId },
              'Web Push delivery failed.',
            );
          }
        }
      }),
    );
  }

  listener.on('notification', (event) => {
    if (event.channel !== 'familyhub_notification' || !event.payload || closed) return;
    void deliver(event.payload).catch((error) =>
      app.log.error({ error, notificationId: event.payload }, 'Web Push dispatch failed.'),
    );
  });
  listener.on('error', (error) => app.log.error({ error }, 'Web Push listener failed.'));
  await listener.query('LISTEN familyhub_notification');

  return async () => {
    closed = true;
    try {
      await listener.query('UNLISTEN familyhub_notification');
    } finally {
      listener.release();
    }
  };
}
