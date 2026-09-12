import {
  ideaCommentCreateSchema,
  ideaConvertSchema,
  ideaCreateSchema,
  ideaReactionSchema,
  ideasQuerySchema,
  ideaStatusUpdateSchema,
  type FamilyIdea,
  type IdeaCategory,
  type IdeaComment,
  type IdeaConversion,
  type IdeaStatus,
  type IdeaVisibility,
} from '@familyhub/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import { createSessionGuard, requireCsrf } from './auth.js';

const idSchema = z.string().uuid();

type IdeaRow = {
  id: string;
  title: string;
  description: string | null;
  category: IdeaCategory;
  status: IdeaStatus;
  visibility: IdeaVisibility;
  groupIds: string[];
  memberIds: string[];
  positiveCount: number;
  negativeCount: number;
  myReaction: number | null;
  createdBy: string;
  createdByName: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

type CommentRow = Omit<IdeaComment, 'editable' | 'createdAt'> & { createdAt: Date };
type ConversionRow = Omit<IdeaConversion, 'createdAt'> & { createdAt: Date };

const readableResource = `
  r.instance_id = $1
  AND r.deleted_at IS NULL
  AND (
    r.visibility = 'ALL_MEMBERS'
    OR r.created_by = $2
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
`;

const selectIdea = `
  SELECT i.id, i.title, i.description, i.category, i.status, r.visibility,
         CASE WHEN r.created_by = $2 THEN COALESCE(ARRAY(
           SELECT rag.group_id FROM resource_acl_group rag WHERE rag.resource_id = i.id
         ), '{}') ELSE '{}' END AS "groupIds",
         CASE WHEN r.created_by = $2 THEN COALESCE(ARRAY(
           SELECT rau.member_id FROM resource_acl_user rau WHERE rau.resource_id = i.id
         ), '{}') ELSE '{}' END AS "memberIds",
         (SELECT count(*)::int FROM idea_reaction reaction
          WHERE reaction.idea_id = i.id AND reaction.value = 1) AS "positiveCount",
         (SELECT count(*)::int FROM idea_reaction reaction
          WHERE reaction.idea_id = i.id AND reaction.value = -1) AS "negativeCount",
         (SELECT reaction.value::int FROM idea_reaction reaction
          WHERE reaction.idea_id = i.id AND reaction.member_id = $2) AS "myReaction",
         r.created_by AS "createdBy", creator.first_name AS "createdByName",
         i.version, i.created_at AS "createdAt", i.updated_at AS "updatedAt"
  FROM idea i
  JOIN resource r ON r.id = i.id
  JOIN instance_member creator_member ON creator_member.id = r.created_by
  JOIN app_user creator ON creator.id = creator_member.user_id
`;

async function requireIdeasModule(
  request: FastifyRequest,
  reply: FastifyReply,
  pool: Pool,
): Promise<boolean> {
  if (!request.session) return false;
  const result = await pool.query(
    `SELECT 1 FROM module_config
     WHERE instance_id = $1 AND module_key = 'ideas' AND enabled = true`,
    [request.session.instanceId],
  );
  if (!result.rowCount) {
    await reply.code(404).send({ error: 'MODULE_NOT_AVAILABLE' });
    return false;
  }
  return true;
}

async function validAudience(
  client: Pool | PoolClient,
  instanceId: string,
  visibility: IdeaVisibility,
  groupIds: string[],
  memberIds: string[],
): Promise<boolean> {
  if (visibility === 'GROUPS') {
    const selected = [...new Set(groupIds)];
    const result = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM member_group
       WHERE instance_id = $1 AND id = ANY($2::uuid[])`,
      [instanceId, selected],
    );
    return result.rows[0]?.count === selected.length;
  }
  if (visibility === 'SELECTED_USERS') {
    const selected = [...new Set(memberIds)];
    const result = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM instance_member
       WHERE instance_id = $1 AND status = 'ACTIVE' AND id = ANY($2::uuid[])`,
      [instanceId, selected],
    );
    return result.rows[0]?.count === selected.length;
  }
  return true;
}

async function replaceAudience(
  client: PoolClient,
  ideaId: string,
  visibility: IdeaVisibility,
  groupIds: string[],
  memberIds: string[],
): Promise<void> {
  if (visibility === 'GROUPS') {
    await client.query(
      `INSERT INTO resource_acl_group (resource_id, group_id)
       SELECT $1, id FROM unnest($2::uuid[]) AS selected(id) ON CONFLICT DO NOTHING`,
      [ideaId, [...new Set(groupIds)]],
    );
  }
  if (visibility === 'SELECTED_USERS') {
    await client.query(
      `INSERT INTO resource_acl_user (resource_id, member_id)
       SELECT $1, id FROM unnest($2::uuid[]) AS selected(id) ON CONFLICT DO NOTHING`,
      [ideaId, [...new Set(memberIds)]],
    );
  }
}

async function copyAudience(client: PoolClient, sourceId: string, targetId: string): Promise<void> {
  await client.query(
    `INSERT INTO resource_acl_group (resource_id, group_id)
     SELECT $2, group_id FROM resource_acl_group WHERE resource_id = $1`,
    [sourceId, targetId],
  );
  await client.query(
    `INSERT INTO resource_acl_user (resource_id, member_id)
     SELECT $2, member_id FROM resource_acl_user WHERE resource_id = $1`,
    [sourceId, targetId],
  );
}

async function loadComments(
  client: Pool | PoolClient,
  ideaId: string,
  memberId: string,
  ownerId: string,
): Promise<IdeaComment[]> {
  const result = await client.query<CommentRow>(
    `SELECT comment.id, comment.body, comment.member_id AS "authorId",
            author.first_name AS "authorName", comment.created_at AS "createdAt"
     FROM idea_comment comment
     JOIN instance_member author_member ON author_member.id = comment.member_id
     JOIN app_user author ON author.id = author_member.user_id
     WHERE comment.idea_id = $1 AND comment.deleted_at IS NULL
     ORDER BY comment.created_at`,
    [ideaId],
  );
  return result.rows.map((comment) => ({
    ...comment,
    editable: comment.authorId === memberId || ownerId === memberId,
    createdAt: comment.createdAt.toISOString(),
  }));
}

async function loadConversion(
  client: Pool | PoolClient,
  ideaId: string,
): Promise<IdeaConversion | null> {
  const result = await client.query<ConversionRow>(
    `SELECT conversion.id, conversion.target_type AS "targetType",
            conversion.target_id AS "targetId", converter.first_name AS "convertedByName",
            conversion.created_at AS "createdAt"
     FROM idea_conversion conversion
     JOIN instance_member converter_member ON converter_member.id = conversion.converted_by
     JOIN app_user converter ON converter.id = converter_member.user_id
     WHERE conversion.idea_id = $1`,
    [ideaId],
  );
  const row = result.rows[0];
  return row ? { ...row, createdAt: row.createdAt.toISOString() } : null;
}

async function serializeIdea(
  client: Pool | PoolClient,
  row: IdeaRow,
  memberId: string,
): Promise<FamilyIdea> {
  const [comments, conversion] = await Promise.all([
    loadComments(client, row.id, memberId, row.createdBy),
    loadConversion(client, row.id),
  ]);
  return {
    ...row,
    myReaction: row.myReaction === -1 || row.myReaction === 1 ? row.myReaction : null,
    comments,
    conversion,
    editable: row.createdBy === memberId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadIdea(
  client: Pool | PoolClient,
  ideaId: string,
  instanceId: string,
  memberId: string,
): Promise<FamilyIdea | null> {
  const result = await client.query<IdeaRow>(
    `${selectIdea} WHERE i.id = $3 AND ${readableResource}`,
    [instanceId, memberId, ideaId],
  );
  return result.rows[0] ? serializeIdea(client, result.rows[0], memberId) : null;
}

async function notifyAudience(
  client: PoolClient,
  ideaId: string,
  actorId: string,
  actorName: string,
  title: string,
): Promise<void> {
  await client.query(
    `INSERT INTO notification
       (instance_id, recipient_member_id, actor_member_id, type, module_key,
        title, body, resource_type, resource_id)
     SELECT r.instance_id, recipient.id, $2, 'IDEA_SHARED', 'ideas',
            'Nouvelle idée', concat($3::text, ' propose : « ', $4::text, ' »'),
            'idea', r.id
     FROM resource r
     JOIN instance_member recipient ON recipient.instance_id = r.instance_id
     WHERE r.id = $1 AND r.deleted_at IS NULL
       AND recipient.status = 'ACTIVE' AND recipient.id <> $2
       AND (
         r.visibility = 'ALL_MEMBERS'
         OR EXISTS (SELECT 1 FROM resource_acl_user rau
                    WHERE rau.resource_id = r.id AND rau.member_id = recipient.id)
         OR EXISTS (SELECT 1 FROM resource_acl_group rag
                    JOIN group_membership gm ON gm.group_id = rag.group_id
                    WHERE rag.resource_id = r.id AND gm.member_id = recipient.id)
       )`,
    [ideaId, actorId, actorName, title],
  );
}

async function moduleEnabled(
  client: Pool | PoolClient,
  instanceId: string,
  moduleKey: 'agenda' | 'tasks' | 'collections',
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM module_config
     WHERE instance_id = $1 AND module_key = $2 AND enabled = true`,
    [instanceId, moduleKey],
  );
  return Boolean(result.rowCount);
}

export async function registerIdeaRoutes(app: FastifyInstance, pool: Pool) {
  const requireSession = createSessionGuard(pool);

  app.get('/api/v1/ideas', { preHandler: requireSession }, async (request, reply) => {
    if (!(await requireIdeasModule(request, reply, pool))) return;
    const parsed = ideasQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const session = request.session!;
    const { before, beforeId, category, limit, q, scope, status } = parsed.data;
    const result = await pool.query<IdeaRow>(
      `${selectIdea}
       WHERE ${readableResource}
         AND ($3 = 'all' OR ($3 = 'mine' AND r.created_by = $2)
              OR ($3 = 'shared' AND r.created_by <> $2))
         AND ($4 = 'ALL' OR i.status = $4)
         AND ($5::text IS NULL OR i.category = $5)
         AND ($6::text IS NULL OR concat_ws(' ', i.title, i.description) ILIKE concat('%', $6::text, '%'))
         AND ($7::timestamptz IS NULL OR (i.updated_at, i.id) < ($7::timestamptz, $8::uuid))
       ORDER BY i.updated_at DESC, i.id DESC LIMIT $9`,
      [
        session.instanceId,
        session.id,
        scope,
        status,
        category ?? null,
        q ?? null,
        before ?? null,
        beforeId ?? null,
        limit + 1,
      ],
    );
    const rows = result.rows.slice(0, limit);
    return {
      ideas: await Promise.all(rows.map((row) => serializeIdea(pool, row, session.id))),
      hasMore: result.rows.length > limit,
    };
  });

  app.get('/api/v1/ideas/:id', { preHandler: requireSession }, async (request, reply) => {
    if (!(await requireIdeasModule(request, reply, pool))) return;
    const id = idSchema.safeParse((request.params as { id?: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const session = request.session!;
    const idea = await loadIdea(pool, id.data, session.instanceId, session.id);
    if (!idea) return reply.code(404).send({ error: 'IDEA_NOT_FOUND' });
    return { idea };
  });

  app.post(
    '/api/v1/ideas',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireIdeasModule(request, reply, pool))) return;
      const parsed = ideaCreateSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const session = request.session!;
      const existing = await pool.query<{ id: string }>(
        'SELECT id FROM idea WHERE instance_id = $1 AND client_mutation_id = $2',
        [session.instanceId, parsed.data.clientMutationId],
      );
      if (existing.rows[0]) {
        return { idea: await loadIdea(pool, existing.rows[0].id, session.instanceId, session.id) };
      }
      if (
        !(await validAudience(
          pool,
          session.instanceId,
          parsed.data.visibility,
          parsed.data.groupIds,
          parsed.data.memberIds,
        ))
      ) {
        return reply.code(400).send({ error: 'INVALID_AUDIENCE' });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const resource = await client.query<{ id: string }>(
          `INSERT INTO resource (instance_id, resource_type, created_by, visibility)
           VALUES ($1, 'idea', $2, $3) RETURNING id`,
          [session.instanceId, session.id, parsed.data.visibility],
        );
        const ideaId = resource.rows[0]!.id;
        await client.query(
          `INSERT INTO idea
             (id, instance_id, title, description, category, client_mutation_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            ideaId,
            session.instanceId,
            parsed.data.title,
            parsed.data.description ?? null,
            parsed.data.category,
            parsed.data.clientMutationId,
          ],
        );
        await replaceAudience(
          client,
          ideaId,
          parsed.data.visibility,
          parsed.data.groupIds,
          parsed.data.memberIds,
        );
        await notifyAudience(client, ideaId, session.id, session.firstName, parsed.data.title);
        await client.query('COMMIT');
        return reply.code(201).send({
          idea: await loadIdea(pool, ideaId, session.instanceId, session.id),
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.patch(
    '/api/v1/ideas/:id/status',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireIdeasModule(request, reply, pool))) return;
      const id = idSchema.safeParse((request.params as { id?: string }).id);
      const parsed = ideaStatusUpdateSchema.safeParse(request.body);
      if (!id.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const session = request.session!;
      const result = await pool.query(
        `UPDATE idea i SET status = $4, version = i.version + 1, updated_at = now()
         FROM resource r
         WHERE i.id = $1 AND r.id = i.id AND r.instance_id = $2 AND r.created_by = $3
           AND r.deleted_at IS NULL AND i.version = $5
           AND NOT EXISTS (SELECT 1 FROM idea_conversion conversion WHERE conversion.idea_id = i.id)`,
        [id.data, session.instanceId, session.id, parsed.data.status, parsed.data.version],
      );
      if (!result.rowCount) {
        const exists = await pool.query(
          `SELECT 1 FROM idea i JOIN resource r ON r.id = i.id
           WHERE i.id = $1 AND r.instance_id = $2 AND r.created_by = $3 AND r.deleted_at IS NULL`,
          [id.data, session.instanceId, session.id],
        );
        return reply.code(exists.rowCount ? 409 : 404).send({
          error: exists.rowCount ? 'VERSION_CONFLICT' : 'IDEA_NOT_FOUND',
        });
      }
      await pool.query('UPDATE resource SET updated_at = now() WHERE id = $1', [id.data]);
      return { idea: await loadIdea(pool, id.data, session.instanceId, session.id) };
    },
  );

  app.put(
    '/api/v1/ideas/:id/reaction',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireIdeasModule(request, reply, pool))) return;
      const id = idSchema.safeParse((request.params as { id?: string }).id);
      const parsed = ideaReactionSchema.safeParse(request.body);
      if (!id.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const session = request.session!;
      if (!(await loadIdea(pool, id.data, session.instanceId, session.id))) {
        return reply.code(404).send({ error: 'IDEA_NOT_FOUND' });
      }
      if (parsed.data.value === null) {
        await pool.query('DELETE FROM idea_reaction WHERE idea_id = $1 AND member_id = $2', [
          id.data,
          session.id,
        ]);
      } else {
        await pool.query(
          `INSERT INTO idea_reaction (idea_id, member_id, value) VALUES ($1, $2, $3)
           ON CONFLICT (idea_id, member_id)
           DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [id.data, session.id, parsed.data.value],
        );
      }
      await pool.query('UPDATE idea SET updated_at = now() WHERE id = $1', [id.data]);
      await pool.query('UPDATE resource SET updated_at = now() WHERE id = $1', [id.data]);
      return { idea: await loadIdea(pool, id.data, session.instanceId, session.id) };
    },
  );

  app.post(
    '/api/v1/ideas/:id/comments',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireIdeasModule(request, reply, pool))) return;
      const id = idSchema.safeParse((request.params as { id?: string }).id);
      const parsed = ideaCommentCreateSchema.safeParse(request.body);
      if (!id.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const session = request.session!;
      if (!(await loadIdea(pool, id.data, session.instanceId, session.id))) {
        return reply.code(404).send({ error: 'IDEA_NOT_FOUND' });
      }
      await pool.query(
        `INSERT INTO idea_comment (idea_id, member_id, body, client_mutation_id)
         VALUES ($1, $2, $3, $4) ON CONFLICT (idea_id, client_mutation_id) DO NOTHING`,
        [id.data, session.id, parsed.data.body, parsed.data.clientMutationId],
      );
      await pool.query('UPDATE idea SET updated_at = now() WHERE id = $1', [id.data]);
      await pool.query('UPDATE resource SET updated_at = now() WHERE id = $1', [id.data]);
      return reply.code(201).send({
        idea: await loadIdea(pool, id.data, session.instanceId, session.id),
      });
    },
  );

  app.delete(
    '/api/v1/ideas/:id/comments/:commentId',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireIdeasModule(request, reply, pool))) return;
      const params = request.params as { id?: string; commentId?: string };
      const id = idSchema.safeParse(params.id);
      const commentId = idSchema.safeParse(params.commentId);
      if (!id.success || !commentId.success)
        return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const session = request.session!;
      const idea = await loadIdea(pool, id.data, session.instanceId, session.id);
      if (!idea) return reply.code(404).send({ error: 'IDEA_NOT_FOUND' });
      const result = await pool.query(
        `UPDATE idea_comment SET deleted_at = now()
         WHERE id = $1 AND idea_id = $2 AND deleted_at IS NULL
           AND (member_id = $3 OR $4::boolean)`,
        [commentId.data, idea.id, session.id, idea.editable],
      );
      if (!result.rowCount) return reply.code(404).send({ error: 'COMMENT_NOT_FOUND' });
      return reply.code(204).send();
    },
  );

  app.post(
    '/api/v1/ideas/:id/convert',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireIdeasModule(request, reply, pool))) return;
      const id = idSchema.safeParse((request.params as { id?: string }).id);
      const parsed = ideaConvertSchema.safeParse(request.body);
      if (!id.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const session = request.session!;
      const targetModule =
        parsed.data.target === 'TASK'
          ? 'tasks'
          : parsed.data.target === 'EVENT'
            ? 'agenda'
            : 'collections';
      if (!(await moduleEnabled(pool, session.instanceId, targetModule))) {
        return reply.code(409).send({ error: 'TARGET_MODULE_NOT_AVAILABLE' });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const locked = await client.query<{
          title: string;
          description: string | null;
          status: IdeaStatus;
          visibility: IdeaVisibility;
          createdBy: string;
        }>(
          `SELECT i.title, i.description, i.status, r.visibility,
                  r.created_by AS "createdBy"
           FROM idea i JOIN resource r ON r.id = i.id
           WHERE i.id = $1 AND r.instance_id = $2 AND r.deleted_at IS NULL
           FOR UPDATE OF i`,
          [id.data, session.instanceId],
        );
        const idea = locked.rows[0];
        if (!idea || idea.createdBy !== session.id) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'IDEA_NOT_FOUND' });
        }
        const existing = await client.query<{
          id: string;
          targetType: 'TASK' | 'EVENT' | 'COLLECTION_ITEM';
          targetId: string;
        }>(
          `SELECT id, target_type AS "targetType", target_id AS "targetId"
           FROM idea_conversion WHERE idea_id = $1`,
          [id.data],
        );
        if (existing.rows[0]) {
          if (existing.rows[0].targetType !== parsed.data.target) {
            await client.query('ROLLBACK');
            return reply.code(409).send({ error: 'IDEA_ALREADY_CONVERTED' });
          }
          await client.query('COMMIT');
          return { idea: await loadIdea(pool, id.data, session.instanceId, session.id) };
        }
        if (idea.status !== 'RETAINED') {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'IDEA_NOT_RETAINED' });
        }

        let targetId: string;
        if (parsed.data.target === 'TASK') {
          const resource = await client.query<{ id: string }>(
            `INSERT INTO resource (instance_id, resource_type, created_by, visibility)
             VALUES ($1, 'task', $2, $3) RETURNING id`,
            [session.instanceId, session.id, idea.visibility],
          );
          targetId = resource.rows[0]!.id;
          await copyAudience(client, id.data, targetId);
          await client.query(
            `INSERT INTO family_task
               (id, instance_id, title, description, kind, claimable, client_mutation_id)
             VALUES ($1, $2, $3, $4, 'OPEN_CHORE', true, $5)`,
            [
              targetId,
              session.instanceId,
              idea.title,
              idea.description,
              parsed.data.clientMutationId,
            ],
          );
        } else if (parsed.data.target === 'EVENT') {
          const resource = await client.query<{ id: string }>(
            `INSERT INTO resource (instance_id, resource_type, created_by, visibility)
             VALUES ($1, 'calendar_event', $2, $3) RETURNING id`,
            [session.instanceId, session.id, idea.visibility],
          );
          targetId = resource.rows[0]!.id;
          await copyAudience(client, id.data, targetId);
          const timezone = await client.query<{ timezone: string }>(
            'SELECT timezone FROM instance WHERE id = $1',
            [session.instanceId],
          );
          await client.query(
            `INSERT INTO calendar_event
               (id, instance_id, title, description, event_type, start_at, end_at,
                recurrence_timezone, client_mutation_id)
             VALUES ($1, $2, $3, $4, 'EVENT', $5, $6, $7, $8)`,
            [
              targetId,
              session.instanceId,
              idea.title,
              idea.description,
              parsed.data.startsAt,
              parsed.data.endsAt,
              timezone.rows[0]?.timezone ?? 'Europe/Paris',
              parsed.data.clientMutationId,
            ],
          );
          await client.query(
            `INSERT INTO calendar_event_participant (event_id, member_id, response, responded_at)
             VALUES ($1, $2, 'YES', now())`,
            [targetId, session.id],
          );
        } else {
          const collection = await client.query<{ id: string }>(
            `SELECT c.id FROM collection c JOIN resource r ON r.id = c.id
             WHERE c.id = $3 AND ${readableResource}`,
            [session.instanceId, session.id, parsed.data.collectionId],
          );
          if (!collection.rows[0]) {
            await client.query('ROLLBACK');
            return reply.code(404).send({ error: 'COLLECTION_NOT_FOUND' });
          }
          const item = await client.query<{ id: string }>(
            `INSERT INTO collection_item
               (collection_id, instance_id, title, description, metadata_json,
                added_by, client_mutation_id)
             VALUES ($1, $2, $3, $4, '{}'::jsonb, $5, $6) RETURNING id`,
            [
              parsed.data.collectionId,
              session.instanceId,
              idea.title,
              idea.description,
              session.id,
              parsed.data.clientMutationId,
            ],
          );
          targetId = item.rows[0]!.id;
          await client.query('UPDATE collection SET updated_at = now() WHERE id = $1', [
            parsed.data.collectionId,
          ]);
          await client.query('UPDATE resource SET updated_at = now() WHERE id = $1', [
            parsed.data.collectionId,
          ]);
        }

        await client.query(
          `INSERT INTO idea_conversion
             (idea_id, target_type, target_id, converted_by, client_mutation_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [id.data, parsed.data.target, targetId, session.id, parsed.data.clientMutationId],
        );
        await client.query(
          `UPDATE idea SET status = 'REALIZED', version = version + 1, updated_at = now()
           WHERE id = $1`,
          [id.data],
        );
        await client.query('UPDATE resource SET updated_at = now() WHERE id = $1', [id.data]);
        await client.query('COMMIT');
        return reply.code(201).send({
          idea: await loadIdea(pool, id.data, session.instanceId, session.id),
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.delete(
    '/api/v1/ideas/:id',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireIdeasModule(request, reply, pool))) return;
      const id = idSchema.safeParse((request.params as { id?: string }).id);
      if (!id.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const session = request.session!;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(
          `UPDATE resource SET deleted_at = now(), updated_at = now()
           WHERE id = $1 AND instance_id = $2 AND created_by = $3 AND deleted_at IS NULL`,
          [id.data, session.instanceId, session.id],
        );
        if (!result.rowCount) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'IDEA_NOT_FOUND' });
        }
        await client.query(
          `DELETE FROM notification WHERE resource_type = 'idea' AND resource_id = $1`,
          [id.data],
        );
        await client.query('COMMIT');
        return reply.code(204).send();
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );
}
