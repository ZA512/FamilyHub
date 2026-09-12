import {
  documentCreateSchema,
  documentsQuerySchema,
  documentUpdateSchema,
  type DocumentVisibility,
  type FamilyDocument,
} from '@familyhub/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import { createSessionGuard, requireCsrf } from './auth.js';

const idSchema = z.string().uuid();

type DocumentRow = {
  id: string;
  title: string;
  category: string;
  comment: string | null;
  tags: string[];
  visibility: DocumentVisibility;
  groupIds: string[];
  memberIds: string[];
  attachmentId: string;
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
  createdBy: string;
  createdByName: string;
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

const selectDocument = `
  SELECT d.id, d.title, d.category, d.comment,
         COALESCE(ARRAY(
           SELECT t.name FROM resource_tag rt JOIN tag t ON t.id = rt.tag_id
           WHERE rt.resource_id = d.id ORDER BY lower(t.name)
         ), '{}') AS tags,
         r.visibility,
         CASE WHEN r.created_by = $2 THEN COALESCE(ARRAY(
           SELECT rag.group_id FROM resource_acl_group rag WHERE rag.resource_id = d.id
         ), '{}') ELSE '{}' END AS "groupIds",
         CASE WHEN r.created_by = $2 THEN COALESCE(ARRAY(
           SELECT rau.member_id FROM resource_acl_user rau WHERE rau.resource_id = d.id
         ), '{}') ELSE '{}' END AS "memberIds",
         a.id AS "attachmentId", a.original_filename AS filename,
         a.detected_mime AS "contentType", a.actual_size AS size, a.sha256,
         r.created_by AS "createdBy", creator.first_name AS "createdByName",
         d.version, d.created_at AS "createdAt", d.updated_at AS "updatedAt"
  FROM document d
  JOIN resource r ON r.id = d.id
  JOIN attachment a ON a.id = d.attachment_id AND a.status = 'READY'
  JOIN instance_member creator_member ON creator_member.id = r.created_by
  JOIN app_user creator ON creator.id = creator_member.user_id
`;

async function requireDocumentsModule(
  request: FastifyRequest,
  reply: FastifyReply,
  pool: Pool,
) {
  if (!request.session) return false;
  const result = await pool.query(
    `SELECT 1 FROM module_config
     WHERE instance_id = $1 AND module_key = 'documents' AND enabled = true`,
    [request.session.instanceId],
  );
  if (!result.rowCount) {
    await reply.code(404).send({ error: 'MODULE_NOT_AVAILABLE' });
    return false;
  }
  return true;
}

function serializeDocument(row: DocumentRow, memberId: string): FamilyDocument {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    comment: row.comment,
    tags: row.tags,
    visibility: row.visibility,
    groupIds: row.groupIds,
    memberIds: row.memberIds,
    attachment: {
      id: row.attachmentId,
      filename: row.filename,
      contentType: row.contentType,
      size: row.size,
      sha256: row.sha256,
      kind: row.contentType.startsWith('image/') ? 'image' : 'file',
      url: `/api/v1/attachments/${row.attachmentId}/content`,
    },
    createdBy: row.createdBy,
    createdByName: row.createdByName,
    editable: row.createdBy === memberId,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function normalizedTags(tags: string[]) {
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
  visibility: DocumentVisibility,
  groupIds: string[],
  memberIds: string[],
) {
  if (visibility === 'GROUPS') {
    const ids = [...new Set(groupIds)];
    const result = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM member_group WHERE instance_id = $1 AND id = ANY($2::uuid[])',
      [instanceId, ids],
    );
    return result.rows[0]?.count === ids.length;
  }
  if (visibility === 'SELECTED_USERS') {
    const ids = [...new Set(memberIds)];
    const result = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM instance_member
       WHERE instance_id = $1 AND status = 'ACTIVE' AND id = ANY($2::uuid[])`,
      [instanceId, ids],
    );
    return result.rows[0]?.count === ids.length;
  }
  return true;
}

async function replaceAudience(
  client: PoolClient,
  documentId: string,
  visibility: DocumentVisibility,
  groupIds: string[],
  memberIds: string[],
) {
  await client.query('DELETE FROM resource_acl_group WHERE resource_id = $1', [documentId]);
  await client.query('DELETE FROM resource_acl_user WHERE resource_id = $1', [documentId]);
  if (visibility === 'GROUPS') {
    await client.query(
      `INSERT INTO resource_acl_group (resource_id, group_id)
       SELECT $1, id FROM unnest($2::uuid[]) AS selected(id) ON CONFLICT DO NOTHING`,
      [documentId, [...new Set(groupIds)]],
    );
  }
  if (visibility === 'SELECTED_USERS') {
    await client.query(
      `INSERT INTO resource_acl_user (resource_id, member_id)
       SELECT $1, id FROM unnest($2::uuid[]) AS selected(id) ON CONFLICT DO NOTHING`,
      [documentId, [...new Set(memberIds)]],
    );
  }
}

async function replaceTags(
  client: PoolClient,
  documentId: string,
  instanceId: string,
  memberId: string,
  tags: string[],
) {
  await client.query('DELETE FROM resource_tag WHERE resource_id = $1', [documentId]);
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
        'INSERT INTO resource_tag (resource_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [documentId, result.rows[0].id],
      );
    }
  }
}

async function replaceShareNotifications(
  client: PoolClient,
  instanceId: string,
  memberId: string,
  memberName: string,
  documentId: string,
  title: string,
  visibility: DocumentVisibility,
  groupIds: string[],
  memberIds: string[],
) {
  await client.query(
    "DELETE FROM notification WHERE resource_type = 'document' AND resource_id = $1",
    [documentId],
  );
  if (visibility === 'PRIVATE') return;
  await client.query(
    `INSERT INTO notification
       (instance_id, recipient_member_id, actor_member_id, type, module_key,
        title, body, resource_type, resource_id)
     SELECT DISTINCT $1::uuid, recipient.id, $2::uuid, 'DOCUMENT_SHARED', 'documents',
            'Nouveau document partagé', concat($3::text, ' partage « ', $4::text, ' »'),
            'document', $5::uuid
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
    [instanceId, memberId, memberName, title, documentId, visibility, groupIds, memberIds],
  );
}

async function loadDocument(
  client: Pool | PoolClient,
  documentId: string,
  instanceId: string,
  memberId: string,
) {
  const result = await client.query<DocumentRow>(
    `${selectDocument} WHERE d.id = $3 AND ${readableResource}`,
    [instanceId, memberId, documentId],
  );
  return result.rows[0] ? serializeDocument(result.rows[0], memberId) : null;
}

export async function registerDocumentRoutes(app: FastifyInstance, pool: Pool) {
  const requireSession = createSessionGuard(pool);

  app.get('/api/v1/documents', { preHandler: requireSession }, async (request, reply) => {
    if (!(await requireDocumentsModule(request, reply, pool))) return;
    const parsed = documentsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const session = request.session!;
    const result = await pool.query<DocumentRow>(
      `${selectDocument}
       WHERE ${readableResource}
         AND ($3 = 'all' OR ($3 = 'mine' AND r.created_by = $2)
              OR ($3 = 'shared' AND r.created_by <> $2 AND r.visibility <> 'PRIVATE'))
         AND ($4::text IS NULL OR concat_ws(' ', d.title, d.category, d.comment, a.original_filename) ILIKE concat('%', $4, '%'))
         AND ($5::text IS NULL OR lower(d.category) = lower($5))
         AND ($6::text IS NULL OR EXISTS (
           SELECT 1 FROM resource_tag filter_rt JOIN tag filter_t ON filter_t.id = filter_rt.tag_id
           WHERE filter_rt.resource_id = d.id AND filter_t.normalized_name = lower($6)
         ))
         AND ($7::timestamptz IS NULL OR (d.updated_at, d.id) < ($7::timestamptz, $8::uuid))
       ORDER BY d.updated_at DESC, d.id DESC LIMIT $9`,
      [session.instanceId, session.id, parsed.data.scope, parsed.data.q || null,
        parsed.data.category || null, parsed.data.tag || null, parsed.data.before ?? null,
        parsed.data.beforeId ?? null, parsed.data.limit + 1],
    );
    const hasMore = result.rows.length > parsed.data.limit;
    return {
      documents: result.rows.slice(0, parsed.data.limit).map((row) => serializeDocument(row, session.id)),
      hasMore,
    };
  });

  app.get('/api/v1/documents/:id', { preHandler: requireSession }, async (request, reply) => {
    if (!(await requireDocumentsModule(request, reply, pool))) return;
    const id = idSchema.safeParse((request.params as { id?: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const document = await loadDocument(pool, id.data, request.session!.instanceId, request.session!.id);
    return document ? { document } : reply.code(404).send({ error: 'DOCUMENT_NOT_FOUND' });
  });

  app.post('/api/v1/documents', { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    if (!(await requireDocumentsModule(request, reply, pool))) return;
    const parsed = documentCreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST', details: parsed.error.flatten() });
    const session = request.session!;
    if (!(await validAudience(pool, session.instanceId, parsed.data.visibility, parsed.data.groupIds, parsed.data.memberIds))) {
      return reply.code(400).send({ error: 'INVALID_AUDIENCE' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ id: string }>(
        'SELECT id FROM document WHERE instance_id = $1 AND client_mutation_id = $2',
        [session.instanceId, parsed.data.clientMutationId],
      );
      let documentId = existing.rows[0]?.id;
      if (!documentId) {
        const attachment = await client.query(
          `SELECT 1 FROM attachment a LEFT JOIN document d ON d.attachment_id = a.id
           WHERE a.id = $1 AND a.instance_id = $2 AND a.uploaded_by = $3
             AND a.status = 'READY' AND d.id IS NULL FOR UPDATE OF a`,
          [parsed.data.attachmentId, session.instanceId, session.id],
        );
        if (!attachment.rowCount) {
          await client.query('ROLLBACK');
          return reply.code(400).send({ error: 'INVALID_ATTACHMENT' });
        }
        documentId = parsed.data.clientMutationId;
        await client.query(
          `INSERT INTO resource (id, instance_id, resource_type, created_by, visibility)
           VALUES ($1, $2, 'document', $3, $4)`,
          [documentId, session.instanceId, session.id, parsed.data.visibility],
        );
        await client.query(
          `INSERT INTO document
             (id, instance_id, title, category, comment, attachment_id, client_mutation_id)
           VALUES ($1, $2, $3, $4, $5, $6, $1)`,
          [documentId, session.instanceId, parsed.data.title, parsed.data.category,
            parsed.data.comment ?? null, parsed.data.attachmentId],
        );
        await replaceAudience(client, documentId, parsed.data.visibility, parsed.data.groupIds, parsed.data.memberIds);
        await replaceTags(client, documentId, session.instanceId, session.id, parsed.data.tags);
        await replaceShareNotifications(client, session.instanceId, session.id, session.firstName,
          documentId, parsed.data.title, parsed.data.visibility, parsed.data.groupIds, parsed.data.memberIds);
      }
      const document = await loadDocument(client, documentId, session.instanceId, session.id);
      if (!document) throw new Error('Document creation returned no readable row.');
      await client.query('COMMIT');
      return reply.code(existing.rowCount ? 200 : 201).send({ document });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.put('/api/v1/documents/:id', { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    if (!(await requireDocumentsModule(request, reply, pool))) return;
    const id = idSchema.safeParse((request.params as { id?: string }).id);
    const parsed = documentUpdateSchema.safeParse(request.body);
    if (!id.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const session = request.session!;
    if (!(await validAudience(pool, session.instanceId, parsed.data.visibility, parsed.data.groupIds, parsed.data.memberIds))) {
      return reply.code(400).send({ error: 'INVALID_AUDIENCE' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await loadDocument(client, id.data, session.instanceId, session.id);
      if (!current) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'DOCUMENT_NOT_FOUND' });
      }
      if (!current.editable) {
        await client.query('ROLLBACK');
        return reply.code(403).send({ error: 'DOCUMENT_NOT_OWNED' });
      }
      if (current.version !== parsed.data.version) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'VERSION_CONFLICT', document: current });
      }
      await client.query('UPDATE resource SET visibility = $2, version = version + 1, updated_at = now() WHERE id = $1', [id.data, parsed.data.visibility]);
      await client.query(
        `UPDATE document SET title = $2, category = $3, comment = $4,
           version = version + 1, updated_at = now() WHERE id = $1`,
        [id.data, parsed.data.title, parsed.data.category, parsed.data.comment ?? null],
      );
      await replaceAudience(client, id.data, parsed.data.visibility, parsed.data.groupIds, parsed.data.memberIds);
      await replaceTags(client, id.data, session.instanceId, session.id, parsed.data.tags);
      await replaceShareNotifications(client, session.instanceId, session.id, session.firstName,
        id.data, parsed.data.title, parsed.data.visibility, parsed.data.groupIds, parsed.data.memberIds);
      const document = await loadDocument(client, id.data, session.instanceId, session.id);
      await client.query('COMMIT');
      return { document };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.delete('/api/v1/documents/:id', { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    if (!(await requireDocumentsModule(request, reply, pool))) return;
    const id = idSchema.safeParse((request.params as { id?: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE resource SET deleted_at = now(), updated_at = now()
         WHERE id = $1 AND instance_id = $2 AND resource_type = 'document'
           AND created_by = $3 AND deleted_at IS NULL`,
        [id.data, request.session!.instanceId, request.session!.id],
      );
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'DOCUMENT_NOT_FOUND' });
      }
      await client.query("DELETE FROM notification WHERE resource_type = 'document' AND resource_id = $1", [id.data]);
      await client.query('COMMIT');
      return reply.code(204).send();
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}
