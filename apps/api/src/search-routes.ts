import { searchQuerySchema, type SearchResult } from '@familyhub/contracts';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

import { createSessionGuard } from './auth.js';

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
         ) matches
         ORDER BY type_order, "updatedAt" DESC
         LIMIT 30`,
        [request.session?.instanceId, pattern],
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
