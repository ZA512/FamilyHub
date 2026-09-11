import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { uploadInitSchema, type ChatAttachment } from '@familyhub/contracts';
import { fileTypeFromFile } from 'file-type';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';

import { createSessionGuard, requireCsrf } from './auth.js';

const idSchema = z.string().uuid();
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

async function requireChatModule(
  request: FastifyRequest,
  reply: FastifyReply,
  pool: Pool,
): Promise<boolean> {
  if (!request.session) return false;
  const result = await pool.query(
    `SELECT 1 FROM module_config
     WHERE instance_id = $1 AND module_key = 'chat' AND enabled = true`,
    [request.session.instanceId],
  );
  if (!result.rowCount) {
    await reply.code(404).send({ error: 'MODULE_NOT_AVAILABLE' });
    return false;
  }
  return true;
}

function cleanFilename(filename: string): string {
  return basename(filename.replaceAll('\\', '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
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

export async function registerAttachmentRoutes(app: FastifyInstance, pool: Pool) {
  const requireSession = createSessionGuard(pool);

  app.get('/api/v1/chat/uploads/config', { preHandler: requireSession }, async (request, reply) => {
    if (!(await requireChatModule(request, reply, pool))) return;
    return {
      maxUploadBytes: request.server.config.MAX_UPLOAD_BYTES,
      maxAttachmentsPerMessage: 8,
    };
  });

  app.post(
    '/api/v1/chat/uploads/init',
    {
      preHandler: [requireSession, requireCsrf],
      config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      if (!(await requireChatModule(request, reply, pool))) return;
      const parsed = uploadInitSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      if (parsed.data.size > request.server.config.MAX_UPLOAD_BYTES) {
        return reply.code(413).send({ error: 'FILE_TOO_LARGE' });
      }
      const filename = cleanFilename(parsed.data.filename);
      if (!filename) return reply.code(400).send({ error: 'INVALID_FILENAME' });
      const result = await pool.query<{ id: string }>(
        `INSERT INTO attachment
           (instance_id, uploaded_by, original_filename, declared_mime,
            expected_size, client_mutation_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (instance_id, client_mutation_id) DO UPDATE
           SET client_mutation_id = EXCLUDED.client_mutation_id
           WHERE attachment.uploaded_by = EXCLUDED.uploaded_by
             AND attachment.original_filename = EXCLUDED.original_filename
             AND attachment.expected_size = EXCLUDED.expected_size
         RETURNING id`,
        [
          request.session!.instanceId,
          request.session!.id,
          filename,
          parsed.data.contentType,
          parsed.data.size,
          parsed.data.clientMutationId,
        ],
      );
      const uploadId = result.rows[0]?.id;
      if (!uploadId) return reply.code(409).send({ error: 'UPLOAD_CONFLICT' });
      return reply.code(201).send({ uploadId });
    },
  );

  app.put(
    '/api/v1/chat/uploads/:id/content',
    {
      bodyLimit: 1_073_742_848,
      preHandler: [requireSession, requireCsrf],
      config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      if (!(await requireChatModule(request, reply, pool))) return;
      const id = idSchema.safeParse((request.params as { id?: string }).id);
      if (!id.success || !(request.body instanceof Readable)) {
        return reply.code(400).send({ error: 'INVALID_UPLOAD' });
      }
      const claimed = await pool.query<{
        storageKey: string;
        expectedSize: number;
        declaredMime: string;
      }>(
        `UPDATE attachment SET status = 'UPLOADING'
         WHERE id = $1 AND instance_id = $2 AND uploaded_by = $3 AND status = 'PENDING'
         RETURNING storage_key AS "storageKey", expected_size AS "expectedSize",
                   declared_mime AS "declaredMime"`,
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
            actualSize > request.server.config.MAX_UPLOAD_BYTES
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
        if (reason === 'FILE_TOO_LARGE') return reply.code(413).send({ error: reason });
        if (reason === 'FILE_SIZE_MISMATCH' || reason === 'FILE_TYPE_NOT_ALLOWED') {
          return reply.code(400).send({ error: reason });
        }
        throw error;
      }
    },
  );

  app.post(
    '/api/v1/chat/uploads/:id/complete',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireChatModule(request, reply, pool))) return;
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
      if (!(await requireChatModule(request, reply, pool))) return;
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
         JOIN message_attachment ma ON ma.attachment_id = a.id
         JOIN message m ON m.id = ma.message_id
         JOIN conversation_member cm ON cm.conversation_id = m.conversation_id
         WHERE a.id = $1 AND a.instance_id = $2 AND a.status = 'READY'
           AND m.deleted_at IS NULL AND cm.member_id = $3`,
        [id.data, request.session!.instanceId, request.session!.id],
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
