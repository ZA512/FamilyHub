import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, statfs } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { uploadInitSchema, type ChatAttachment, type StorageUsage } from '@familyhub/contracts';
import { fileTypeFromFile } from 'file-type';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';

import { createSessionGuard, requireCsrf } from './auth.js';
import { readStorageQuota } from './runtime-settings.js';

const idSchema = z.string().uuid();
const MAX_AVATAR_BYTES = 5_242_880;
const textTypes = new Set(['text/plain', 'text/csv', 'application/json']);
const binaryTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

async function requireFileModule(
  request: FastifyRequest,
  reply: FastifyReply,
  pool: Pool,
): Promise<boolean> {
  if (!request.session) return false;
  const result = await pool.query(
    `SELECT 1 FROM module_config
     WHERE instance_id = $1 AND module_key IN ('chat', 'documents') AND enabled = true
     LIMIT 1`,
    [request.session.instanceId],
  );
  if (!result.rowCount) {
    await reply.code(404).send({ error: 'MODULE_NOT_AVAILABLE' });
    return false;
  }
  return true;
}

function cleanFilename(filename: string): string {
  return basename(filename.replaceAll('\\', '/'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
}

async function detectMime(path: string, declaredMime: string): Promise<string | null> {
  const detected = await fileTypeFromFile(path);
  if (detected) return binaryTypes.has(detected.mime) ? detected.mime : null;
  const normalizedDeclared = declaredMime.split(';', 1)[0]!.trim().toLowerCase();
  if (!textTypes.has(normalizedDeclared)) return null;
  const sample = Buffer.alloc(8_192);
  const stream = createReadStream(path, { start: 0, end: sample.length - 1 });
  let offset = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    offset += buffer.copy(sample, offset, 0, sample.length - offset);
  }
  return sample.subarray(0, offset).includes(0) ? null : normalizedDeclared;
}

async function removeUploadFiles(request: FastifyRequest, storageKeys: string[]): Promise<void> {
  for (const storageKey of storageKeys) {
    const finalPath = join(request.server.config.ATTACHMENTS_DIR, storageKey);
    try {
      await Promise.all([
        rm(finalPath, { force: true }),
        rm(`${finalPath}.uploading`, { force: true }),
      ]);
    } catch (error) {
      request.log.warn({ error }, 'Could not remove an expired upload file.');
    }
  }
}

async function filesystemFreeBytes(directory: string): Promise<number | null> {
  try {
    await mkdir(directory, { recursive: true });
    const statistics = await statfs(directory);
    return statistics.bavail * statistics.bsize;
  } catch {
    return null;
  }
}

export async function registerAttachmentRoutes(app: FastifyInstance, pool: Pool) {
  const requireSession = createSessionGuard(pool);

  app.get('/api/v1/storage/usage', { preHandler: requireSession }, async (request) => {
    const [stored, freeBytes, usage] = await Promise.all([
      pool.query<{ storageQuota: unknown }>(
        `SELECT settings -> 'storageQuotaBytes' AS "storageQuota"
         FROM module_config WHERE instance_id = $1 AND module_key = 'settings'`,
        [request.session?.instanceId],
      ),
      filesystemFreeBytes(request.server.config.ATTACHMENTS_DIR),
      pool.query<{
        usedBytes: number;
        reservedBytes: number;
        attachmentCount: number;
      }>(
        `SELECT
           COALESCE(sum(actual_size) FILTER (WHERE status = 'READY'), 0)::bigint::float8 AS "usedBytes",
           COALESCE(sum(expected_size) FILTER (
             WHERE status <> 'READY' AND created_at > now() - interval '24 hours'
           ), 0)::bigint::float8 AS "reservedBytes",
           count(*) FILTER (WHERE status = 'READY')::int AS "attachmentCount"
         FROM attachment WHERE instance_id = $1`,
        [request.session?.instanceId],
      ),
    ]);
    return {
      usage: {
        usedBytes: usage.rows[0]?.usedBytes ?? 0,
        reservedBytes: usage.rows[0]?.reservedBytes ?? 0,
        attachmentCount: usage.rows[0]?.attachmentCount ?? 0,
        quotaBytes: readStorageQuota(stored.rows[0]?.storageQuota),
        filesystemFreeBytes: freeBytes,
      } satisfies StorageUsage,
    };
  });

  app.get('/api/v1/uploads/config', { preHandler: requireSession }, async (request, reply) => {
    if (!(await requireFileModule(request, reply, pool))) return;
    return {
      maxUploadBytes: request.server.config.MAX_UPLOAD_BYTES,
      maxAttachmentsPerMessage: 8,
    };
  });

  app.post(
    '/api/v1/uploads/init',
    {
      preHandler: [requireSession, requireCsrf],
      config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      const parsed = uploadInitSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      if (parsed.data.purpose === 'RESOURCE' && !(await requireFileModule(request, reply, pool)))
        return;
      if (
        parsed.data.purpose === 'AVATAR' &&
        !parsed.data.contentType.toLowerCase().startsWith('image/')
      ) {
        return reply.code(400).send({ error: 'INVALID_AVATAR_TYPE' });
      }
      const uploadLimit =
        parsed.data.purpose === 'AVATAR'
          ? MAX_AVATAR_BYTES
          : request.server.config.MAX_UPLOAD_BYTES;
      if (parsed.data.size > uploadLimit) {
        return reply.code(413).send({ error: 'FILE_TOO_LARGE' });
      }
      const freeBytes = await filesystemFreeBytes(request.server.config.ATTACHMENTS_DIR);
      if (freeBytes !== null && parsed.data.size > freeBytes) {
        return reply.code(507).send({
          error: 'FILESYSTEM_CAPACITY_EXCEEDED',
          availableBytes: freeBytes,
        });
      }
      const filename = cleanFilename(parsed.data.filename);
      if (!filename) return reply.code(400).send({ error: 'INVALID_FILENAME' });
      const client = await pool.connect();
      let uploadId: string | undefined;
      let staleStorageKeys: string[] = [];
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          request.session!.instanceId,
        ]);
        const staleUploads = await client.query<{ storage_key: string }>(
          `DELETE FROM attachment
           WHERE instance_id = $1 AND status <> 'READY'
             AND created_at <= now() - interval '24 hours'
           RETURNING storage_key`,
          [request.session!.instanceId],
        );
        staleStorageKeys = staleUploads.rows.map((row) => row.storage_key);
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM attachment
           WHERE instance_id = $1 AND client_mutation_id = $2
             AND uploaded_by = $3 AND original_filename = $4 AND expected_size = $5
             AND upload_purpose = $6`,
          [
            request.session!.instanceId,
            parsed.data.clientMutationId,
            request.session!.id,
            filename,
            parsed.data.size,
            parsed.data.purpose,
          ],
        );
        uploadId = existing.rows[0]?.id;
        if (!uploadId) {
          const capacity = await client.query<{
            quota: unknown;
            allocated: number;
          }>(
            `SELECT
               mc.settings -> 'storageQuotaBytes' AS quota,
               COALESCE((
                 SELECT sum(CASE WHEN a.status = 'READY' THEN a.actual_size ELSE a.expected_size END)
                 FROM attachment a
                 WHERE a.instance_id = mc.instance_id
                   AND (a.status = 'READY' OR a.created_at > now() - interval '24 hours')
               ), 0)::bigint::float8 AS allocated
             FROM module_config mc
             WHERE mc.instance_id = $1 AND mc.module_key = 'settings'`,
            [request.session!.instanceId],
          );
          const quota = readStorageQuota(capacity.rows[0]?.quota);
          const allocated = capacity.rows[0]?.allocated ?? 0;
          if (allocated + parsed.data.size > quota) {
            await client.query('COMMIT');
            await removeUploadFiles(request, staleStorageKeys);
            return reply.code(507).send({
              error: 'STORAGE_QUOTA_EXCEEDED',
              usedBytes: allocated,
              quotaBytes: quota,
            });
          }
          const result = await client.query<{ id: string }>(
            `INSERT INTO attachment
               (instance_id, uploaded_by, original_filename, declared_mime,
                expected_size, client_mutation_id, upload_purpose)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [
              request.session!.instanceId,
              request.session!.id,
              filename,
              parsed.data.contentType,
              parsed.data.size,
              parsed.data.clientMutationId,
              parsed.data.purpose,
            ],
          );
          uploadId = result.rows[0]?.id;
        }
        await client.query('COMMIT');
        await removeUploadFiles(request, staleStorageKeys);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      if (!uploadId) return reply.code(409).send({ error: 'UPLOAD_CONFLICT' });
      return reply.code(201).send({ uploadId });
    },
  );

  app.put(
    '/api/v1/uploads/:id/content',
    {
      bodyLimit: 1_073_742_848,
      preHandler: [requireSession, requireCsrf],
      config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      const id = idSchema.safeParse((request.params as { id?: string }).id);
      if (!id.success || !(request.body instanceof Readable)) {
        return reply.code(400).send({ error: 'INVALID_UPLOAD' });
      }
      const claimed = await pool.query<{
        storageKey: string;
        expectedSize: number;
        declaredMime: string;
        uploadPurpose: 'RESOURCE' | 'AVATAR';
      }>(
        `UPDATE attachment SET status = 'UPLOADING'
         WHERE id = $1 AND instance_id = $2 AND uploaded_by = $3 AND status = 'PENDING'
         RETURNING storage_key AS "storageKey", expected_size AS "expectedSize",
                   declared_mime AS "declaredMime", upload_purpose AS "uploadPurpose"`,
        [id.data, request.session!.instanceId, request.session!.id],
      );
      const upload = claimed.rows[0];
      if (!upload) return reply.code(404).send({ error: 'UPLOAD_NOT_FOUND' });
      const contentLength = Number(request.headers['content-length']);
      if (Number.isFinite(contentLength) && contentLength !== upload.expectedSize) {
        await pool.query("UPDATE attachment SET status = 'PENDING' WHERE id = $1", [id.data]);
        return reply.code(400).send({ error: 'FILE_SIZE_MISMATCH' });
      }

      await mkdir(request.server.config.ATTACHMENTS_DIR, { recursive: true });
      const finalPath = join(request.server.config.ATTACHMENTS_DIR, upload.storageKey);
      const temporaryPath = `${finalPath}.uploading`;
      let actualSize = 0;
      const hash = createHash('sha256');
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          actualSize += chunk.length;
          if (
            actualSize > upload.expectedSize ||
            actualSize >
              (upload.uploadPurpose === 'AVATAR'
                ? MAX_AVATAR_BYTES
                : request.server.config.MAX_UPLOAD_BYTES)
          ) {
            callback(new Error('FILE_TOO_LARGE'));
            return;
          }
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      try {
        await pipeline(request.body, meter, createWriteStream(temporaryPath, { flags: 'wx' }));
        if (actualSize !== upload.expectedSize) throw new Error('FILE_SIZE_MISMATCH');
        const detectedMime = await detectMime(temporaryPath, upload.declaredMime);
        if (!detectedMime) throw new Error('FILE_TYPE_NOT_ALLOWED');
        await rename(temporaryPath, finalPath);
        await pool.query(
          `UPDATE attachment
           SET status = 'UPLOADED', detected_mime = $2, actual_size = $3, sha256 = $4
           WHERE id = $1`,
          [id.data, detectedMime, actualSize, hash.digest('hex')],
        );
        return reply.code(204).send();
      } catch (error) {
        await rm(temporaryPath, { force: true });
        await pool.query("UPDATE attachment SET status = 'PENDING' WHERE id = $1", [id.data]);
        const reason = error instanceof Error ? error.message : 'UPLOAD_FAILED';
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'ENOSPC'
        ) {
          return reply.code(507).send({ error: 'FILESYSTEM_CAPACITY_EXCEEDED' });
        }
        if (reason === 'FILE_TOO_LARGE') return reply.code(413).send({ error: reason });
        if (reason === 'FILE_SIZE_MISMATCH' || reason === 'FILE_TYPE_NOT_ALLOWED') {
          return reply.code(400).send({ error: reason });
        }
        throw error;
      }
    },
  );

  app.post(
    '/api/v1/uploads/:id/complete',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      const id = idSchema.safeParse((request.params as { id?: string }).id);
      if (!id.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const result = await pool.query<{
        id: string;
        filename: string;
        contentType: string;
        size: number;
        sha256: string;
      }>(
        `UPDATE attachment SET status = 'READY', completed_at = now()
         WHERE id = $1 AND instance_id = $2 AND uploaded_by = $3 AND status = 'UPLOADED'
         RETURNING id, original_filename AS filename, detected_mime AS "contentType",
                   actual_size AS size, sha256`,
        [id.data, request.session!.instanceId, request.session!.id],
      );
      const attachment = result.rows[0];
      if (!attachment) return reply.code(404).send({ error: 'UPLOAD_NOT_FOUND' });
      return {
        ...attachment,
        kind: attachment.contentType.startsWith('image/') ? 'image' : 'file',
        url: `/api/v1/attachments/${attachment.id}/content`,
      } satisfies ChatAttachment;
    },
  );

  app.get(
    '/api/v1/attachments/:id/content',
    { preHandler: requireSession },
    async (request, reply) => {
      const id = idSchema.safeParse((request.params as { id?: string }).id);
      if (!id.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const result = await pool.query<{
        filename: string;
        contentType: string;
        size: number;
        storageKey: string;
      }>(
        `SELECT a.original_filename AS filename, a.detected_mime AS "contentType",
                a.actual_size AS size, a.storage_key AS "storageKey"
         FROM attachment a
         WHERE a.id = $1 AND a.instance_id = $2 AND a.status = 'READY'
           AND (
             EXISTS (
               SELECT 1 FROM message_attachment ma
               JOIN message m ON m.id = ma.message_id
               JOIN conversation_member cm ON cm.conversation_id = m.conversation_id
               JOIN module_config mc ON mc.instance_id = a.instance_id
                 AND mc.module_key = 'chat' AND mc.enabled = true
               WHERE ma.attachment_id = a.id AND m.deleted_at IS NULL AND cm.member_id = $3
             )
             OR EXISTS (
               SELECT 1 FROM document d
               JOIN resource r ON r.id = d.id
               JOIN module_config mc ON mc.instance_id = r.instance_id
                 AND mc.module_key = 'documents' AND mc.enabled = true
               WHERE d.attachment_id = a.id AND r.deleted_at IS NULL
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
             )
             OR EXISTS (
               SELECT 1
               FROM member_profile_preference mpp
               JOIN instance_member profile_member ON profile_member.id = mpp.member_id
               WHERE mpp.avatar_attachment_id = a.id
                 AND profile_member.instance_id = a.instance_id
                 AND (
                   mpp.member_id = $3 OR $4 = 'ADMIN'
                   OR mpp.visibility = 'ALL_MEMBERS'
                 )
             )
           )`,
        [id.data, request.session!.instanceId, request.session!.id, request.session!.role],
      );
      const attachment = result.rows[0];
      if (!attachment) return reply.code(404).send({ error: 'ATTACHMENT_NOT_FOUND' });
      const inline = attachment.contentType.startsWith('image/');
      const encodedName = encodeURIComponent(attachment.filename);
      reply.headers({
        'Cache-Control': 'private, max-age=3600',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="download"; filename*=UTF-8''${encodedName}`,
        'Content-Length': String(attachment.size),
        'Content-Type': attachment.contentType,
        'X-Content-Type-Options': 'nosniff',
      });
      return reply.send(
        createReadStream(join(request.server.config.ATTACHMENTS_DIR, attachment.storageKey)),
      );
    },
  );
}
