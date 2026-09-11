import {
  collectionCommentCreateSchema,
  collectionCreateSchema,
  collectionItemCreateSchema,
  collectionItemUpdateSchema,
  collectionPreferenceSchema,
  collectionsQuerySchema,
  collectionUpdateSchema,
  type CollectionItemComment,
  type CollectionType,
  type CollectionVisibility,
  type FamilyCollection,
  type FamilyCollectionItem,
  type FamilyCollectionSummary,
} from '@familyhub/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import { createSessionGuard, requireCsrf } from './auth.js';

const idSchema = z.string().uuid();

type CollectionRow = {
  id: string;
  name: string;
  description: string | null;
  type: CollectionType;
  imageUrl: string | null;
  tags: string[];
  visibility: CollectionVisibility;
  groupIds: string[];
  memberIds: string[];
  itemCount: number;
  createdBy: string;
  createdByName: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

type CommentJson = Omit<CollectionItemComment, 'editable'>;

type ItemRow = {
  id: string;
  collectionId: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  url: string | null;
  imageUrl: string | null;
  tags: string[];
  metadata: Record<string, string>;
  addedBy: string;
  addedByName: string;
  myPreference: number | null;
  negativeCount: number;
  neutralCount: number;
  positiveCount: number;
  comments: CommentJson[];
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

const selectCollection = `
  SELECT c.id, c.name, c.description, c.type, c.image_url AS "imageUrl",
         COALESCE(ARRAY(
           SELECT t.name FROM resource_tag rt JOIN tag t ON t.id = rt.tag_id
           WHERE rt.resource_id = c.id ORDER BY lower(t.name)
         ), '{}') AS tags,
         r.visibility,
         CASE WHEN r.created_by = $2 THEN COALESCE(ARRAY(
           SELECT rag.group_id FROM resource_acl_group rag WHERE rag.resource_id = c.id
         ), '{}') ELSE '{}' END AS "groupIds",
         CASE WHEN r.created_by = $2 THEN COALESCE(ARRAY(
           SELECT rau.member_id FROM resource_acl_user rau WHERE rau.resource_id = c.id
         ), '{}') ELSE '{}' END AS "memberIds",
         (SELECT count(*)::int FROM collection_item item
          WHERE item.collection_id = c.id AND item.deleted_at IS NULL) AS "itemCount",
         r.created_by AS "createdBy", creator.first_name AS "createdByName",
         c.version, c.created_at AS "createdAt", c.updated_at AS "updatedAt"
  FROM collection c
  JOIN resource r ON r.id = c.id
  JOIN instance_member creator_member ON creator_member.id = r.created_by
  JOIN app_user creator ON creator.id = creator_member.user_id
`;

const selectItem = `
  SELECT item.id, item.collection_id AS "collectionId", item.title, item.subtitle,
         item.description, item.url, item.image_url AS "imageUrl",
         COALESCE(ARRAY(
           SELECT t.name FROM collection_item_tag cit JOIN tag t ON t.id = cit.tag_id
           WHERE cit.item_id = item.id ORDER BY lower(t.name)
         ), '{}') AS tags,
         item.metadata_json AS metadata, item.added_by AS "addedBy",
         author.first_name AS "addedByName",
         (SELECT cip.value::int FROM collection_item_preference cip
          WHERE cip.item_id = item.id AND cip.member_id = $1) AS "myPreference",
         (SELECT count(*)::int FROM collection_item_preference cip
          WHERE cip.item_id = item.id AND cip.value = -1) AS "negativeCount",
         (SELECT count(*)::int FROM collection_item_preference cip
          WHERE cip.item_id = item.id AND cip.value = 0) AS "neutralCount",
         (SELECT count(*)::int FROM collection_item_preference cip
          WHERE cip.item_id = item.id AND cip.value = 1) AS "positiveCount",
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'id', comment.id,
             'body', comment.body,
             'authorId', comment.member_id,
             'authorName', comment_author.first_name,
             'createdAt', comment.created_at
           ) ORDER BY comment.created_at)
           FROM collection_item_comment comment
           JOIN instance_member comment_member ON comment_member.id = comment.member_id
           JOIN app_user comment_author ON comment_author.id = comment_member.user_id
           WHERE comment.item_id = item.id AND comment.deleted_at IS NULL
         ), '[]'::jsonb) AS comments,
         item.version, item.created_at AS "createdAt", item.updated_at AS "updatedAt"
  FROM collection_item item
  JOIN instance_member author_member ON author_member.id = item.added_by
  JOIN app_user author ON author.id = author_member.user_id
`;

async function requireCollectionsModule(
  request: FastifyRequest,
  reply: FastifyReply,
  pool: Pool,
): Promise<boolean> {
  if (!request.session) return false;
  const result = await pool.query(
    `SELECT 1 FROM module_config
     WHERE instance_id = $1 AND module_key = 'collections' AND enabled = true`,
    [request.session.instanceId],
  );
  if (!result.rowCount) {
    await reply.code(404).send({ error: 'MODULE_NOT_AVAILABLE' });
    return false;
  }
  return true;
}

function serializeCollection(row: CollectionRow, memberId: string): FamilyCollection {
  return {
    ...row,
    editable: row.createdBy === memberId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeSummary(row: CollectionRow, memberId: string): FamilyCollectionSummary {
  const {
    groupIds: _groupIds,
    memberIds: _memberIds,
    ...summary
  } = serializeCollection(row, memberId);
  return summary;
}

function serializeItem(
  row: ItemRow,
  memberId: string,
  collectionOwnerId: string,
): FamilyCollectionItem {
  return {
    id: row.id,
    collectionId: row.collectionId,
    title: row.title,
    subtitle: row.subtitle,
    description: row.description,
    url: row.url,
    imageUrl: row.imageUrl,
    tags: row.tags,
    metadata: row.metadata,
    addedBy: row.addedBy,
    addedByName: row.addedByName,
    editable: row.addedBy === memberId || collectionOwnerId === memberId,
    preference:
      row.myPreference === -1 || row.myPreference === 0 || row.myPreference === 1
        ? row.myPreference
        : null,
    preferences: {
      negative: row.negativeCount,
      neutral: row.neutralCount,
      positive: row.positiveCount,
    },
    comments: row.comments.map((comment) => ({
      ...comment,
      editable: comment.authorId === memberId || collectionOwnerId === memberId,
      createdAt: new Date(comment.createdAt).toISOString(),
    })),
    version: row.version,
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

async function validAudience(
  client: Pool | PoolClient,
  instanceId: string,
  visibility: CollectionVisibility,
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
  collectionId: string,
  visibility: CollectionVisibility,
  groupIds: string[],
  memberIds: string[],
): Promise<void> {
  await client.query('DELETE FROM resource_acl_group WHERE resource_id = $1', [collectionId]);
  await client.query('DELETE FROM resource_acl_user WHERE resource_id = $1', [collectionId]);
  if (visibility === 'GROUPS') {
    await client.query(
      `INSERT INTO resource_acl_group (resource_id, group_id)
       SELECT $1, id FROM unnest($2::uuid[]) AS selected(id) ON CONFLICT DO NOTHING`,
      [collectionId, [...new Set(groupIds)]],
    );
  }
  if (visibility === 'SELECTED_USERS') {
    await client.query(
      `INSERT INTO resource_acl_user (resource_id, member_id)
       SELECT $1, id FROM unnest($2::uuid[]) AS selected(id) ON CONFLICT DO NOTHING`,
      [collectionId, [...new Set(memberIds)]],
    );
  }
}

async function upsertTag(
  client: PoolClient,
  instanceId: string,
  memberId: string,
  name: string,
  normalized: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO tag (instance_id, name, normalized_name, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (instance_id, normalized_name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [instanceId, name, normalized, memberId],
  );
  return result.rows[0]!.id;
}

async function replaceCollectionTags(
  client: PoolClient,
  collectionId: string,
  instanceId: string,
  memberId: string,
  tags: string[],
): Promise<void> {
  await client.query('DELETE FROM resource_tag WHERE resource_id = $1', [collectionId]);
  for (const tag of normalizedTags(tags)) {
    const tagId = await upsertTag(client, instanceId, memberId, tag.name, tag.normalized);
    await client.query(
      `INSERT INTO resource_tag (resource_id, tag_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [collectionId, tagId],
    );
  }
}

async function replaceItemTags(
  client: PoolClient,
  itemId: string,
  instanceId: string,
  memberId: string,
  tags: string[],
): Promise<void> {
  await client.query('DELETE FROM collection_item_tag WHERE item_id = $1', [itemId]);
  for (const tag of normalizedTags(tags)) {
    const tagId = await upsertTag(client, instanceId, memberId, tag.name, tag.normalized);
    await client.query(
      `INSERT INTO collection_item_tag (item_id, tag_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [itemId, tagId],
    );
  }
}

async function loadCollection(
  client: Pool | PoolClient,
  collectionId: string,
  instanceId: string,
  memberId: string,
): Promise<FamilyCollection | null> {
  const result = await client.query<CollectionRow>(
    `${selectCollection} WHERE c.id = $3 AND ${readableResource}`,
    [instanceId, memberId, collectionId],
  );
  return result.rows[0] ? serializeCollection(result.rows[0], memberId) : null;
}

async function loadItem(
  client: Pool | PoolClient,
  itemId: string,
  collection: FamilyCollection,
  memberId: string,
): Promise<FamilyCollectionItem | null> {
  const result = await client.query<ItemRow>(
    `${selectItem}
     WHERE item.id = $2 AND item.collection_id = $3 AND item.deleted_at IS NULL`,
    [memberId, itemId, collection.id],
  );
  return result.rows[0] ? serializeItem(result.rows[0], memberId, collection.createdBy) : null;
}

async function notifyCollectionAudience(
  client: PoolClient,
  collectionId: string,
  actorId: string,
  actorName: string,
  type: 'COLLECTION_SHARED' | 'COLLECTION_ITEM_ADDED',
  collectionName: string,
  itemTitle?: string,
): Promise<void> {
  if (type === 'COLLECTION_SHARED') {
    await client.query(
      `DELETE FROM notification
       WHERE resource_type = 'collection' AND resource_id = $1 AND type = 'COLLECTION_SHARED'`,
      [collectionId],
    );
  }
  await client.query(
    `INSERT INTO notification
       (instance_id, recipient_member_id, actor_member_id, type, module_key,
        title, body, resource_type, resource_id)
     SELECT r.instance_id, recipient.id, $2::uuid, $3::text, 'collections',
            CASE WHEN $3::text = 'COLLECTION_SHARED'
              THEN 'Nouvelle collection partagée'
              ELSE 'Nouvel élément dans une collection'
            END,
            CASE WHEN $3::text = 'COLLECTION_SHARED'
              THEN concat($4::text, ' partage « ', $5::text, ' »')
              ELSE concat($4::text, ' ajoute « ', $6::text, ' » dans « ', $5::text, ' »')
            END,
            'collection', r.id
     FROM resource r
     JOIN instance_member recipient ON recipient.instance_id = r.instance_id
     WHERE r.id = $1::uuid AND r.deleted_at IS NULL
       AND recipient.status = 'ACTIVE' AND recipient.id <> $2::uuid
       AND (
         r.visibility = 'ALL_MEMBERS'
         OR EXISTS (
           SELECT 1 FROM resource_acl_user rau
           WHERE rau.resource_id = r.id AND rau.member_id = recipient.id
         )
         OR EXISTS (
           SELECT 1 FROM resource_acl_group rag
           JOIN group_membership gm ON gm.group_id = rag.group_id
           WHERE rag.resource_id = r.id AND gm.member_id = recipient.id
         )
       )`,
    [collectionId, actorId, type, actorName, collectionName, itemTitle ?? null],
  );
}

export async function registerCollectionRoutes(app: FastifyInstance, pool: Pool) {
  const requireSession = createSessionGuard(pool);

  app.get('/api/v1/collections', { preHandler: requireSession }, async (request, reply) => {
    if (!(await requireCollectionsModule(request, reply, pool))) return;
    const parsed = collectionsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const session = request.session!;
    const { before, beforeId, limit, q, scope, tag, type } = parsed.data;
    const result = await pool.query<CollectionRow>(
      `${selectCollection}
       WHERE ${readableResource}
         AND (
           $3 = 'all'
           OR ($3 = 'mine' AND r.created_by = $2)
           OR ($3 = 'shared' AND r.created_by <> $2)
         )
         AND ($4::text IS NULL OR concat_ws(' ', c.name, c.description, (
           SELECT string_agg(t.name, ' ') FROM resource_tag rt
           JOIN tag t ON t.id = rt.tag_id WHERE rt.resource_id = c.id
         )) ILIKE concat('%', $4::text, '%'))
         AND ($5::text IS NULL OR c.type = $5::text)
         AND ($6::text IS NULL OR EXISTS (
           SELECT 1 FROM resource_tag rt JOIN tag t ON t.id = rt.tag_id
           WHERE rt.resource_id = c.id AND t.normalized_name = lower($6::text)
         ))
         AND ($7::timestamptz IS NULL OR (c.updated_at, c.id) < ($7::timestamptz, $8::uuid))
       ORDER BY c.updated_at DESC, c.id DESC
       LIMIT $9`,
      [
        session.instanceId,
        session.id,
        scope,
        q ?? null,
        type ?? null,
        tag ?? null,
        before ?? null,
        beforeId ?? null,
        limit + 1,
      ],
    );
    const rows = result.rows.slice(0, limit);
    return {
      collections: rows.map((row) => serializeSummary(row, session.id)),
      hasMore: result.rows.length > limit,
    };
  });

  app.get('/api/v1/collections/:id', { preHandler: requireSession }, async (request, reply) => {
    if (!(await requireCollectionsModule(request, reply, pool))) return;
    const id = idSchema.safeParse((request.params as { id?: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const session = request.session!;
    const collection = await loadCollection(pool, id.data, session.instanceId, session.id);
    if (!collection) return reply.code(404).send({ error: 'COLLECTION_NOT_FOUND' });
    const items = await pool.query<ItemRow>(
      `${selectItem}
         WHERE item.collection_id = $2 AND item.deleted_at IS NULL
         ORDER BY item.updated_at DESC, item.id DESC`,
      [session.id, collection.id],
    );
    return {
      collection,
      items: items.rows.map((row) => serializeItem(row, session.id, collection.createdBy)),
    };
  });

  app.post(
    '/api/v1/collections',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireCollectionsModule(request, reply, pool))) return;
      const parsed = collectionCreateSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
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
      const existing = await pool.query<{ id: string }>(
        `SELECT id FROM collection WHERE instance_id = $1 AND client_mutation_id = $2`,
        [session.instanceId, parsed.data.clientMutationId],
      );
      if (existing.rows[0]) {
        return {
          collection: await loadCollection(
            pool,
            existing.rows[0].id,
            session.instanceId,
            session.id,
          ),
        };
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const resource = await client.query<{ id: string }>(
          `INSERT INTO resource (instance_id, resource_type, created_by, visibility)
           VALUES ($1, 'collection', $2, $3) RETURNING id`,
          [session.instanceId, session.id, parsed.data.visibility],
        );
        const collectionId = resource.rows[0]!.id;
        await client.query(
          `INSERT INTO collection
             (id, instance_id, name, description, type, image_url, client_mutation_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            collectionId,
            session.instanceId,
            parsed.data.name,
            parsed.data.description ?? null,
            parsed.data.type,
            parsed.data.imageUrl ?? null,
            parsed.data.clientMutationId,
          ],
        );
        await replaceAudience(
          client,
          collectionId,
          parsed.data.visibility,
          parsed.data.groupIds,
          parsed.data.memberIds,
        );
        await replaceCollectionTags(
          client,
          collectionId,
          session.instanceId,
          session.id,
          parsed.data.tags,
        );
        await notifyCollectionAudience(
          client,
          collectionId,
          session.id,
          session.firstName,
          'COLLECTION_SHARED',
          parsed.data.name,
        );
        await client.query('COMMIT');
        const collection = await loadCollection(pool, collectionId, session.instanceId, session.id);
        return reply.code(201).send({ collection });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.put(
    '/api/v1/collections/:id',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireCollectionsModule(request, reply, pool))) return;
      const id = idSchema.safeParse((request.params as { id?: string }).id);
      const parsed = collectionUpdateSchema.safeParse(request.body);
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
        const current = await loadCollection(client, id.data, session.instanceId, session.id);
        if (!current) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'COLLECTION_NOT_FOUND' });
        }
        if (!current.editable) {
          await client.query('ROLLBACK');
          return reply.code(403).send({ error: 'COLLECTION_NOT_OWNED' });
        }
        const updated = await client.query(
          `UPDATE collection
           SET name = $2, description = $3, type = $4, image_url = $5,
               version = version + 1, updated_at = now()
           WHERE id = $1 AND version = $6`,
          [
            id.data,
            parsed.data.name,
            parsed.data.description ?? null,
            parsed.data.type,
            parsed.data.imageUrl ?? null,
            parsed.data.version,
          ],
        );
        if (!updated.rowCount) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'VERSION_CONFLICT', collection: current });
        }
        await client.query(
          `UPDATE resource SET visibility = $2, version = version + 1, updated_at = now()
           WHERE id = $1`,
          [id.data, parsed.data.visibility],
        );
        await replaceAudience(
          client,
          id.data,
          parsed.data.visibility,
          parsed.data.groupIds,
          parsed.data.memberIds,
        );
        await replaceCollectionTags(
          client,
          id.data,
          session.instanceId,
          session.id,
          parsed.data.tags,
        );
        await notifyCollectionAudience(
          client,
          id.data,
          session.id,
          session.firstName,
          'COLLECTION_SHARED',
          parsed.data.name,
        );
        await client.query('COMMIT');
        return {
          collection: await loadCollection(pool, id.data, session.instanceId, session.id),
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.delete(
    '/api/v1/collections/:id',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireCollectionsModule(request, reply, pool))) return;
      const id = idSchema.safeParse((request.params as { id?: string }).id);
      if (!id.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(
          `UPDATE resource SET deleted_at = now(), updated_at = now()
           WHERE id = $1 AND instance_id = $2 AND resource_type = 'collection'
             AND created_by = $3 AND deleted_at IS NULL`,
          [id.data, request.session!.instanceId, request.session!.id],
        );
        if (!result.rowCount) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'COLLECTION_NOT_FOUND' });
        }
        await client.query(
          `DELETE FROM notification WHERE resource_type = 'collection' AND resource_id = $1`,
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

  app.post(
    '/api/v1/collections/:id/items',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireCollectionsModule(request, reply, pool))) return;
      const id = idSchema.safeParse((request.params as { id?: string }).id);
      const parsed = collectionItemCreateSchema.safeParse(request.body);
      if (!id.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const session = request.session!;
      const collection = await loadCollection(pool, id.data, session.instanceId, session.id);
      if (!collection) return reply.code(404).send({ error: 'COLLECTION_NOT_FOUND' });
      const existing = await pool.query<{ id: string; collectionId: string }>(
        `SELECT id, collection_id AS "collectionId" FROM collection_item
         WHERE instance_id = $1 AND client_mutation_id = $2`,
        [session.instanceId, parsed.data.clientMutationId],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].collectionId !== collection.id) {
          return reply.code(409).send({ error: 'MUTATION_ID_REUSED' });
        }
        return {
          item: await loadItem(pool, existing.rows[0].id, collection, session.id),
        };
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO collection_item
             (collection_id, instance_id, title, subtitle, description, url, image_url,
              metadata_json, added_by, client_mutation_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
           RETURNING id`,
          [
            collection.id,
            session.instanceId,
            parsed.data.title,
            parsed.data.subtitle ?? null,
            parsed.data.description ?? null,
            parsed.data.url ?? null,
            parsed.data.imageUrl ?? null,
            JSON.stringify(parsed.data.metadata),
            session.id,
            parsed.data.clientMutationId,
          ],
        );
        const itemId = inserted.rows[0]!.id;
        await replaceItemTags(client, itemId, session.instanceId, session.id, parsed.data.tags);
        await client.query('UPDATE collection SET updated_at = now() WHERE id = $1', [
          collection.id,
        ]);
        await client.query('UPDATE resource SET updated_at = now() WHERE id = $1', [collection.id]);
        await notifyCollectionAudience(
          client,
          collection.id,
          session.id,
          session.firstName,
          'COLLECTION_ITEM_ADDED',
          collection.name,
          parsed.data.title,
        );
        await client.query('COMMIT');
        return reply.code(201).send({
          item: await loadItem(pool, itemId, collection, session.id),
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.put(
    '/api/v1/collections/:collectionId/items/:itemId',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireCollectionsModule(request, reply, pool))) return;
      const params = request.params as { collectionId?: string; itemId?: string };
      const collectionId = idSchema.safeParse(params.collectionId);
      const itemId = idSchema.safeParse(params.itemId);
      const parsed = collectionItemUpdateSchema.safeParse(request.body);
      if (!collectionId.success || !itemId.success || !parsed.success)
        return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const session = request.session!;
      const collection = await loadCollection(
        pool,
        collectionId.data,
        session.instanceId,
        session.id,
      );
      if (!collection) return reply.code(404).send({ error: 'COLLECTION_NOT_FOUND' });
      const current = await loadItem(pool, itemId.data, collection, session.id);
      if (!current) return reply.code(404).send({ error: 'COLLECTION_ITEM_NOT_FOUND' });
      if (!current.editable) return reply.code(403).send({ error: 'COLLECTION_ITEM_NOT_OWNED' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const updated = await client.query(
          `UPDATE collection_item
           SET title = $2, subtitle = $3, description = $4, url = $5, image_url = $6,
               metadata_json = $7::jsonb, version = version + 1, updated_at = now()
           WHERE id = $1 AND collection_id = $8 AND version = $9 AND deleted_at IS NULL`,
          [
            itemId.data,
            parsed.data.title,
            parsed.data.subtitle ?? null,
            parsed.data.description ?? null,
            parsed.data.url ?? null,
            parsed.data.imageUrl ?? null,
            JSON.stringify(parsed.data.metadata),
            collection.id,
            parsed.data.version,
          ],
        );
        if (!updated.rowCount) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'VERSION_CONFLICT', item: current });
        }
        await replaceItemTags(
          client,
          itemId.data,
          session.instanceId,
          session.id,
          parsed.data.tags,
        );
        await client.query('UPDATE collection SET updated_at = now() WHERE id = $1', [
          collection.id,
        ]);
        await client.query('UPDATE resource SET updated_at = now() WHERE id = $1', [collection.id]);
        await client.query('COMMIT');
        return { item: await loadItem(pool, itemId.data, collection, session.id) };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.delete(
    '/api/v1/collections/:collectionId/items/:itemId',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireCollectionsModule(request, reply, pool))) return;
      const params = request.params as { collectionId?: string; itemId?: string };
      const collectionId = idSchema.safeParse(params.collectionId);
      const itemId = idSchema.safeParse(params.itemId);
      if (!collectionId.success || !itemId.success)
        return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const session = request.session!;
      const collection = await loadCollection(
        pool,
        collectionId.data,
        session.instanceId,
        session.id,
      );
      if (!collection) return reply.code(404).send({ error: 'COLLECTION_NOT_FOUND' });
      const item = await loadItem(pool, itemId.data, collection, session.id);
      if (!item) return reply.code(404).send({ error: 'COLLECTION_ITEM_NOT_FOUND' });
      if (!item.editable) return reply.code(403).send({ error: 'COLLECTION_ITEM_NOT_OWNED' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(
          `UPDATE collection_item SET deleted_at = now(), updated_at = now()
           WHERE id = $1 AND collection_id = $2 AND deleted_at IS NULL`,
          [item.id, collection.id],
        );
        if (!result.rowCount) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'COLLECTION_ITEM_NOT_FOUND' });
        }
        await client.query('UPDATE collection SET updated_at = now() WHERE id = $1', [
          collection.id,
        ]);
        await client.query('UPDATE resource SET updated_at = now() WHERE id = $1', [collection.id]);
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

  app.put(
    '/api/v1/collections/:collectionId/items/:itemId/preference',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireCollectionsModule(request, reply, pool))) return;
      const params = request.params as { collectionId?: string; itemId?: string };
      const collectionId = idSchema.safeParse(params.collectionId);
      const itemId = idSchema.safeParse(params.itemId);
      const parsed = collectionPreferenceSchema.safeParse(request.body);
      if (!collectionId.success || !itemId.success || !parsed.success)
        return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const session = request.session!;
      const collection = await loadCollection(
        pool,
        collectionId.data,
        session.instanceId,
        session.id,
      );
      if (!collection || !(await loadItem(pool, itemId.data, collection, session.id))) {
        return reply.code(404).send({ error: 'COLLECTION_ITEM_NOT_FOUND' });
      }
      await pool.query(
        `INSERT INTO collection_item_preference (item_id, member_id, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (item_id, member_id)
         DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [itemId.data, session.id, parsed.data.value],
      );
      return { item: await loadItem(pool, itemId.data, collection, session.id) };
    },
  );

  app.post(
    '/api/v1/collections/:collectionId/items/:itemId/comments',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireCollectionsModule(request, reply, pool))) return;
      const params = request.params as { collectionId?: string; itemId?: string };
      const collectionId = idSchema.safeParse(params.collectionId);
      const itemId = idSchema.safeParse(params.itemId);
      const parsed = collectionCommentCreateSchema.safeParse(request.body);
      if (!collectionId.success || !itemId.success || !parsed.success)
        return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const session = request.session!;
      const collection = await loadCollection(
        pool,
        collectionId.data,
        session.instanceId,
        session.id,
      );
      if (!collection || !(await loadItem(pool, itemId.data, collection, session.id))) {
        return reply.code(404).send({ error: 'COLLECTION_ITEM_NOT_FOUND' });
      }
      await pool.query(
        `INSERT INTO collection_item_comment (item_id, member_id, body, client_mutation_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (item_id, client_mutation_id) DO NOTHING`,
        [itemId.data, session.id, parsed.data.body, parsed.data.clientMutationId],
      );
      return reply.code(201).send({
        item: await loadItem(pool, itemId.data, collection, session.id),
      });
    },
  );

  app.delete(
    '/api/v1/collections/:collectionId/items/:itemId/comments/:commentId',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireCollectionsModule(request, reply, pool))) return;
      const params = request.params as {
        collectionId?: string;
        itemId?: string;
        commentId?: string;
      };
      const collectionId = idSchema.safeParse(params.collectionId);
      const itemId = idSchema.safeParse(params.itemId);
      const commentId = idSchema.safeParse(params.commentId);
      if (!collectionId.success || !itemId.success || !commentId.success)
        return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const session = request.session!;
      const collection = await loadCollection(
        pool,
        collectionId.data,
        session.instanceId,
        session.id,
      );
      if (!collection) return reply.code(404).send({ error: 'COLLECTION_NOT_FOUND' });
      const result = await pool.query(
        `UPDATE collection_item_comment comment SET deleted_at = now()
         FROM collection_item item
         WHERE comment.id = $1 AND comment.item_id = $2
           AND item.id = comment.item_id AND item.collection_id = $3
           AND comment.deleted_at IS NULL
           AND (comment.member_id = $4 OR $5::boolean)`,
        [commentId.data, itemId.data, collection.id, session.id, collection.editable],
      );
      if (!result.rowCount) return reply.code(404).send({ error: 'COMMENT_NOT_FOUND' });
      return reply.code(204).send();
    },
  );
}
