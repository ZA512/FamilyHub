import {
  contactCreateSchema,
  contactsQuerySchema,
  contactUpdateSchema,
  type ContactVisibility,
  type FamilyContact,
} from '@familyhub/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import { createSessionGuard, requireCsrf } from './auth.js';

const idSchema = z.string().uuid();

type ContactRow = {
  id: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  tags: string[];
  visibility: ContactVisibility;
  groupIds: string[];
  memberIds: string[];
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

const selectContact = `
  SELECT c.id, c.first_name AS "firstName", c.last_name AS "lastName", c.phone,
         c.email, c.address, c.notes,
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
         r.created_by AS "createdBy", creator.first_name AS "createdByName",
         c.version, c.created_at AS "createdAt", c.updated_at AS "updatedAt"
  FROM contact c
  JOIN resource r ON r.id = c.id
  JOIN instance_member creator_member ON creator_member.id = r.created_by
  JOIN app_user creator ON creator.id = creator_member.user_id
`;

async function requireContactsModule(request: FastifyRequest, reply: FastifyReply, pool: Pool) {
  if (!request.session) return false;
  const result = await pool.query(
    `SELECT 1 FROM module_config
     WHERE instance_id = $1 AND module_key = 'contacts' AND enabled = true`,
    [request.session.instanceId],
  );
  if (!result.rowCount) {
    await reply.code(404).send({ error: 'MODULE_NOT_AVAILABLE' });
    return false;
  }
  return true;
}

function serializeContact(row: ContactRow, memberId: string): FamilyContact {
  return {
    ...row,
    editable: row.createdBy === memberId,
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
  visibility: ContactVisibility,
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

async function isActiveMemberEmail(client: Pool | PoolClient, instanceId: string, email: string | null) {
  if (!email) return false;
  const result = await client.query(
    `SELECT 1 FROM instance_member m JOIN app_user u ON u.id = m.user_id
     WHERE m.instance_id = $1 AND m.status = 'ACTIVE' AND lower(u.email) = lower($2) LIMIT 1`,
    [instanceId, email],
  );
  return Boolean(result.rowCount);
}

async function replaceAudience(
  client: PoolClient,
  contactId: string,
  visibility: ContactVisibility,
  groupIds: string[],
  memberIds: string[],
) {
  await client.query('DELETE FROM resource_acl_group WHERE resource_id = $1', [contactId]);
  await client.query('DELETE FROM resource_acl_user WHERE resource_id = $1', [contactId]);
  if (visibility === 'GROUPS') {
    await client.query(
      `INSERT INTO resource_acl_group (resource_id, group_id)
       SELECT $1, id FROM unnest($2::uuid[]) AS selected(id) ON CONFLICT DO NOTHING`,
      [contactId, [...new Set(groupIds)]],
    );
  }
  if (visibility === 'SELECTED_USERS') {
    await client.query(
      `INSERT INTO resource_acl_user (resource_id, member_id)
       SELECT $1, id FROM unnest($2::uuid[]) AS selected(id) ON CONFLICT DO NOTHING`,
      [contactId, [...new Set(memberIds)]],
    );
  }
}

async function replaceTags(
  client: PoolClient,
  contactId: string,
  instanceId: string,
  memberId: string,
  tags: string[],
) {
  await client.query('DELETE FROM resource_tag WHERE resource_id = $1', [contactId]);
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
        [contactId, result.rows[0].id],
      );
    }
  }
}

async function replaceShareNotifications(
  client: PoolClient,
  instanceId: string,
  memberId: string,
  memberName: string,
  contactId: string,
  contactName: string,
  visibility: ContactVisibility,
  groupIds: string[],
  memberIds: string[],
) {
  await client.query("DELETE FROM notification WHERE resource_type = 'contact' AND resource_id = $1", [contactId]);
  if (visibility === 'PRIVATE') return;
  await client.query(
    `INSERT INTO notification
       (instance_id, recipient_member_id, actor_member_id, type, module_key,
        title, body, resource_type, resource_id)
     SELECT DISTINCT $1::uuid, recipient.id, $2::uuid, 'CONTACT_SHARED', 'contacts',
            'Nouveau contact partagé', concat($3::text, ' partage le contact « ', $4::text, ' »'),
            'contact', $5::uuid
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
    [instanceId, memberId, memberName, contactName, contactId, visibility, groupIds, memberIds],
  );
}

async function loadContact(
  client: Pool | PoolClient,
  contactId: string,
  instanceId: string,
  memberId: string,
) {
  const result = await client.query<ContactRow>(
    `${selectContact} WHERE c.id = $3 AND ${readableResource}`,
    [instanceId, memberId, contactId],
  );
  return result.rows[0] ? serializeContact(result.rows[0], memberId) : null;
}

export async function registerContactRoutes(app: FastifyInstance, pool: Pool) {
  const requireSession = createSessionGuard(pool);

  app.get('/api/v1/contacts', { preHandler: requireSession }, async (request, reply) => {
    if (!(await requireContactsModule(request, reply, pool))) return;
    const parsed = contactsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const session = request.session!;
    const result = await pool.query<ContactRow>(
      `${selectContact}
       WHERE ${readableResource}
         AND ($3 = 'all' OR ($3 = 'mine' AND r.created_by = $2)
              OR ($3 = 'shared' AND r.created_by <> $2 AND r.visibility <> 'PRIVATE'))
         AND ($4::text IS NULL OR concat_ws(' ', c.first_name, c.last_name, c.phone, c.email, c.address, c.notes) ILIKE concat('%', $4, '%'))
         AND ($5::text IS NULL OR EXISTS (
           SELECT 1 FROM resource_tag filter_rt JOIN tag filter_t ON filter_t.id = filter_rt.tag_id
           WHERE filter_rt.resource_id = c.id AND filter_t.normalized_name = lower($5)
         ))
         AND ($6::timestamptz IS NULL OR (c.updated_at, c.id) < ($6::timestamptz, $7::uuid))
       ORDER BY c.updated_at DESC, c.id DESC
       LIMIT $8`,
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
      contacts: result.rows.slice(0, parsed.data.limit).map((row) => serializeContact(row, session.id)),
      hasMore,
    };
  });

  app.get('/api/v1/contacts/:id', { preHandler: requireSession }, async (request, reply) => {
    if (!(await requireContactsModule(request, reply, pool))) return;
    const id = idSchema.safeParse((request.params as { id?: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const contact = await loadContact(pool, id.data, request.session!.instanceId, request.session!.id);
    return contact ? { contact } : reply.code(404).send({ error: 'CONTACT_NOT_FOUND' });
  });

  app.post('/api/v1/contacts', { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    if (!(await requireContactsModule(request, reply, pool))) return;
    const parsed = contactCreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST', details: parsed.error.flatten() });
    const session = request.session!;
    if (!(await validAudience(pool, session.instanceId, parsed.data.visibility, parsed.data.groupIds, parsed.data.memberIds))) {
      return reply.code(400).send({ error: 'INVALID_AUDIENCE' });
    }
    if (await isActiveMemberEmail(pool, session.instanceId, parsed.data.email ?? null)) {
      return reply.code(409).send({ error: 'MEMBER_IS_INTERNAL_CONTACT' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ id: string }>(
        'SELECT id FROM contact WHERE instance_id = $1 AND client_mutation_id = $2',
        [session.instanceId, parsed.data.clientMutationId],
      );
      let contactId = existing.rows[0]?.id;
      if (!contactId) {
        contactId = parsed.data.clientMutationId;
        await client.query(
          `INSERT INTO resource (id, instance_id, resource_type, created_by, visibility)
           VALUES ($1, $2, 'contact', $3, $4)`,
          [contactId, session.instanceId, session.id, parsed.data.visibility],
        );
        await client.query(
          `INSERT INTO contact
             (id, instance_id, first_name, last_name, phone, email, address, notes, client_mutation_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $1)`,
          [contactId, session.instanceId, parsed.data.firstName, parsed.data.lastName ?? null,
            parsed.data.phone ?? null, parsed.data.email ?? null, parsed.data.address ?? null,
            parsed.data.notes ?? null],
        );
        await replaceAudience(client, contactId, parsed.data.visibility, parsed.data.groupIds, parsed.data.memberIds);
        await replaceTags(client, contactId, session.instanceId, session.id, parsed.data.tags);
        await replaceShareNotifications(client, session.instanceId, session.id, session.firstName, contactId,
          [parsed.data.firstName, parsed.data.lastName].filter(Boolean).join(' '), parsed.data.visibility,
          parsed.data.groupIds, parsed.data.memberIds);
      }
      const contact = await loadContact(client, contactId, session.instanceId, session.id);
      if (!contact) throw new Error('Contact creation returned no readable row.');
      await client.query('COMMIT');
      return reply.code(existing.rowCount ? 200 : 201).send({ contact });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.put('/api/v1/contacts/:id', { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    if (!(await requireContactsModule(request, reply, pool))) return;
    const id = idSchema.safeParse((request.params as { id?: string }).id);
    const parsed = contactUpdateSchema.safeParse(request.body);
    if (!id.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const session = request.session!;
    if (!(await validAudience(pool, session.instanceId, parsed.data.visibility, parsed.data.groupIds, parsed.data.memberIds))) {
      return reply.code(400).send({ error: 'INVALID_AUDIENCE' });
    }
    if (await isActiveMemberEmail(pool, session.instanceId, parsed.data.email ?? null)) {
      return reply.code(409).send({ error: 'MEMBER_IS_INTERNAL_CONTACT' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await loadContact(client, id.data, session.instanceId, session.id);
      if (!current) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'CONTACT_NOT_FOUND' });
      }
      if (!current.editable) {
        await client.query('ROLLBACK');
        return reply.code(403).send({ error: 'CONTACT_NOT_OWNED' });
      }
      if (current.version !== parsed.data.version) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'VERSION_CONFLICT', contact: current });
      }
      await client.query('UPDATE resource SET visibility = $2, version = version + 1, updated_at = now() WHERE id = $1', [id.data, parsed.data.visibility]);
      await client.query(
        `UPDATE contact SET first_name = $2, last_name = $3, phone = $4, email = $5,
           address = $6, notes = $7, version = version + 1, updated_at = now() WHERE id = $1`,
        [id.data, parsed.data.firstName, parsed.data.lastName ?? null, parsed.data.phone ?? null,
          parsed.data.email ?? null, parsed.data.address ?? null, parsed.data.notes ?? null],
      );
      await replaceAudience(client, id.data, parsed.data.visibility, parsed.data.groupIds, parsed.data.memberIds);
      await replaceTags(client, id.data, session.instanceId, session.id, parsed.data.tags);
      await replaceShareNotifications(client, session.instanceId, session.id, session.firstName, id.data,
        [parsed.data.firstName, parsed.data.lastName].filter(Boolean).join(' '), parsed.data.visibility,
        parsed.data.groupIds, parsed.data.memberIds);
      const contact = await loadContact(client, id.data, session.instanceId, session.id);
      await client.query('COMMIT');
      return { contact };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.delete('/api/v1/contacts/:id', { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    if (!(await requireContactsModule(request, reply, pool))) return;
    const id = idSchema.safeParse((request.params as { id?: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE resource SET deleted_at = now(), updated_at = now()
         WHERE id = $1 AND instance_id = $2 AND resource_type = 'contact'
           AND created_by = $3 AND deleted_at IS NULL`,
        [id.data, request.session!.instanceId, request.session!.id],
      );
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'CONTACT_NOT_FOUND' });
      }
      await client.query("DELETE FROM notification WHERE resource_type = 'contact' AND resource_id = $1", [id.data]);
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
