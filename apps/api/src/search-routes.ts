import { searchQuerySchema, type SearchResult } from '@familyhub/contracts';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

import { createSessionGuard } from './auth.js';
import { reopenAvailableTasks } from './task-routes.js';

type SearchRow = Omit<SearchResult, 'updatedAt'> & { updatedAt: Date };

export async function registerSearchRoutes(app: FastifyInstance, pool: Pool) {
  const requireSession = createSessionGuard(pool);

  app.get<{ Querystring: { q?: string } }>(
    '/api/v1/search',
    { preHandler: requireSession },
    async (request, reply) => {
      const parsed = searchQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'INVALID_REQUEST', details: parsed.error.flatten() });
      }

      const pattern = `%${parsed.data.q}%`;
      await reopenAvailableTasks(pool, request.session!.instanceId);
      const result = await pool.query<SearchRow>(
        `SELECT * FROM (
           SELECT m.id, 'member'::text AS type,
                  concat_ws(' ', u.first_name, u.last_name) AS title,
                  u.email AS description, 'members'::text AS view,
                  m.joined_at AS "updatedAt", 0 AS type_order
           FROM instance_member m
           JOIN app_user u ON u.id = m.user_id
           WHERE m.instance_id = $1 AND m.status = 'ACTIVE'
             AND concat_ws(' ', u.first_name, u.last_name, u.email) ILIKE $2

           UNION ALL

           SELECT i.id, 'shopping'::text AS type, i.name AS title,
                  concat_ws(' · ', NULLIF(i.quantity, ''), NULLIF(i.note, '')) AS description,
                  'shopping'::text AS view, i.updated_at AS "updatedAt", 1 AS type_order
           FROM shopping_item i
           WHERE i.instance_id = $1 AND i.deleted_at IS NULL
             AND concat_ws(' ', i.name, i.quantity, i.note) ILIKE $2
             AND EXISTS (
               SELECT 1 FROM module_config mc
               WHERE mc.instance_id = i.instance_id
                 AND mc.module_key = 'shopping' AND mc.enabled = true
             )

           UNION ALL

           SELECT t.id, 'task'::text AS type, t.title,
                  concat_ws(' · ', NULLIF(t.description, ''),
                    CASE t.status
                      WHEN 'OPEN' THEN 'À faire'
                      WHEN 'IN_PROGRESS' THEN 'En cours'
                      WHEN 'DONE' THEN 'Terminée'
                      ELSE 'Annulée'
                    END) AS description,
                  'tasks'::text AS view, t.updated_at AS "updatedAt", 2 AS type_order
           FROM family_task t
           JOIN resource r ON r.id = t.id
           WHERE r.instance_id = $1 AND r.deleted_at IS NULL
             AND concat_ws(' ', t.title, t.description, t.frequency_hint) ILIKE $2
             AND EXISTS (
               SELECT 1 FROM module_config mc
               WHERE mc.instance_id = r.instance_id
                 AND mc.module_key = 'tasks' AND mc.enabled = true
             )
             AND (
               r.visibility = 'ALL_MEMBERS' OR r.created_by = $3
               OR EXISTS (
                 SELECT 1 FROM resource_acl_user rau
                 WHERE rau.resource_id = r.id AND rau.member_id = $3
               )
               OR EXISTS (
                 SELECT 1 FROM resource_acl_group rag
                 JOIN group_membership gm ON gm.group_id = rag.group_id
                 WHERE rag.resource_id = r.id AND gm.member_id = $3
               )
             )

           UNION ALL

           SELECT e.id, 'agenda'::text AS type, e.title,
                  concat_ws(' · ', NULLIF(e.location, ''), NULLIF(e.description, '')) AS description,
                  'agenda'::text AS view, e.updated_at AS "updatedAt", 3 AS type_order
           FROM calendar_event e
           JOIN resource r ON r.id = e.id
           WHERE r.instance_id = $1 AND r.deleted_at IS NULL
             AND concat_ws(' ', e.title, e.location, e.description) ILIKE $2
             AND EXISTS (
               SELECT 1 FROM module_config mc
               WHERE mc.instance_id = r.instance_id
                 AND mc.module_key = 'agenda' AND mc.enabled = true
             )
             AND (
               r.visibility = 'ALL_MEMBERS' OR r.created_by = $3
               OR EXISTS (
                 SELECT 1 FROM resource_acl_user rau
                 WHERE rau.resource_id = r.id AND rau.member_id = $3
               )
               OR EXISTS (
                 SELECT 1 FROM resource_acl_group rag
                 JOIN group_membership gm ON gm.group_id = rag.group_id
                 WHERE rag.resource_id = r.id AND gm.member_id = $3
               )
             )

           UNION ALL

           SELECT m.id, 'meal'::text AS type, m.name AS title,
                  concat_ws(' · ', NULLIF(m.description, ''), array_to_string(m.tags, ', ')) AS description,
                  'meals'::text AS view, m.updated_at AS "updatedAt", 4 AS type_order
           FROM meal m
           JOIN resource r ON r.id = m.id
           WHERE r.instance_id = $1 AND r.deleted_at IS NULL
             AND concat_ws(' ', m.name, m.description, m.instructions, m.comments,
                   array_to_string(m.tags, ' ')) ILIKE $2
             AND EXISTS (
               SELECT 1 FROM module_config mc
               WHERE mc.instance_id = r.instance_id
                 AND mc.module_key = 'meals' AND mc.enabled = true
             )
             AND (r.visibility = 'ALL_MEMBERS' OR r.created_by = $3)

           UNION ALL

           SELECT b.id, 'bookmark'::text AS type, b.title,
                  concat_ws(' · ', NULLIF(b.description, ''), b.url) AS description,
                  'bookmarks'::text AS view, b.updated_at AS "updatedAt", 5 AS type_order
           FROM bookmark b
           JOIN resource r ON r.id = b.id
           WHERE r.instance_id = $1 AND r.deleted_at IS NULL
             AND concat_ws(' ', b.title, b.description, b.url, (
               SELECT string_agg(t.name, ' ') FROM resource_tag rt
               JOIN tag t ON t.id = rt.tag_id WHERE rt.resource_id = b.id
             )) ILIKE $2
             AND EXISTS (
               SELECT 1 FROM module_config mc
               WHERE mc.instance_id = r.instance_id
                 AND mc.module_key = 'bookmarks' AND mc.enabled = true
             )
             AND (
               r.visibility = 'ALL_MEMBERS' OR r.created_by = $3
               OR EXISTS (
                 SELECT 1 FROM resource_acl_user rau
                 WHERE rau.resource_id = r.id AND rau.member_id = $3
               )
               OR EXISTS (
                 SELECT 1 FROM resource_acl_group rag
                 JOIN group_membership gm ON gm.group_id = rag.group_id
                 WHERE rag.resource_id = r.id AND gm.member_id = $3
               )
             )

           UNION ALL

           SELECT p.id, 'page'::text AS type, p.title,
                  concat_ws(' · ', NULLIF(p.folder, ''), NULLIF(left(p.content_text, 180), '')) AS description,
                  'pages'::text AS view, p.updated_at AS "updatedAt", 6 AS type_order
           FROM page p
           JOIN resource r ON r.id = p.id
           WHERE r.instance_id = $1 AND r.deleted_at IS NULL
             AND concat_ws(' ', p.title, p.content_text, p.folder, (
               SELECT string_agg(t.name, ' ') FROM resource_tag rt
               JOIN tag t ON t.id = rt.tag_id WHERE rt.resource_id = p.id
             )) ILIKE $2
             AND EXISTS (
               SELECT 1 FROM module_config mc
               WHERE mc.instance_id = r.instance_id
                 AND mc.module_key = 'pages' AND mc.enabled = true
             )
             AND (
               r.visibility = 'ALL_MEMBERS' OR r.created_by = $3
               OR EXISTS (
                 SELECT 1 FROM resource_acl_user rau
                 WHERE rau.resource_id = r.id AND rau.member_id = $3
               )
               OR EXISTS (
                 SELECT 1 FROM resource_acl_group rag
                 JOIN group_membership gm ON gm.group_id = rag.group_id
                 WHERE rag.resource_id = r.id AND gm.member_id = $3
               )
             )
         ) matches
         ORDER BY type_order, "updatedAt" DESC
         LIMIT 30`,
        [request.session?.instanceId, pattern, request.session?.id],
      );

      return {
        query: parsed.data.q,
        results: result.rows.map(
          (row): SearchResult => ({
            id: row.id,
            type: row.type,
            title: row.title,
            description: row.description || null,
            view: row.view,
            updatedAt: row.updatedAt.toISOString(),
          }),
        ),
      };
    },
  );
}
