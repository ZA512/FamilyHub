import {
  pageCreateSchema,
  pagesQuerySchema,
  pageRestoreSchema,
  pageUpdateSchema,
  type FamilyPage,
  type FamilyPageSummary,
  type PageContentNode,
  type PageDocument,
  type PageRevision,
  type PageVisibility,
} from '@familyhub/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import { createSessionGuard, requireCsrf } from './auth.js';

const idSchema = z.string().uuid();

type PageRow = {
  id: string;
  title: string;
  content: PageDocument;
  contentText: string;
  excerpt: string | null;
  folder: string | null;
  tags: string[];
  visibility: PageVisibility;
  groupIds: string[];
  memberIds: string[];
  linkedPageIds: string[];
  createdBy: string;
  createdByName: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

type RevisionRow = Omit<PageRevision, 'createdAt' | 'current'> & { createdAt: Date };

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

const selectPage = `
  SELECT p.id, p.title, p.content_json AS content, p.content_text AS "contentText",
         NULLIF(left(regexp_replace(p.content_text, '\\s+', ' ', 'g'), 220), '') AS excerpt,
         p.folder,
         COALESCE(ARRAY(
           SELECT t.name FROM resource_tag rt JOIN tag t ON t.id = rt.tag_id
           WHERE rt.resource_id = p.id ORDER BY lower(t.name)
         ), '{}') AS tags,
         r.visibility,
         CASE WHEN r.created_by = $2 THEN COALESCE(ARRAY(
           SELECT rag.group_id FROM resource_acl_group rag WHERE rag.resource_id = p.id
         ), '{}') ELSE '{}' END AS "groupIds",
         CASE WHEN r.created_by = $2 THEN COALESCE(ARRAY(
           SELECT rau.member_id FROM resource_acl_user rau WHERE rau.resource_id = p.id
         ), '{}') ELSE '{}' END AS "memberIds",
         COALESCE(ARRAY(
           SELECT pl.target_page_id FROM page_link pl WHERE pl.source_page_id = p.id
           ORDER BY pl.target_page_id
         ), '{}') AS "linkedPageIds",
         r.created_by AS "createdBy", creator.first_name AS "createdByName",
         p.version, p.created_at AS "createdAt", p.updated_at AS "updatedAt"
  FROM page p
  JOIN resource r ON r.id = p.id
  JOIN instance_member creator_member ON creator_member.id = r.created_by
  JOIN app_user creator ON creator.id = creator_member.user_id
`;

async function requirePagesModule(
  request: FastifyRequest,
  reply: FastifyReply,
  pool: Pool,
): Promise<boolean> {
  if (!request.session) return false;
  const result = await pool.query(
    `SELECT 1 FROM module_config
     WHERE instance_id = $1 AND module_key = 'pages' AND enabled = true`,
    [request.session.instanceId],
  );
  if (!result.rowCount) {
    await reply.code(404).send({ error: 'MODULE_NOT_AVAILABLE' });
    return false;
  }
  return true;
}

function serializePage(row: PageRow, memberId: string): FamilyPage {
  return {
    ...row,
    editable: row.createdBy === memberId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeSummary(row: PageRow, memberId: string): FamilyPageSummary {
  const {
    content: _content,
    contentText: _contentText,
    groupIds: _groupIds,
    memberIds: _memberIds,
    linkedPageIds: _linkedPageIds,
    ...summary
  } = row;
  return {
    ...summary,
    editable: row.createdBy === memberId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
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

function extractPageText(content: PageDocument): string {
  const parts: string[] = [];
  function visit(node: PageContentNode) {
    if (node.text) parts.push(node.text);
    for (const child of node.content ?? []) visit(child);
    if (node.type !== 'text') parts.push('\n');
  }
  visit(content);
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 100_000);
}

async function validAudience(
  client: Pool | PoolClient,
  instanceId: string,
  visibility: PageVisibility,
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

async function validLinkedPages(
  client: Pool | PoolClient,
  instanceId: string,
  memberId: string,
  linkedPageIds: string[],
  sourcePageId: string,
): Promise<boolean> {
  const unique = [...new Set(linkedPageIds)];
  if (unique.includes(sourcePageId)) return false;
  if (!unique.length) return true;
  const result = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM page linked_page
     JOIN resource linked_resource ON linked_resource.id = linked_page.id
     WHERE linked_page.id = ANY($3::uuid[]) AND linked_resource.instance_id = $1
       AND linked_resource.deleted_at IS NULL
       AND (
         linked_resource.visibility = 'ALL_MEMBERS' OR linked_resource.created_by = $2
         OR EXISTS (
           SELECT 1 FROM resource_acl_user rau
           WHERE rau.resource_id = linked_resource.id AND rau.member_id = $2
         )
         OR EXISTS (
           SELECT 1 FROM resource_acl_group rag
           JOIN group_membership gm ON gm.group_id = rag.group_id
           WHERE rag.resource_id = linked_resource.id AND gm.member_id = $2
         )
       )`,
    [instanceId, memberId, unique],
  );
  return result.rows[0]?.count === unique.length;
}

async function replaceAudience(
  client: PoolClient,
  pageId: string,
  visibility: PageVisibility,
  groupIds: string[],
  memberIds: string[],
): Promise<void> {
  await client.query('DELETE FROM resource_acl_group WHERE resource_id = $1', [pageId]);
  await client.query('DELETE FROM resource_acl_user WHERE resource_id = $1', [pageId]);
  if (visibility === 'GROUPS') {
    await client.query(
      `INSERT INTO resource_acl_group (resource_id, group_id)
       SELECT $1, id FROM unnest($2::uuid[]) AS selected(id) ON CONFLICT DO NOTHING`,
      [pageId, [...new Set(groupIds)]],
    );
  }
  if (visibility === 'SELECTED_USERS') {
    await client.query(
      `INSERT INTO resource_acl_user (resource_id, member_id)
       SELECT $1, id FROM unnest($2::uuid[]) AS selected(id) ON CONFLICT DO NOTHING`,
      [pageId, [...new Set(memberIds)]],
    );
  }
}

async function replaceTags(
  client: PoolClient,
  pageId: string,
  instanceId: string,
  memberId: string,
  tags: string[],
): Promise<void> {
  await client.query('DELETE FROM resource_tag WHERE resource_id = $1', [pageId]);
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
        [pageId, result.rows[0].id],
      );
    }
  }
}

async function replaceLinks(
  client: PoolClient,
  pageId: string,
  linkedPageIds: string[],
): Promise<void> {
  await client.query('DELETE FROM page_link WHERE source_page_id = $1', [pageId]);
  if (linkedPageIds.length) {
    await client.query(
      `INSERT INTO page_link (source_page_id, target_page_id)
       SELECT $1, id FROM unnest($2::uuid[]) AS selected(id) ON CONFLICT DO NOTHING`,
      [pageId, [...new Set(linkedPageIds)]],
    );
  }
}

async function insertRevision(client: PoolClient, pageId: string, editedBy: string): Promise<void> {
  await client.query(
    `INSERT INTO page_revision
       (page_id, revision_number, title, content_json, content_text, folder, visibility,
        group_ids, member_ids, tags, linked_page_ids, edited_by)
     SELECT p.id, p.version, p.title, p.content_json, p.content_text, p.folder, r.visibility,
            COALESCE(ARRAY(SELECT rag.group_id FROM resource_acl_group rag
                           WHERE rag.resource_id = p.id), '{}'),
            COALESCE(ARRAY(SELECT rau.member_id FROM resource_acl_user rau
                           WHERE rau.resource_id = p.id), '{}'),
            COALESCE(ARRAY(SELECT t.name FROM resource_tag rt JOIN tag t ON t.id = rt.tag_id
                           WHERE rt.resource_id = p.id ORDER BY lower(t.name)), '{}'),
            COALESCE(ARRAY(SELECT pl.target_page_id FROM page_link pl
                           WHERE pl.source_page_id = p.id ORDER BY pl.target_page_id), '{}'),
            $2
     FROM page p JOIN resource r ON r.id = p.id WHERE p.id = $1`,
    [pageId, editedBy],
  );
}

async function replaceShareNotifications(
  client: PoolClient,
  instanceId: string,
  memberId: string,
  memberName: string,
  pageId: string,
  title: string,
  visibility: PageVisibility,
  groupIds: string[],
  memberIds: string[],
): Promise<void> {
  await client.query(`DELETE FROM notification WHERE resource_type = 'page' AND resource_id = $1`, [
    pageId,
  ]);
  if (visibility === 'PRIVATE') return;
  await client.query(
    `INSERT INTO notification
       (instance_id, recipient_member_id, actor_member_id, type, module_key,
        title, body, resource_type, resource_id)
     SELECT DISTINCT $1::uuid, recipient.id, $2::uuid, 'PAGE_SHARED', 'pages',
            'Page partagée', concat($3::text, ' a partagé : ', $4::text), 'page', $5::uuid
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
    [instanceId, memberId, memberName, title, pageId, visibility, groupIds, memberIds],
  );
}

async function loadPage(
  client: Pool | PoolClient,
  pageId: string,
  instanceId: string,
  memberId: string,
): Promise<FamilyPage | null> {
  const result = await client.query<PageRow>(
    `${selectPage} WHERE p.id = $3 AND ${readableResource}`,
    [instanceId, memberId, pageId],
  );
  return result.rows[0] ? serializePage(result.rows[0], memberId) : null;
}

export async function registerPageRoutes(app: FastifyInstance, pool: Pool) {
  const requireSession = createSessionGuard(pool);

  app.get('/api/v1/pages', { preHandler: requireSession }, async (request, reply) => {
    if (!(await requirePagesModule(request, reply, pool))) return;
    const parsed = pagesQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const session = request.session!;
    const result = await pool.query<PageRow>(
      `${selectPage}
       WHERE ${readableResource}
         AND (
           $3 = 'all'
           OR ($3 = 'mine' AND r.created_by = $2)
           OR ($3 = 'shared' AND r.created_by <> $2 AND r.visibility <> 'PRIVATE')
         )
         AND ($4::text IS NULL OR concat_ws(' ', p.title, p.content_text, p.folder) ILIKE concat('%', $4, '%'))
         AND ($5::text IS NULL OR p.folder = $5)
         AND ($6::text IS NULL OR EXISTS (
           SELECT 1 FROM resource_tag filter_rt JOIN tag filter_t ON filter_t.id = filter_rt.tag_id
           WHERE filter_rt.resource_id = p.id AND filter_t.normalized_name = lower($6)
         ))
         AND ($7::timestamptz IS NULL OR (p.updated_at, p.id) < ($7::timestamptz, $8::uuid))
       ORDER BY p.updated_at DESC, p.id DESC LIMIT $9`,
      [
        session.instanceId,
        session.id,
        parsed.data.scope,
        parsed.data.q || null,
        parsed.data.folder || null,
        parsed.data.tag || null,
        parsed.data.before ?? null,
        parsed.data.beforeId ?? null,
        parsed.data.limit + 1,
      ],
    );
    const hasMore = result.rows.length > parsed.data.limit;
    return {
      pages: result.rows
        .slice(0, parsed.data.limit)
        .map((row) => serializeSummary(row, session.id)),
      hasMore,
    };
  });

  app.get('/api/v1/pages/:id', { preHandler: requireSession }, async (request, reply) => {
    if (!(await requirePagesModule(request, reply, pool))) return;
    const id = idSchema.safeParse((request.params as { id?: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const page = await loadPage(pool, id.data, request.session!.instanceId, request.session!.id);
    if (!page) return reply.code(404).send({ error: 'PAGE_NOT_FOUND' });
    return { page };
  });

  app.post(
    '/api/v1/pages',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requirePagesModule(request, reply, pool))) return;
      const parsed = pageCreateSchema.safeParse(request.body);
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
        )) ||
        !(await validLinkedPages(
          pool,
          session.instanceId,
          session.id,
          parsed.data.linkedPageIds,
          parsed.data.clientMutationId,
        ))
      ) {
        return reply.code(400).send({ error: 'INVALID_RELATION' });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const existing = await client.query<{ id: string }>(
          'SELECT id FROM page WHERE instance_id = $1 AND client_mutation_id = $2',
          [session.instanceId, parsed.data.clientMutationId],
        );
        let pageId = existing.rows[0]?.id;
        if (!pageId) {
          pageId = parsed.data.clientMutationId;
          await client.query(
            `INSERT INTO resource (id, instance_id, resource_type, created_by, visibility)
             VALUES ($1, $2, 'page', $3, $4)`,
            [pageId, session.instanceId, session.id, parsed.data.visibility],
          );
          await client.query(
            `INSERT INTO page
               (id, instance_id, title, content_json, content_text, folder, client_mutation_id)
             VALUES ($1, $2, $3, $4, $5, $6, $1)`,
            [
              pageId,
              session.instanceId,
              parsed.data.title,
              parsed.data.content,
              extractPageText(parsed.data.content),
              parsed.data.folder ?? null,
            ],
          );
          await replaceAudience(
            client,
            pageId,
            parsed.data.visibility,
            parsed.data.groupIds,
            parsed.data.memberIds,
          );
          await replaceTags(client, pageId, session.instanceId, session.id, parsed.data.tags);
          await replaceLinks(client, pageId, parsed.data.linkedPageIds);
          await insertRevision(client, pageId, session.id);
          await replaceShareNotifications(
            client,
            session.instanceId,
            session.id,
            session.firstName,
            pageId,
            parsed.data.title,
            parsed.data.visibility,
            parsed.data.groupIds,
            parsed.data.memberIds,
          );
        }
        const page = await loadPage(client, pageId, session.instanceId, session.id);
        if (!page) throw new Error('Page creation returned no readable row.');
        await client.query('COMMIT');
        return reply.code(existing.rowCount ? 200 : 201).send({ page });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.put(
    '/api/v1/pages/:id',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requirePagesModule(request, reply, pool))) return;
      const id = idSchema.safeParse((request.params as { id?: string }).id);
      const parsed = pageUpdateSchema.safeParse(request.body);
      if (!id.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const session = request.session!;
      if (
        !(await validAudience(
          pool,
          session.instanceId,
          parsed.data.visibility,
          parsed.data.groupIds,
          parsed.data.memberIds,
        )) ||
        !(await validLinkedPages(
          pool,
          session.instanceId,
          session.id,
          parsed.data.linkedPageIds,
          id.data,
        ))
      ) {
        return reply.code(400).send({ error: 'INVALID_RELATION' });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const current = await loadPage(client, id.data, session.instanceId, session.id);
        if (!current) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'PAGE_NOT_FOUND' });
        }
        if (!current.editable) {
          await client.query('ROLLBACK');
          return reply.code(403).send({ error: 'PAGE_NOT_OWNED' });
        }
        if (current.version !== parsed.data.version) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'VERSION_CONFLICT', page: current });
        }
        const updated = await client.query(
          `UPDATE page SET title = $2, content_json = $3, content_text = $4, folder = $5,
             version = version + 1, updated_at = now()
           WHERE id = $1 AND version = $6 RETURNING version`,
          [
            id.data,
            parsed.data.title,
            parsed.data.content,
            extractPageText(parsed.data.content),
            parsed.data.folder ?? null,
            parsed.data.version,
          ],
        );
        if (!updated.rowCount) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'VERSION_CONFLICT' });
        }
        await client.query(
          `UPDATE resource SET visibility = $2, version = version + 1, updated_at = now() WHERE id = $1`,
          [id.data, parsed.data.visibility],
        );
        await replaceAudience(
          client,
          id.data,
          parsed.data.visibility,
          parsed.data.groupIds,
          parsed.data.memberIds,
        );
        await replaceTags(client, id.data, session.instanceId, session.id, parsed.data.tags);
        await replaceLinks(client, id.data, parsed.data.linkedPageIds);
        await insertRevision(client, id.data, session.id);
        await replaceShareNotifications(
          client,
          session.instanceId,
          session.id,
          session.firstName,
          id.data,
          parsed.data.title,
          parsed.data.visibility,
          parsed.data.groupIds,
          parsed.data.memberIds,
        );
        const page = await loadPage(client, id.data, session.instanceId, session.id);
        await client.query('COMMIT');
        return { page };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.delete(
    '/api/v1/pages/:id',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requirePagesModule(request, reply, pool))) return;
      const id = idSchema.safeParse((request.params as { id?: string }).id);
      if (!id.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(
          `UPDATE resource SET deleted_at = now(), updated_at = now()
           WHERE id = $1 AND instance_id = $2 AND resource_type = 'page'
             AND created_by = $3 AND deleted_at IS NULL`,
          [id.data, request.session!.instanceId, request.session!.id],
        );
        if (!result.rowCount) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'PAGE_NOT_FOUND' });
        }
        await client.query(
          `DELETE FROM notification WHERE resource_type = 'page' AND resource_id = $1`,
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

  app.get('/api/v1/pages/:id/revisions', { preHandler: requireSession }, async (request, reply) => {
    if (!(await requirePagesModule(request, reply, pool))) return;
    const id = idSchema.safeParse((request.params as { id?: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const page = await loadPage(pool, id.data, request.session!.instanceId, request.session!.id);
    if (!page) return reply.code(404).send({ error: 'PAGE_NOT_FOUND' });
    const result = await pool.query<RevisionRow>(
      `SELECT pr.id, pr.revision_number AS "revisionNumber", pr.edited_by AS "editedBy",
              editor.first_name AS "editedByName", pr.created_at AS "createdAt"
       FROM page_revision pr
       JOIN instance_member editor_member ON editor_member.id = pr.edited_by
       JOIN app_user editor ON editor.id = editor_member.user_id
       WHERE pr.page_id = $1 ORDER BY pr.revision_number DESC LIMIT 50`,
      [id.data],
    );
    return {
      revisions: result.rows.map(
        (row): PageRevision => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          current: row.revisionNumber === page.version,
        }),
      ),
    };
  });

  app.post(
    '/api/v1/pages/:id/restore',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requirePagesModule(request, reply, pool))) return;
      const id = idSchema.safeParse((request.params as { id?: string }).id);
      const parsed = pageRestoreSchema.safeParse(request.body);
      if (!id.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const session = request.session!;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const current = await loadPage(client, id.data, session.instanceId, session.id);
        if (!current) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'PAGE_NOT_FOUND' });
        }
        if (!current.editable) {
          await client.query('ROLLBACK');
          return reply.code(403).send({ error: 'PAGE_NOT_OWNED' });
        }
        if (current.version !== parsed.data.version) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'VERSION_CONFLICT', page: current });
        }
        const revision = await client.query<{
          title: string;
          content: PageDocument;
          contentText: string;
          folder: string | null;
          visibility: PageVisibility;
          groupIds: string[];
          memberIds: string[];
          tags: string[];
          linkedPageIds: string[];
        }>(
          `SELECT title, content_json AS content, content_text AS "contentText", folder, visibility,
                  group_ids AS "groupIds", member_ids AS "memberIds", tags,
                  linked_page_ids AS "linkedPageIds"
           FROM page_revision WHERE id = $1 AND page_id = $2`,
          [parsed.data.revisionId, id.data],
        );
        const snapshot = revision.rows[0];
        if (!snapshot) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'REVISION_NOT_FOUND' });
        }
        if (
          !(await validAudience(
            client,
            session.instanceId,
            snapshot.visibility,
            snapshot.groupIds,
            snapshot.memberIds,
          ))
        ) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'REVISION_AUDIENCE_UNAVAILABLE' });
        }
        const readableLinks = await client.query<{ id: string }>(
          `SELECT linked_page.id
           FROM page linked_page JOIN resource linked_resource ON linked_resource.id = linked_page.id
           WHERE linked_page.id = ANY($3::uuid[]) AND linked_resource.instance_id = $1
             AND linked_resource.deleted_at IS NULL
             AND (
               linked_resource.visibility = 'ALL_MEMBERS' OR linked_resource.created_by = $2
               OR EXISTS (SELECT 1 FROM resource_acl_user rau
                           WHERE rau.resource_id = linked_resource.id AND rau.member_id = $2)
               OR EXISTS (SELECT 1 FROM resource_acl_group rag JOIN group_membership gm ON gm.group_id = rag.group_id
                           WHERE rag.resource_id = linked_resource.id AND gm.member_id = $2)
             )`,
          [session.instanceId, session.id, snapshot.linkedPageIds],
        );
        const restored = await client.query(
          `UPDATE page SET title = $2, content_json = $3, content_text = $4, folder = $5,
             version = version + 1, updated_at = now()
           WHERE id = $1 AND version = $6 RETURNING version`,
          [
            id.data,
            snapshot.title,
            snapshot.content,
            snapshot.contentText,
            snapshot.folder,
            parsed.data.version,
          ],
        );
        if (!restored.rowCount) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'VERSION_CONFLICT' });
        }
        await client.query(
          `UPDATE resource SET visibility = $2, version = version + 1, updated_at = now() WHERE id = $1`,
          [id.data, snapshot.visibility],
        );
        await replaceAudience(
          client,
          id.data,
          snapshot.visibility,
          snapshot.groupIds,
          snapshot.memberIds,
        );
        await replaceTags(client, id.data, session.instanceId, session.id, snapshot.tags);
        await replaceLinks(
          client,
          id.data,
          readableLinks.rows.map((row) => row.id),
        );
        await insertRevision(client, id.data, session.id);
        await replaceShareNotifications(
          client,
          session.instanceId,
          session.id,
          session.firstName,
          id.data,
          snapshot.title,
          snapshot.visibility,
          snapshot.groupIds,
          snapshot.memberIds,
        );
        const page = await loadPage(client, id.data, session.instanceId, session.id);
        await client.query('COMMIT');
        return { page };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );
}
