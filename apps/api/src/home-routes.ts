import type {
  HomeActivity,
  HomeAttention,
  HomeSummary,
  HomeTodayMeal,
} from '@familyhub/contracts';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

import { createSessionGuard } from './auth.js';
import { reopenAvailableTasks } from './task-routes.js';

type ActivityRow = Omit<HomeActivity, 'occurredAt' | 'actorAvatarUrl'> & {
  occurredAt: Date;
  actorAvatarAttachmentId: string | null;
};

export async function registerHomeRoutes(app: FastifyInstance, pool: Pool) {
  const requireSession = createSessionGuard(pool);

  app.get('/api/v1/home', { preHandler: requireSession }, async (request) => {
    await reopenAvailableTasks(pool, request.session!.instanceId);
    const [
      unreadResult,
      chatResult,
      shoppingResult,
      taskResult,
      todayMealsResult,
      musicResult,
      activityResult,
    ] = await Promise.all([
      pool.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM notification
         WHERE instance_id = $1 AND recipient_member_id = $2 AND read_at IS NULL`,
        [request.session?.instanceId, request.session?.id],
      ),
      pool.query<{ count: number }>(
        `SELECT count(DISTINCT cm.conversation_id)::int AS count
         FROM conversation_member cm
         JOIN conversation c ON c.id = cm.conversation_id
         WHERE cm.member_id = $2 AND c.instance_id = $1 AND c.deleted_at IS NULL
           AND EXISTS (
             SELECT 1 FROM message m
             WHERE m.conversation_id = c.id AND m.author_id <> $2
               AND m.deleted_at IS NULL
               AND m.created_at > COALESCE(cm.last_read_at, cm.joined_at)
           )
           AND EXISTS (
             SELECT 1 FROM module_config mc
             WHERE mc.instance_id = c.instance_id
               AND mc.module_key = 'chat' AND mc.enabled = true
           )`,
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
      pool.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM family_task t
         JOIN resource r ON r.id = t.id
         WHERE r.instance_id = $1 AND r.deleted_at IS NULL
           AND t.status IN ('OPEN', 'IN_PROGRESS')
           AND (
             t.assignee_id = $2
             OR (t.claimable = false AND t.assignee_id IS NULL AND r.created_by = $2)
             OR (
               t.claimable = true AND (
                 r.visibility = 'ALL_MEMBERS'
                 OR EXISTS (
                   SELECT 1 FROM resource_acl_user actionable_user
                   WHERE actionable_user.resource_id = r.id
                     AND actionable_user.member_id = $2
                 )
                 OR EXISTS (
                   SELECT 1
                   FROM resource_acl_group actionable_group
                   JOIN group_membership actionable_membership
                     ON actionable_membership.group_id = actionable_group.group_id
                   WHERE actionable_group.resource_id = r.id
                     AND actionable_membership.member_id = $2
                 )
               )
             )
           )
           AND (
             r.visibility = 'ALL_MEMBERS' OR r.created_by = $2
             OR EXISTS (
               SELECT 1 FROM resource_acl_user rau
               WHERE rau.resource_id = r.id AND rau.member_id = $2
             )
             OR EXISTS (
               SELECT 1 FROM resource_acl_group rag
               JOIN group_membership gm ON gm.group_id = rag.group_id
               WHERE rag.resource_id = r.id AND gm.member_id = $2
             )
           )
           AND EXISTS (
             SELECT 1 FROM module_config mc
             WHERE mc.instance_id = r.instance_id
               AND mc.module_key = 'tasks' AND mc.enabled = true
           )`,
        [request.session?.instanceId, request.session?.id],
      ),
      pool.query<HomeTodayMeal>(
        `SELECT pe.id, pe.meal_id AS "mealId", m.name AS "mealName",
                pe.slot, pe.slot_label AS "slotLabel", pe.portions, pe.note
         FROM meal_plan_entry pe
         JOIN meal m ON m.id = pe.meal_id
         JOIN resource r ON r.id = m.id
         JOIN instance i ON i.id = pe.instance_id
         WHERE pe.instance_id = $1
           AND pe.date = (now() AT TIME ZONE i.timezone)::date
           AND r.deleted_at IS NULL
           AND (r.visibility = 'ALL_MEMBERS' OR r.created_by = $2)
           AND EXISTS (
             SELECT 1 FROM module_config mc
             WHERE mc.instance_id = pe.instance_id
               AND mc.module_key = 'meals' AND mc.enabled = true
           )
         ORDER BY CASE pe.slot WHEN 'LUNCH' THEN 1 WHEN 'DINNER' THEN 2 ELSE 3 END,
                  pe.created_at`,
        [request.session?.instanceId, request.session?.id],
      ),
      pool.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM music_recommendation recommendation
           WHERE recommendation.instance_id = $1
             AND recommendation.recipient_member_id = $2
             AND recommendation.expires_at > now()
             AND EXISTS (
               SELECT 1 FROM module_config mc
               WHERE mc.instance_id = recommendation.instance_id
                 AND mc.module_key = 'music' AND mc.enabled = true
             )`,
        [request.session?.instanceId, request.session?.id],
      ),
      pool.query<ActivityRow>(
        `SELECT events.id, events.type, events."actorName", events.subject,
                  events."occurredAt", events.view,
                  CASE
                    WHEN events."actorId" = $2 OR $3 = 'ADMIN'
                      OR COALESCE(actor_profile.visibility, 'ALL_MEMBERS') = 'ALL_MEMBERS'
                    THEN actor_profile.avatar_attachment_id
                    ELSE NULL
                  END AS "actorAvatarAttachmentId"
           FROM (
           SELECT concat('shopping.added:', i.id) AS id,
                  'shopping.added'::text AS type, requester.first_name AS "actorName",
                  requester_member.id AS "actorId",
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
                  purchaser_member.id AS "actorId",
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

           UNION ALL

           SELECT concat('task.created:', t.id) AS id,
                  'task.created'::text AS type, creator.first_name AS "actorName",
                  creator_member.id AS "actorId",
                  t.title AS subject, t.created_at AS "occurredAt", 'tasks'::text AS view
           FROM family_task t
           JOIN resource r ON r.id = t.id
           JOIN instance_member creator_member ON creator_member.id = r.created_by
           JOIN app_user creator ON creator.id = creator_member.user_id
           WHERE r.instance_id = $1 AND r.deleted_at IS NULL
             AND EXISTS (
               SELECT 1 FROM module_config mc
               WHERE mc.instance_id = r.instance_id
                 AND mc.module_key = 'tasks' AND mc.enabled = true
             )
             AND (
               r.visibility = 'ALL_MEMBERS' OR r.created_by = $2
               OR EXISTS (
                 SELECT 1 FROM resource_acl_user rau
                 WHERE rau.resource_id = r.id AND rau.member_id = $2
               )
               OR EXISTS (
                 SELECT 1 FROM resource_acl_group rag
                 JOIN group_membership gm ON gm.group_id = rag.group_id
                 WHERE rag.resource_id = r.id AND gm.member_id = $2
               )
             )

           UNION ALL

           SELECT concat('task.completed:', c.id) AS id,
                  'task.completed'::text AS type, performer.first_name AS "actorName",
                  performer_member.id AS "actorId",
                  t.title AS subject, c.completed_at AS "occurredAt", 'tasks'::text AS view
           FROM task_completion c
           JOIN family_task t ON t.id = c.task_id
           JOIN resource r ON r.id = t.id
           JOIN instance_member performer_member ON performer_member.id = c.completed_by
           JOIN app_user performer ON performer.id = performer_member.user_id
           WHERE r.instance_id = $1 AND r.deleted_at IS NULL
             AND EXISTS (
               SELECT 1 FROM module_config mc
               WHERE mc.instance_id = r.instance_id
                 AND mc.module_key = 'tasks' AND mc.enabled = true
             )
             AND (
               r.visibility = 'ALL_MEMBERS' OR r.created_by = $2
               OR EXISTS (
                 SELECT 1 FROM resource_acl_user rau
                 WHERE rau.resource_id = r.id AND rau.member_id = $2
               )
               OR EXISTS (
                 SELECT 1 FROM resource_acl_group rag
                 JOIN group_membership gm ON gm.group_id = rag.group_id
                 WHERE rag.resource_id = r.id AND gm.member_id = $2
               )
             )

           UNION ALL

           SELECT concat('meal.created:', m.id) AS id,
                  'meal.created'::text AS type, creator.first_name AS "actorName",
                  creator_member.id AS "actorId",
                  m.name AS subject, m.created_at AS "occurredAt", 'meals'::text AS view
           FROM meal m
           JOIN resource r ON r.id = m.id
           JOIN instance_member creator_member ON creator_member.id = r.created_by
           JOIN app_user creator ON creator.id = creator_member.user_id
           WHERE r.instance_id = $1 AND r.deleted_at IS NULL
             AND EXISTS (
               SELECT 1 FROM module_config mc
               WHERE mc.instance_id = r.instance_id
                 AND mc.module_key = 'meals' AND mc.enabled = true
             )
             AND (r.visibility = 'ALL_MEMBERS' OR r.created_by = $2)

           UNION ALL

           SELECT concat('meal.planned:', pe.id) AS id,
                  'meal.planned'::text AS type, planner.first_name AS "actorName",
                  planner_member.id AS "actorId",
                  m.name AS subject, pe.created_at AS "occurredAt", 'meals'::text AS view
           FROM meal_plan_entry pe
           JOIN meal m ON m.id = pe.meal_id
           JOIN resource r ON r.id = m.id
           JOIN instance_member planner_member ON planner_member.id = pe.created_by
           JOIN app_user planner ON planner.id = planner_member.user_id
           WHERE pe.instance_id = $1 AND r.deleted_at IS NULL
             AND EXISTS (
               SELECT 1 FROM module_config mc
               WHERE mc.instance_id = pe.instance_id
                 AND mc.module_key = 'meals' AND mc.enabled = true
             )
             AND (r.visibility = 'ALL_MEMBERS' OR r.created_by = $2)

           UNION ALL

           SELECT concat('bookmark.shared:', b.id) AS id,
                  'bookmark.shared'::text AS type, creator.first_name AS "actorName",
                  creator_member.id AS "actorId",
                  b.title AS subject, b.created_at AS "occurredAt", 'bookmarks'::text AS view
           FROM bookmark b
           JOIN resource r ON r.id = b.id
           JOIN instance_member creator_member ON creator_member.id = r.created_by
           JOIN app_user creator ON creator.id = creator_member.user_id
           WHERE r.instance_id = $1 AND r.deleted_at IS NULL AND r.visibility <> 'PRIVATE'
             AND EXISTS (
               SELECT 1 FROM module_config mc
               WHERE mc.instance_id = r.instance_id
                 AND mc.module_key = 'bookmarks' AND mc.enabled = true
             )
             AND (
               r.visibility = 'ALL_MEMBERS' OR r.created_by = $2
               OR EXISTS (
                 SELECT 1 FROM resource_acl_user rau
                 WHERE rau.resource_id = r.id AND rau.member_id = $2
               )
               OR EXISTS (
                 SELECT 1 FROM resource_acl_group rag
                 JOIN group_membership gm ON gm.group_id = rag.group_id
                 WHERE rag.resource_id = r.id AND gm.member_id = $2
               )
             )

           UNION ALL

           SELECT concat('page.updated:', p.id) AS id,
                  'page.updated'::text AS type, editor.first_name AS "actorName",
                  editor_member.id AS "actorId",
                  p.title AS subject, p.updated_at AS "occurredAt", 'pages'::text AS view
           FROM page p
           JOIN resource r ON r.id = p.id
           JOIN page_revision latest_revision
             ON latest_revision.page_id = p.id AND latest_revision.revision_number = p.version
           JOIN instance_member editor_member ON editor_member.id = latest_revision.edited_by
           JOIN app_user editor ON editor.id = editor_member.user_id
           WHERE r.instance_id = $1 AND r.deleted_at IS NULL AND r.visibility <> 'PRIVATE'
             AND EXISTS (
               SELECT 1 FROM module_config mc
               WHERE mc.instance_id = r.instance_id
                 AND mc.module_key = 'pages' AND mc.enabled = true
             )
             AND (
               r.visibility = 'ALL_MEMBERS' OR r.created_by = $2
               OR EXISTS (
                 SELECT 1 FROM resource_acl_user rau
                 WHERE rau.resource_id = r.id AND rau.member_id = $2
               )
               OR EXISTS (
                 SELECT 1 FROM resource_acl_group rag
                 JOIN group_membership gm ON gm.group_id = rag.group_id
                 WHERE rag.resource_id = r.id AND gm.member_id = $2
               )
             )

           UNION ALL

           SELECT concat('collection.item.added:', item.id) AS id,
                  'collection.item.added'::text AS type, author.first_name AS "actorName",
                  author_member.id AS "actorId",
                  concat(item.title, ' · ', c.name) AS subject,
                  item.created_at AS "occurredAt", 'collections'::text AS view
           FROM collection_item item
           JOIN collection c ON c.id = item.collection_id
           JOIN resource r ON r.id = c.id
           JOIN instance_member author_member ON author_member.id = item.added_by
           JOIN app_user author ON author.id = author_member.user_id
           WHERE r.instance_id = $1 AND r.deleted_at IS NULL
             AND item.deleted_at IS NULL AND r.visibility <> 'PRIVATE'
             AND EXISTS (
               SELECT 1 FROM module_config mc
               WHERE mc.instance_id = r.instance_id
                 AND mc.module_key = 'collections' AND mc.enabled = true
             )
             AND (
               r.visibility = 'ALL_MEMBERS' OR r.created_by = $2
               OR EXISTS (
                 SELECT 1 FROM resource_acl_user rau
                 WHERE rau.resource_id = r.id AND rau.member_id = $2
               )
               OR EXISTS (
                 SELECT 1 FROM resource_acl_group rag
                 JOIN group_membership gm ON gm.group_id = rag.group_id
                 WHERE rag.resource_id = r.id AND gm.member_id = $2
               )
             )

           UNION ALL

           SELECT concat('poll.created:', p.id) AS id,
                  'poll.created'::text AS type, creator.first_name AS "actorName",
                  creator_member.id AS "actorId",
                  p.question AS subject, p.created_at AS "occurredAt", 'polls'::text AS view
           FROM poll p
           JOIN resource r ON r.id = p.id
           JOIN instance_member creator_member ON creator_member.id = r.created_by
           JOIN app_user creator ON creator.id = creator_member.user_id
           WHERE r.instance_id = $1 AND r.deleted_at IS NULL AND r.visibility <> 'PRIVATE'
             AND EXISTS (
               SELECT 1 FROM module_config mc
               WHERE mc.instance_id = r.instance_id
                 AND mc.module_key = 'polls' AND mc.enabled = true
             )
             AND (
               r.visibility = 'ALL_MEMBERS' OR r.created_by = $2
               OR EXISTS (
                 SELECT 1 FROM resource_acl_user rau
                 WHERE rau.resource_id = r.id AND rau.member_id = $2
               )
               OR EXISTS (
                 SELECT 1 FROM resource_acl_group rag
                 JOIN group_membership gm ON gm.group_id = rag.group_id
                 WHERE rag.resource_id = r.id AND gm.member_id = $2
               )
             )

           UNION ALL

           SELECT concat('idea.created:', i.id) AS id,
                  'idea.created'::text AS type, creator.first_name AS "actorName",
                  creator_member.id AS "actorId",
                  i.title AS subject, i.created_at AS "occurredAt", 'ideas'::text AS view
           FROM idea i
           JOIN resource r ON r.id = i.id
           JOIN instance_member creator_member ON creator_member.id = r.created_by
           JOIN app_user creator ON creator.id = creator_member.user_id
           WHERE r.instance_id = $1 AND r.deleted_at IS NULL AND r.visibility <> 'PRIVATE'
             AND EXISTS (
               SELECT 1 FROM module_config mc
               WHERE mc.instance_id = r.instance_id
                 AND mc.module_key = 'ideas' AND mc.enabled = true
             )
             AND (
               r.visibility = 'ALL_MEMBERS' OR r.created_by = $2
               OR EXISTS (
                 SELECT 1 FROM resource_acl_user rau
                 WHERE rau.resource_id = r.id AND rau.member_id = $2
               )
               OR EXISTS (
                 SELECT 1 FROM resource_acl_group rag
                 JOIN group_membership gm ON gm.group_id = rag.group_id
                 WHERE rag.resource_id = r.id AND gm.member_id = $2
               )
             )

           UNION ALL

           SELECT concat('contact.created:', c.id) AS id,
                  'contact.created'::text AS type, creator.first_name AS "actorName",
                  creator_member.id AS "actorId",
                  concat_ws(' ', c.first_name, c.last_name) AS subject,
                  c.created_at AS "occurredAt", 'contacts'::text AS view
           FROM contact c
           JOIN resource r ON r.id = c.id
           JOIN instance_member creator_member ON creator_member.id = r.created_by
           JOIN app_user creator ON creator.id = creator_member.user_id
           WHERE r.instance_id = $1 AND r.deleted_at IS NULL AND r.visibility <> 'PRIVATE'
             AND EXISTS (
               SELECT 1 FROM module_config mc
               WHERE mc.instance_id = r.instance_id
                 AND mc.module_key = 'contacts' AND mc.enabled = true
             )
             AND (
               r.visibility = 'ALL_MEMBERS' OR r.created_by = $2
               OR EXISTS (
                 SELECT 1 FROM resource_acl_user rau
                 WHERE rau.resource_id = r.id AND rau.member_id = $2
               )
               OR EXISTS (
                 SELECT 1 FROM resource_acl_group rag
                 JOIN group_membership gm ON gm.group_id = rag.group_id
                 WHERE rag.resource_id = r.id AND gm.member_id = $2
               )
             )

           UNION ALL

           SELECT concat('document.created:', d.id) AS id,
                  'document.created'::text AS type, creator.first_name AS "actorName",
                  creator_member.id AS "actorId",
                  d.title AS subject, d.created_at AS "occurredAt", 'documents'::text AS view
           FROM document d
           JOIN resource r ON r.id = d.id
           JOIN instance_member creator_member ON creator_member.id = r.created_by
           JOIN app_user creator ON creator.id = creator_member.user_id
           WHERE r.instance_id = $1 AND r.deleted_at IS NULL AND r.visibility <> 'PRIVATE'
             AND EXISTS (
               SELECT 1 FROM module_config mc
               WHERE mc.instance_id = r.instance_id
                 AND mc.module_key = 'documents' AND mc.enabled = true
             )
             AND (
               r.visibility = 'ALL_MEMBERS' OR r.created_by = $2
               OR EXISTS (
                 SELECT 1 FROM resource_acl_user rau
                 WHERE rau.resource_id = r.id AND rau.member_id = $2
               )
               OR EXISTS (
                 SELECT 1 FROM resource_acl_group rag
                 JOIN group_membership gm ON gm.group_id = rag.group_id
                 WHERE rag.resource_id = r.id AND gm.member_id = $2
               )
             )

           UNION ALL

           SELECT concat('collection.item.recommended:', recommendation.id) AS id,
                  'collection.item.recommended'::text AS type,
                  sender.first_name AS "actorName",
                  recommendation.sender_member_id AS "actorId",
                  concat('« ', item.title,
                    CASE WHEN $4 = 'en' THEN ' » to ' ELSE ' » à ' END,
                    recipient.first_name) AS subject,
                  recommendation.created_at AS "occurredAt", 'collections'::text AS view
           FROM collection_item_recommendation recommendation
           JOIN collection_item item ON item.id = recommendation.item_id
           JOIN collection c ON c.id = item.collection_id
           JOIN resource r ON r.id = c.id
           JOIN instance_member sender_member
             ON sender_member.id = recommendation.sender_member_id
           JOIN app_user sender ON sender.id = sender_member.user_id
           JOIN instance_member recipient_member
             ON recipient_member.id = recommendation.recipient_member_id
           JOIN app_user recipient ON recipient.id = recipient_member.user_id
           WHERE recommendation.instance_id = $1
             AND item.deleted_at IS NULL AND r.deleted_at IS NULL
             AND ($2 = recommendation.sender_member_id
               OR $2 = recommendation.recipient_member_id)
             AND EXISTS (
               SELECT 1 FROM module_config mc
               WHERE mc.instance_id = recommendation.instance_id
                 AND mc.module_key = 'collections' AND mc.enabled = true
             )
             AND (
               r.visibility = 'ALL_MEMBERS' OR r.created_by = $2
               OR EXISTS (
                 SELECT 1 FROM resource_acl_user rau
                 WHERE rau.resource_id = r.id AND rau.member_id = $2
               )
               OR EXISTS (
                 SELECT 1 FROM resource_acl_group rag
                 JOIN group_membership gm ON gm.group_id = rag.group_id
                 WHERE rag.resource_id = r.id AND gm.member_id = $2
               )
             )

           UNION ALL

           SELECT concat('music.recommended:', recommendation.id) AS id,
                  'music.recommended'::text AS type, sender.first_name AS "actorName",
                  recommendation.sender_member_id AS "actorId",
                  concat(
                    CASE WHEN recommendation.kind = 'TRACK' THEN 'un titre à ' ELSE 'un artiste à ' END,
                    recipient.first_name
                  ) AS subject,
                  recommendation.created_at AS "occurredAt", 'music'::text AS view
           FROM music_recommendation recommendation
           JOIN instance_member sender_member ON sender_member.id = recommendation.sender_member_id
           JOIN app_user sender ON sender.id = sender_member.user_id
           JOIN instance_member recipient_member ON recipient_member.id = recommendation.recipient_member_id
           JOIN app_user recipient ON recipient.id = recipient_member.user_id
           WHERE recommendation.instance_id = $1 AND recommendation.expires_at > now()
             AND EXISTS (
               SELECT 1 FROM module_config mc
               WHERE mc.instance_id = recommendation.instance_id
                 AND mc.module_key = 'music' AND mc.enabled = true
             )
         ) events
         LEFT JOIN member_profile_preference actor_profile
           ON actor_profile.member_id = events."actorId"
         ORDER BY "occurredAt" DESC
         LIMIT 12`,
        [
          request.session?.instanceId,
          request.session?.id,
          request.session?.role,
          request.session?.locale,
        ],
      ),
    ]);

    const unreadNotificationCount = unreadResult.rows[0]?.count ?? 0;
    const unreadConversationCount = chatResult.rows[0]?.count ?? 0;
    const pendingShoppingCount = shoppingResult.rows[0]?.count ?? 0;
    const activeTaskCount = taskResult.rows[0]?.count ?? 0;
    const musicRecommendationCount = musicResult.rows[0]?.count ?? 0;
    const attention: HomeAttention[] = [];
    const english = request.session?.locale === 'en';

    if (unreadConversationCount) {
      attention.push({
        id: 'chat',
        count: unreadConversationCount,
        title: 'Messages',
        detail: english
          ? `${unreadConversationCount} conversation${unreadConversationCount > 1 ? 's' : ''} with new messages`
          : `${unreadConversationCount} conversation${unreadConversationCount > 1 ? 's' : ''} avec de nouveaux messages`,
        view: 'chat',
      });
    }

    if (unreadNotificationCount) {
      attention.push({
        id: 'notifications',
        count: unreadNotificationCount,
        title: 'Notifications',
        detail: english
          ? `${unreadNotificationCount} new notification${unreadNotificationCount > 1 ? 's' : ''}`
          : `${unreadNotificationCount} nouvelle${unreadNotificationCount > 1 ? 's' : ''} à consulter`,
        view: 'notifications',
      });
    }
    if (musicRecommendationCount) {
      attention.push({
        id: 'music',
        count: musicRecommendationCount,
        title: english ? 'Music recommendations' : 'Recommandations musicales',
        detail: english
          ? `${musicRecommendationCount} recommendation${musicRecommendationCount > 1 ? 's' : ''} received`
          : `${musicRecommendationCount} recommandation${musicRecommendationCount > 1 ? 's' : ''} reçue${musicRecommendationCount > 1 ? 's' : ''}`,
        view: 'music',
      });
    }
    if (pendingShoppingCount) {
      attention.push({
        id: 'shopping',
        count: pendingShoppingCount,
        title: english ? 'Shopping list' : 'Liste de courses',
        detail: english
          ? `${pendingShoppingCount} item${pendingShoppingCount > 1 ? 's' : ''} to buy`
          : `${pendingShoppingCount} article${pendingShoppingCount > 1 ? 's' : ''} à acheter`,
        view: 'shopping',
      });
    }
    if (activeTaskCount) {
      attention.push({
        id: 'tasks',
        count: activeTaskCount,
        title: english ? 'Tasks and chores' : 'Tâches et corvées',
        detail: english
          ? `${activeTaskCount} item${activeTaskCount > 1 ? 's' : ''} to do`
          : `${activeTaskCount} élément${activeTaskCount > 1 ? 's' : ''} à faire`,
        view: 'tasks',
      });
    }
    return {
      attention,
      activity: activityResult.rows.map(
        ({ actorAvatarAttachmentId, ...row }): HomeActivity => ({
          ...row,
          actorAvatarUrl: actorAvatarAttachmentId
            ? `/api/v1/attachments/${actorAvatarAttachmentId}/content`
            : null,
          occurredAt: row.occurredAt.toISOString(),
        }),
      ),
      todayMeals: todayMealsResult.rows,
      unreadNotificationCount,
    } satisfies HomeSummary;
  });
}
