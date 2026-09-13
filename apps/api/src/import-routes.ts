import { randomUUID } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import { createSessionGuard, requireCsrf } from './auth.js';

const importBookmarkSchema = z.object({
  id: z.string().uuid().optional(),
  url: z
    .string()
    .url()
    .max(2_048)
    .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol)),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(1_000).nullable().optional(),
  personal_comment: z.string().max(1_000).nullable().optional(),
  personalComment: z.string().max(1_000).nullable().optional(),
  favicon_url: z.string().url().max(2_048).nullable().optional(),
  og_image_url: z.string().url().max(2_048).nullable().optional(),
});

const bookmarkImportSchema = z.object({
  bookmarks: z.array(importBookmarkSchema).min(1).max(1_000),
  tags: z
    .array(z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(40) }))
    .max(5_000)
    .default([]),
  resourceTags: z
    .array(
      z.object({
        resource_id: z.string().uuid(),
        tag_id: z.string().uuid(),
      }),
    )
    .max(12_000)
    .default([]),
});

function normalizeUrl(value: string) {
  const url = new URL(value);
  url.hash = '';
  return url.href;
}

async function requireBookmarks(request: FastifyRequest, reply: FastifyReply, pool: Pool) {
  const result = await pool.query(
    `SELECT 1 FROM module_config
     WHERE instance_id = $1 AND module_key = 'bookmarks' AND enabled = true`,
    [request.session?.instanceId],
  );
  if (result.rowCount) return true;
  await reply.code(404).send({ error: 'MODULE_NOT_AVAILABLE' });
  return false;
}

async function attachImportedTags(
  client: PoolClient,
  bookmarkId: string,
  oldBookmarkId: string | undefined,
  tagNames: Map<string, string>,
  resourceTags: Array<{ resource_id: string; tag_id: string }>,
  instanceId: string,
  memberId: string,
) {
  if (!oldBookmarkId) return;
  const oldTagIds = resourceTags
    .filter((entry) => entry.resource_id === oldBookmarkId)
    .map((entry) => entry.tag_id);
  for (const oldTagId of oldTagIds.slice(0, 12)) {
    const name = tagNames.get(oldTagId);
    if (!name) continue;
    const normalized = name.toLocaleLowerCase('fr');
    const tag = await client.query<{ id: string }>(
      `INSERT INTO tag (instance_id, name, normalized_name, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (instance_id, normalized_name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [instanceId, name, normalized, memberId],
    );
    if (tag.rows[0]) {
      await client.query(
        `INSERT INTO resource_tag (resource_id, tag_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [bookmarkId, tag.rows[0].id],
      );
    }
  }
}

export async function registerImportRoutes(app: FastifyInstance, pool: Pool) {
  const requireSession = createSessionGuard(pool);

  app.post(
    '/api/v1/imports/bookmarks',
    {
      bodyLimit: 5_242_880,
      preHandler: [requireSession, requireCsrf],
      config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      if (!(await requireBookmarks(request, reply, pool))) return;
      const parsed = bookmarkImportSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'INVALID_IMPORT' });
      const session = request.session!;
      const tagNames = new Map(parsed.data.tags.map((tag) => [tag.id, tag.name]));
      const client = await pool.connect();
      let imported = 0;
      let skipped = 0;
      try {
        await client.query('BEGIN');
        for (const source of parsed.data.bookmarks) {
          const url = normalizeUrl(source.url);
          const duplicate = await client.query(
            `SELECT 1 FROM bookmark b JOIN resource r ON r.id = b.id
             WHERE b.instance_id = $1 AND r.created_by = $2
               AND b.normalized_url = $3 AND r.deleted_at IS NULL`,
            [session.instanceId, session.id, url],
          );
          if (duplicate.rowCount) {
            skipped += 1;
            continue;
          }
          const id = randomUUID();
          await client.query(
            `INSERT INTO resource (id, instance_id, resource_type, created_by, visibility)
             VALUES ($1, $2, 'bookmark', $3, 'PRIVATE')`,
            [id, session.instanceId, session.id],
          );
          await client.query(
            `INSERT INTO bookmark
               (id, instance_id, url, normalized_url, title, description,
                personal_comment, favicon_url, og_image_url, client_mutation_id)
             VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $1)`,
            [
              id,
              session.instanceId,
              url,
              source.title,
              source.description ?? null,
              source.personalComment ?? source.personal_comment ?? null,
              source.favicon_url ?? null,
              source.og_image_url ?? null,
            ],
          );
          await attachImportedTags(
            client,
            id,
            source.id,
            tagNames,
            parsed.data.resourceTags,
            session.instanceId,
            session.id,
          );
          imported += 1;
        }
        await client.query(
          `INSERT INTO admin_audit_log
             (instance_id, actor_member_id, action, target_type, details)
           VALUES ($1, $2, 'member.imported', 'bookmarks', $3::jsonb)`,
          [session.instanceId, session.id, JSON.stringify({ imported, skipped })],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      return reply.code(201).send({ imported, skipped });
    },
  );
}
