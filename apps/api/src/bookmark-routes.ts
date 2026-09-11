import {
  bookmarkCreateSchema,
  bookmarksQuerySchema,
  bookmarkUpdateSchema,
  type BookmarkVisibility,
  type FamilyBookmark,
} from '@familyhub/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import { createSessionGuard, requireCsrf } from './auth.js';

const idSchema = z.string().uuid();

type BookmarkRow = {
  id: string;
  url: string;
  title: string;
  description: string | null;
  personalComment: string | null;
  faviconUrl: string | null;
  imageUrl: string | null;
  tags: string[];
  visibility: BookmarkVisibility;
  groupIds: string[];
  memberIds: string[];
  createdBy: string;
  createdByName: string;
  favorite: boolean;
  usefulCount: number;
  usefulByMe: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

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

const selectBookmark = `
  SELECT b.id, b.url, b.title, b.description,
         CASE WHEN r.created_by = $2 THEN b.personal_comment ELSE NULL END AS "personalComment",
         b.favicon_url AS "faviconUrl", b.og_image_url AS "imageUrl",
         COALESCE(ARRAY(
           SELECT t.name FROM resource_tag rt JOIN tag t ON t.id = rt.tag_id
           WHERE rt.resource_id = b.id ORDER BY lower(t.name)
         ), '{}') AS tags,
         r.visibility,
         CASE WHEN r.created_by = $2 THEN COALESCE(ARRAY(
           SELECT rag.group_id FROM resource_acl_group rag WHERE rag.resource_id = b.id
         ), '{}') ELSE '{}' END AS "groupIds",
         CASE WHEN r.created_by = $2 THEN COALESCE(ARRAY(
           SELECT rau.member_id FROM resource_acl_user rau WHERE rau.resource_id = b.id
         ), '{}') ELSE '{}' END AS "memberIds",
         r.created_by AS "createdBy", creator.first_name AS "createdByName",
         EXISTS(SELECT 1 FROM favorite f WHERE f.resource_id = b.id AND f.member_id = $2) AS favorite,
         (SELECT count(*)::int FROM bookmark_reaction br
          WHERE br.bookmark_id = b.id AND br.reaction = 'USEFUL') AS "usefulCount",
         EXISTS(SELECT 1 FROM bookmark_reaction br
                WHERE br.bookmark_id = b.id AND br.member_id = $2
                  AND br.reaction = 'USEFUL') AS "usefulByMe",
         b.version, b.created_at AS "createdAt", b.updated_at AS "updatedAt"
  FROM bookmark b
  JOIN resource r ON r.id = b.id
  JOIN instance_member creator_member ON creator_member.id = r.created_by
  JOIN app_user creator ON creator.id = creator_member.user_id
`;

async function requireBookmarksModule(
  request: FastifyRequest,
  reply: FastifyReply,
  pool: Pool,
): Promise<boolean> {
  if (!request.session) return false;
  const result = await pool.query(
    `SELECT 1 FROM module_config
     WHERE instance_id = $1 AND module_key = 'bookmarks' AND enabled = true`,
    [request.session.instanceId],
  );
  if (!result.rowCount) {
    await reply.code(404).send({ error: 'MODULE_NOT_AVAILABLE' });
    return false;
  }
  return true;
}

function serializeBookmark(row: BookmarkRow, memberId: string): FamilyBookmark {
  return {
    ...row,
    hostname: new URL(row.url).hostname.replace(/^www\./, ''),
    editable: row.createdBy === memberId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function normalizedUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  return url.href;
}

function normalizedTags(tags: string[]): Array<{ name: string; normalized: string }> {
  const unique = new Map<string, string>();
  for (const value of tags) {
    const name = value.trim().replace(/\s+/g, ' ');
    const normalized = name.toLocaleLowerCase('fr');
    if (name && !unique.has(normalized)) unique.set(normalized, name);
  }
  return [...unique].map(([normalized, name]) => ({ name, normalized }));
}

async function validAudience(
  client: Pool | PoolClient,
  instanceId: string,
  visibility: BookmarkVisibility,
  groupIds: string[],
  memberIds: string[],
): Promise<boolean> {
  if (visibility === 'GROUPS') {
    const unique = [...new Set(groupIds)];
    const result = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM member_group
       WHERE instance_id = $1 AND id = ANY($2::uuid[])`,
      [instanceId, unique],
    );
    return result.rows[0]?.count === unique.length;
  }
  if (visibility === 'SELECTED_USERS') {
    const unique = [...new Set(memberIds)];
    const result = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM instance_member
       WHERE instance_id = $1 AND status = 'ACTIVE' AND id = ANY($2::uuid[])`,
      [instanceId, unique],
    );
    return result.rows[0]?.count === unique.length;
  }
  return true;
}

async function replaceAudience(
  client: PoolClient,
  bookmarkId: string,
  visibility: BookmarkVisibility,
  groupIds: string[],
  memberIds: string[],
): Promise<void> {
  await client.query('DELETE FROM resource_acl_group WHERE resource_id = $1', [bookmarkId]);
  await client.query('DELETE FROM resource_acl_user WHERE resource_id = $1', [bookmarkId]);
  if (visibility === 'GROUPS') {
    await client.query(
      `INSERT INTO resource_acl_group (resource_id, group_id)
       SELECT $1, id FROM unnest($2::uuid[]) AS selected(id) ON CONFLICT DO NOTHING`,
      [bookmarkId, [...new Set(groupIds)]],
    );
  }
  if (visibility === 'SELECTED_USERS') {
    await client.query(
      `INSERT INTO resource_acl_user (resource_id, member_id)
       SELECT $1, id FROM unnest($2::uuid[]) AS selected(id) ON CONFLICT DO NOTHING`,
      [bookmarkId, [...new Set(memberIds)]],
    );
  }
}

async function replaceTags(
  client: PoolClient,
  bookmarkId: string,
  instanceId: string,
  memberId: string,
  tags: string[],
): Promise<void> {
  await client.query('DELETE FROM resource_tag WHERE resource_id = $1', [bookmarkId]);
  for (const tag of normalizedTags(tags)) {
    const result = await client.query<{ id: string }>(
      `INSERT INTO tag (instance_id, name, normalized_name, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (instance_id, normalized_name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [instanceId, tag.name, tag.normalized, memberId],
    );
    if (result.rows[0]) {
      await client.query(
        `INSERT INTO resource_tag (resource_id, tag_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [bookmarkId, result.rows[0].id],
      );
    }
  }
}

async function replaceShareNotifications(
  client: PoolClient,
  instanceId: string,
  memberId: string,
  memberName: string,
  bookmarkId: string,
  title: string,
  visibility: BookmarkVisibility,
  groupIds: string[],
  memberIds: string[],
): Promise<void> {
  await client.query(
    `DELETE FROM notification WHERE resource_type = 'bookmark' AND resource_id = $1`,
    [bookmarkId],
  );
  if (visibility === 'PRIVATE') return;
  await client.query(
    `INSERT INTO notification
       (instance_id, recipient_member_id, actor_member_id, type, module_key,
        title, body, resource_type, resource_id)
     SELECT DISTINCT $1::uuid, recipient.id, $2::uuid, 'BOOKMARK_SHARED', 'bookmarks',
            'Nouveau bookmark partagé', concat($3::text, ' recommande : ', $4::text),
            'bookmark', $5::uuid
     FROM instance_member recipient
     WHERE recipient.instance_id = $1::uuid AND recipient.status = 'ACTIVE'
       AND recipient.id <> $2::uuid
       AND (
         $6::text = 'ALL_MEMBERS'
         OR ($6::text = 'GROUPS' AND EXISTS (
           SELECT 1 FROM group_membership gm
           WHERE gm.member_id = recipient.id AND gm.group_id = ANY($7::uuid[])
         ))
         OR ($6::text = 'SELECTED_USERS' AND recipient.id = ANY($8::uuid[]))
       )`,
    [instanceId, memberId, memberName, title, bookmarkId, visibility, groupIds, memberIds],
  );
}

async function loadBookmark(
  client: Pool | PoolClient,
  bookmarkId: string,
  instanceId: string,
  memberId: string,
): Promise<FamilyBookmark | null> {
  const result = await client.query<BookmarkRow>(
    `${selectBookmark} WHERE b.id = $3 AND ${readableResource}`,
    [instanceId, memberId, bookmarkId],
  );
  return result.rows[0] ? serializeBookmark(result.rows[0], memberId) : null;
}

export async function registerBookmarkRoutes(app: FastifyInstance, pool: Pool) {
  const requireSession = createSessionGuard(pool);

  app.get('/api/v1/bookmarks', { preHandler: requireSession }, async (request, reply) => {
    if (!(await requireBookmarksModule(request, reply, pool))) return;
    const parsed = bookmarksQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const session = request.session!;
    const result = await pool.query<BookmarkRow>(
      `${selectBookmark}
       WHERE ${readableResource}
         AND (
           $3 = 'all'
           OR ($3 = 'mine' AND r.created_by = $2)
           OR ($3 = 'recommended' AND r.created_by <> $2 AND r.visibility <> 'PRIVATE')
           OR ($3 = 'favorites' AND EXISTS (
             SELECT 1 FROM favorite scope_favorite
             WHERE scope_favorite.resource_id = b.id AND scope_favorite.member_id = $2
           ))
         )
         AND ($4::text IS NULL OR concat_ws(' ', b.title, b.description, b.url) ILIKE concat('%', $4, '%'))
         AND ($5::text IS NULL OR EXISTS (
           SELECT 1 FROM resource_tag filter_rt JOIN tag filter_t ON filter_t.id = filter_rt.tag_id
           WHERE filter_rt.resource_id = b.id AND filter_t.normalized_name = lower($5)
         ))
         AND ($6::timestamptz IS NULL OR (b.updated_at, b.id) < ($6::timestamptz, $7::uuid))
       ORDER BY b.updated_at DESC, b.id DESC LIMIT $8`,
      [
        session.instanceId,
        session.id,
        parsed.data.scope,
        parsed.data.q || null,
        parsed.data.tag || null,
        parsed.data.before ?? null,
        parsed.data.beforeId ?? null,
        parsed.data.limit + 1,
      ],
    );
    const hasMore = result.rows.length > parsed.data.limit;
    return {
      bookmarks: result.rows
        .slice(0, parsed.data.limit)
        .map((row) => serializeBookmark(row, session.id)),
      hasMore,
    };
  });

  app.post(
    '/api/v1/bookmarks',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireBookmarksModule(request, reply, pool))) return;
      const parsed = bookmarkCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'INVALID_REQUEST', details: parsed.error.flatten() });
      }
      const session = request.session!;
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
        const existing = await client.query<{ id: string }>(
          'SELECT id FROM bookmark WHERE instance_id = $1 AND client_mutation_id = $2',
          [session.instanceId, parsed.data.clientMutationId],
        );
        let bookmarkId = existing.rows[0]?.id;
        if (!bookmarkId) {
          const url = normalizedUrl(parsed.data.url);
          bookmarkId = parsed.data.clientMutationId;
          await client.query(
            `INSERT INTO resource (id, instance_id, resource_type, created_by, visibility)
             VALUES ($1, $2, 'bookmark', $3, $4)`,
            [bookmarkId, session.instanceId, session.id, parsed.data.visibility],
          );
          await client.query(
            `INSERT INTO bookmark
               (id, instance_id, url, normalized_url, title, description, personal_comment,
                client_mutation_id)
             VALUES ($1, $2, $3, $3, $4, $5, $6, $1)`,
            [
              bookmarkId,
              session.instanceId,
              url,
              parsed.data.title || new URL(url).hostname.replace(/^www\./, ''),
              parsed.data.description ?? null,
              parsed.data.personalComment ?? null,
            ],
          );
          await replaceAudience(
            client,
            bookmarkId,
            parsed.data.visibility,
            parsed.data.groupIds,
            parsed.data.memberIds,
          );
          await replaceTags(client, bookmarkId, session.instanceId, session.id, parsed.data.tags);
          await replaceShareNotifications(
            client,
            session.instanceId,
            session.id,
            session.firstName,
            bookmarkId,
            parsed.data.title || new URL(url).hostname.replace(/^www\./, ''),
            parsed.data.visibility,
            parsed.data.groupIds,
            parsed.data.memberIds,
          );
        }
        const bookmark = await loadBookmark(
          client,
          bookmarkId,
          session.instanceId,
          session.id,
        );
        if (!bookmark) throw new Error('Bookmark creation returned no readable row.');
        await client.query('COMMIT');
        return reply.code(existing.rowCount ? 200 : 201).send({ bookmark });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.put(
    '/api/v1/bookmarks/:id',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireBookmarksModule(request, reply, pool))) return;
      const id = idSchema.safeParse((request.params as { id?: string }).id);
      const parsed = bookmarkUpdateSchema.safeParse(request.body);
      if (!id.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const session = request.session!;
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
        const current = await loadBookmark(client, id.data, session.instanceId, session.id);
        if (!current) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'BOOKMARK_NOT_FOUND' });
        }
        if (!current.editable) {
          await client.query('ROLLBACK');
          return reply.code(403).send({ error: 'BOOKMARK_NOT_OWNED' });
        }
        if (current.version !== parsed.data.version) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'VERSION_CONFLICT', bookmark: current });
        }
        const url = normalizedUrl(parsed.data.url);
        await client.query(
          `UPDATE resource SET visibility = $2, version = version + 1, updated_at = now()
           WHERE id = $1`,
          [id.data, parsed.data.visibility],
        );
        await client.query(
          `UPDATE bookmark SET url = $2, normalized_url = $2, title = $3, description = $4,
             personal_comment = $5, version = version + 1, updated_at = now()
           WHERE id = $1`,
          [
            id.data,
            url,
            parsed.data.title || new URL(url).hostname.replace(/^www\./, ''),
            parsed.data.description ?? null,
            parsed.data.personalComment ?? null,
          ],
        );
        await replaceAudience(
          client,
          id.data,
          parsed.data.visibility,
          parsed.data.groupIds,
          parsed.data.memberIds,
        );
        await replaceTags(client, id.data, session.instanceId, session.id, parsed.data.tags);
        await replaceShareNotifications(
          client,
          session.instanceId,
          session.id,
          session.firstName,
          id.data,
          parsed.data.title || new URL(url).hostname.replace(/^www\./, ''),
          parsed.data.visibility,
          parsed.data.groupIds,
          parsed.data.memberIds,
        );
        const bookmark = await loadBookmark(client, id.data, session.instanceId, session.id);
        await client.query('COMMIT');
        return { bookmark };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.delete(
    '/api/v1/bookmarks/:id',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireBookmarksModule(request, reply, pool))) return;
      const id = idSchema.safeParse((request.params as { id?: string }).id);
      if (!id.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(
          `UPDATE resource SET deleted_at = now(), updated_at = now()
           WHERE id = $1 AND instance_id = $2 AND resource_type = 'bookmark'
             AND created_by = $3 AND deleted_at IS NULL`,
          [id.data, request.session!.instanceId, request.session!.id],
        );
        if (!result.rowCount) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'BOOKMARK_NOT_FOUND' });
        }
        await client.query(
          `DELETE FROM notification WHERE resource_type = 'bookmark' AND resource_id = $1`,
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

  async function ensureReadable(request: FastifyRequest, bookmarkId: string) {
    return loadBookmark(
      pool,
      bookmarkId,
      request.session!.instanceId,
      request.session!.id,
    );
  }

  for (const method of ['put', 'delete'] as const) {
    app[method](
      '/api/v1/bookmarks/:id/favorite',
      { preHandler: [requireSession, requireCsrf] },
      async (request, reply) => {
        if (!(await requireBookmarksModule(request, reply, pool))) return;
        const id = idSchema.safeParse((request.params as { id?: string }).id);
        if (!id.success || !(await ensureReadable(request, id.data))) {
          return reply.code(404).send({ error: 'BOOKMARK_NOT_FOUND' });
        }
        if (method === 'put') {
          await pool.query(
            `INSERT INTO favorite (resource_id, member_id) VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [id.data, request.session!.id],
          );
        } else {
          await pool.query('DELETE FROM favorite WHERE resource_id = $1 AND member_id = $2', [
            id.data,
            request.session!.id,
          ]);
        }
        return { bookmark: await ensureReadable(request, id.data) };
      },
    );
  }

  app.post(
    '/api/v1/bookmarks/:id/useful',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireBookmarksModule(request, reply, pool))) return;
      const id = idSchema.safeParse((request.params as { id?: string }).id);
      if (!id.success || !(await ensureReadable(request, id.data))) {
        return reply.code(404).send({ error: 'BOOKMARK_NOT_FOUND' });
      }
      const removed = await pool.query(
        `DELETE FROM bookmark_reaction
         WHERE bookmark_id = $1 AND member_id = $2 AND reaction = 'USEFUL'`,
        [id.data, request.session!.id],
      );
      if (!removed.rowCount) {
        await pool.query(
          `INSERT INTO bookmark_reaction (bookmark_id, member_id, reaction)
           VALUES ($1, $2, 'USEFUL') ON CONFLICT DO NOTHING`,
          [id.data, request.session!.id],
        );
      }
      return { bookmark: await ensureReadable(request, id.data) };
    },
  );
}
