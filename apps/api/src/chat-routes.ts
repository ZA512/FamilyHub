import {
  chatMessageCreateSchema,
  chatMessagesQuerySchema,
  chatReactionUpdateSchema,
  conversationCreateSchema,
  conversationMuteUpdateSchema,
  type ChatMessage,
  type ChatRealtimeEvent,
  type ConversationSummary,
} from '@familyhub/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import type WebSocket from 'ws';
import { z } from 'zod';

import { createSessionGuard, requireCsrf } from './auth.js';

const idSchema = z.string().uuid();
const socketsByMember = new Map<string, Set<WebSocket>>();

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

function publish(memberIds: string[], event: ChatRealtimeEvent): void {
  const payload = JSON.stringify(event);
  for (const memberId of memberIds) {
    for (const socket of socketsByMember.get(memberId) ?? []) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }
}

async function participantIds(
  client: Pool | PoolClient,
  conversationId: string,
): Promise<string[]> {
  const result = await client.query<{ memberId: string }>(
    `SELECT member_id AS "memberId" FROM conversation_member WHERE conversation_id = $1`,
    [conversationId],
  );
  return result.rows.map((row) => row.memberId);
}

async function loadConversations(
  client: Pool | PoolClient,
  instanceId: string,
  memberId: string,
  conversationId?: string,
): Promise<ConversationSummary[]> {
  const result = await client.query<{
    id: string;
    type: 'DIRECT' | 'GROUP' | 'TOPIC';
    title: string | null;
    displayTitle: string;
    sourceGroupId: string | null;
    sourceGroupName: string | null;
    createdBy: string;
    participants: Array<{ memberId: string; memberName: string }>;
    lastMessage: string | null;
    lastMessageAt: Date | null;
    unreadCount: number;
    muted: boolean;
    createdAt: Date;
  }>(
    `SELECT c.id, c.type, c.title,
            CASE WHEN c.type = 'DIRECT' THEN
              COALESCE((
                SELECT string_agg(u.first_name, ', ' ORDER BY lower(u.first_name))
                FROM conversation_member other_cm
                JOIN instance_member other_im ON other_im.id = other_cm.member_id
                JOIN app_user u ON u.id = other_im.user_id
                WHERE other_cm.conversation_id = c.id AND other_cm.member_id <> $2
              ), 'Conversation')
              ELSE c.title
            END AS "displayTitle",
            c.source_group_id AS "sourceGroupId",
            source_group.name AS "sourceGroupName",
            c.created_by AS "createdBy",
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'memberId', participant_cm.member_id,
                'memberName', participant_user.first_name
              ) ORDER BY lower(participant_user.first_name))
              FROM conversation_member participant_cm
              JOIN instance_member participant_im ON participant_im.id = participant_cm.member_id
              JOIN app_user participant_user ON participant_user.id = participant_im.user_id
              WHERE participant_cm.conversation_id = c.id
            ), '[]'::jsonb) AS participants,
            last_message.preview AS "lastMessage", last_message.created_at AS "lastMessageAt",
            (SELECT count(*)::int FROM message unread
             WHERE unread.conversation_id = c.id AND unread.author_id <> $2
               AND unread.deleted_at IS NULL
               AND unread.created_at > COALESCE(mine.last_read_at, mine.joined_at)) AS "unreadCount",
            mine.muted, c.created_at AS "createdAt"
     FROM conversation c
     JOIN conversation_member mine ON mine.conversation_id = c.id AND mine.member_id = $2
     LEFT JOIN member_group source_group ON source_group.id = c.source_group_id
     LEFT JOIN LATERAL (
       SELECT CASE WHEN lm.deleted_at IS NOT NULL THEN 'Message supprimé' ELSE COALESCE(
                NULLIF(lm.body, ''),
                concat('📎 ', (SELECT count(*) FROM message_attachment WHERE message_id = lm.id),
                       ' pièce(s) jointe(s)')
              ) END AS preview,
              lm.created_at
       FROM message lm
       WHERE lm.conversation_id = c.id ORDER BY lm.created_at DESC, lm.id DESC LIMIT 1
     ) last_message ON true
     WHERE c.instance_id = $1 AND c.deleted_at IS NULL${conversationId ? ' AND c.id = $3' : ''}
     ORDER BY COALESCE(last_message.created_at, c.updated_at) DESC, c.id DESC`,
    conversationId ? [instanceId, memberId, conversationId] : [instanceId, memberId],
  );
  return result.rows.map((row) => ({
    ...row,
    title: row.title ?? '',
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

async function loadMessage(
  client: Pool | PoolClient,
  conversationId: string,
  messageId: string,
): Promise<ChatMessage | null> {
  const result = await client.query<{
    id: string;
    conversationId: string;
    authorId: string;
    authorName: string;
    body: string;
    replyTo: ChatMessage['replyTo'];
    reactions: ChatMessage['reactions'];
    attachments: ChatMessage['attachments'];
    createdAt: Date;
    deletedAt: Date | null;
  }>(
    `SELECT m.id, m.conversation_id AS "conversationId", m.author_id AS "authorId",
            author.first_name AS "authorName",
            CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END AS body,
            CASE WHEN parent.id IS NULL THEN NULL ELSE jsonb_build_object(
              'id', parent.id, 'authorName', parent_author.first_name,
              'body', CASE WHEN parent.deleted_at IS NOT NULL THEN 'Message supprimé'
                           ELSE COALESCE(NULLIF(parent.body, ''), 'Pièce jointe') END
            ) END AS "replyTo",
            CASE WHEN m.deleted_at IS NULL THEN COALESCE((
              SELECT jsonb_agg(reaction_group ORDER BY reaction_group->>'emoji')
              FROM (
                SELECT jsonb_build_object(
                  'emoji', mr.emoji, 'count', count(*)::int,
                  'memberIds', jsonb_agg(mr.member_id ORDER BY mr.member_id)
                ) AS reaction_group
                FROM message_reaction mr WHERE mr.message_id = m.id GROUP BY mr.emoji
              ) grouped
            ), '[]'::jsonb) ELSE '[]'::jsonb END AS reactions,
            CASE WHEN m.deleted_at IS NULL THEN COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', a.id,
                'filename', a.original_filename,
                'contentType', a.detected_mime,
                'size', a.actual_size,
                'sha256', a.sha256,
                'kind', CASE WHEN a.detected_mime LIKE 'image/%' THEN 'image' ELSE 'file' END,
                'url', concat('/api/v1/attachments/', a.id, '/content')
              ) ORDER BY ma.sort_order, a.created_at)
              FROM message_attachment ma
              JOIN attachment a ON a.id = ma.attachment_id
              WHERE ma.message_id = m.id AND a.status = 'READY'
            ), '[]'::jsonb) ELSE '[]'::jsonb END AS attachments,
            m.created_at AS "createdAt", m.deleted_at AS "deletedAt"
     FROM message m
     JOIN instance_member author_member ON author_member.id = m.author_id
     JOIN app_user author ON author.id = author_member.user_id
     LEFT JOIN message parent ON parent.id = m.reply_to_id
     LEFT JOIN instance_member parent_member ON parent_member.id = parent.author_id
     LEFT JOIN app_user parent_author ON parent_author.id = parent_member.user_id
     WHERE m.conversation_id = $1 AND m.id = $2`,
    [conversationId, messageId],
  );
  const row = result.rows[0];
  return row
    ? {
        ...row,
        createdAt: row.createdAt.toISOString(),
        deletedAt: row.deletedAt?.toISOString() ?? null,
      }
    : null;
}

async function isMember(
  client: Pool | PoolClient,
  conversationId: string,
  memberId: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM conversation c
     JOIN conversation_member cm ON cm.conversation_id = c.id
     WHERE c.id = $1 AND cm.member_id = $2 AND c.deleted_at IS NULL`,
    [conversationId, memberId],
  );
  return Boolean(result.rowCount);
}

export async function registerChatRoutes(app: FastifyInstance, pool: Pool) {
  const requireSession = createSessionGuard(pool);

  app.get(
    '/ws',
    {
      websocket: true,
      preHandler: [
        requireSession,
        async (request, reply) => {
          const origin = request.headers.origin;
          if (origin && origin !== request.server.config.FAMILYHUB_ORIGIN) {
            return reply.code(403).send({ error: 'ORIGIN_NOT_ALLOWED' });
          }
          await requireChatModule(request, reply, pool);
        },
      ],
    },
    (socket, request) => {
      const memberId = request.session!.id;
      const memberSockets = socketsByMember.get(memberId) ?? new Set<WebSocket>();
      memberSockets.add(socket);
      socketsByMember.set(memberId, memberSockets);
      socket.on('close', () => {
        memberSockets.delete(socket);
        if (!memberSockets.size) socketsByMember.delete(memberId);
      });
      socket.on('error', () => memberSockets.delete(socket));
    },
  );

  app.get('/api/v1/conversations', { preHandler: requireSession }, async (request, reply) => {
    if (!(await requireChatModule(request, reply, pool))) return;
    return loadConversations(pool, request.session!.instanceId, request.session!.id);
  });

  app.post(
    '/api/v1/conversations',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireChatModule(request, reply, pool))) return;
      const parsed = conversationCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'INVALID_REQUEST', details: parsed.error.flatten() });
      }
      const session = request.session!;
      const ids = [...new Set([session.id, ...parsed.data.participantIds])].sort();
      if (parsed.data.type === 'DIRECT' && ids.length !== 2) {
        return reply.code(400).send({ error: 'DIRECT_REQUIRES_TWO_MEMBERS' });
      }
      if (parsed.data.type !== 'DIRECT' && !parsed.data.title) {
        return reply.code(400).send({ error: 'TITLE_REQUIRED' });
      }
      const active = await pool.query<{ id: string }>(
        `SELECT id FROM instance_member
         WHERE instance_id = $1 AND status = 'ACTIVE' AND id = ANY($2::uuid[])`,
        [session.instanceId, ids],
      );
      if (active.rowCount !== ids.length) {
        return reply.code(400).send({ error: 'INVALID_PARTICIPANTS' });
      }
      if (parsed.data.sourceGroupId) {
        const sourceGroup = await pool.query<{ memberIds: string[] }>(
          `SELECT COALESCE(
                    array_agg(member.id ORDER BY member.id)
                      FILTER (WHERE member.id IS NOT NULL),
                    '{}'
                  ) AS "memberIds"
           FROM member_group source_group
           JOIN group_membership creator_membership
             ON creator_membership.group_id = source_group.id
            AND creator_membership.member_id = $3
           LEFT JOIN group_membership membership
             ON membership.group_id = source_group.id
           LEFT JOIN instance_member member
             ON member.id = membership.member_id AND member.status = 'ACTIVE'
           WHERE source_group.instance_id = $1 AND source_group.id = $2
           GROUP BY source_group.id`,
          [session.instanceId, parsed.data.sourceGroupId, session.id],
        );
        if (!sourceGroup.rowCount) {
          return reply.code(400).send({ error: 'INVALID_SOURCE_GROUP' });
        }
        const currentGroupMemberIds = sourceGroup.rows[0]!.memberIds;
        const expectedMemberIds = new Set(ids);
        if (
          currentGroupMemberIds.length !== ids.length ||
          currentGroupMemberIds.some((id) => !expectedMemberIds.has(id))
        ) {
          return reply.code(409).send({ error: 'SOURCE_GROUP_MEMBERS_CHANGED' });
        }
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const directKey = parsed.data.type === 'DIRECT' ? ids.join(':') : null;
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO conversation
             (instance_id, type, title, direct_key, source_group_id, created_by, client_mutation_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (instance_id, client_mutation_id) DO NOTHING
           RETURNING id`,
          [
            session.instanceId,
            parsed.data.type,
            parsed.data.type === 'DIRECT' ? null : parsed.data.title,
            directKey,
            parsed.data.sourceGroupId ?? null,
            session.id,
            parsed.data.clientMutationId,
          ],
        );
        let conversationId = inserted.rows[0]?.id;
        if (!conversationId) {
          const existing = await client.query<{ id: string }>(
            `SELECT id FROM conversation
             WHERE instance_id = $1 AND client_mutation_id = $2 AND deleted_at IS NULL`,
            [session.instanceId, parsed.data.clientMutationId],
          );
          conversationId = existing.rows[0]?.id;
        }
        if (!conversationId && directKey) {
          const existing = await client.query<{ id: string }>(
            `SELECT id FROM conversation
             WHERE instance_id = $1 AND direct_key = $2 AND deleted_at IS NULL`,
            [session.instanceId, directKey],
          );
          conversationId = existing.rows[0]?.id;
        }
        if (!conversationId) throw new Error('Conversation creation returned no row.');
        await client.query(
          `INSERT INTO conversation_member (conversation_id, member_id, last_read_at)
           SELECT $1, member_id, now() FROM unnest($2::uuid[]) AS participant(member_id)
           ON CONFLICT DO NOTHING`,
          [conversationId, ids],
        );
        await client.query('COMMIT');
        const conversation = (
          await loadConversations(pool, session.instanceId, session.id, conversationId)
        )[0];
        if (!conversation) throw new Error('Conversation is not readable after creation.');
        for (const participantId of ids) {
          const participantConversation = (
            await loadConversations(pool, session.instanceId, participantId, conversationId)
          )[0];
          if (participantConversation) {
            publish([participantId], {
              type: 'chat.conversation',
              conversation: participantConversation,
            });
          }
        }
        return reply.code(inserted.rowCount ? 201 : 200).send(conversation);
      } catch (error) {
        await client.query('ROLLBACK');
        if ((error as { code?: string }).code === '23505' && parsed.data.type === 'DIRECT') {
          const existing = await pool.query<{ id: string }>(
            `SELECT id FROM conversation
             WHERE instance_id = $1 AND direct_key = $2 AND deleted_at IS NULL`,
            [session.instanceId, ids.join(':')],
          );
          const conversation = existing.rows[0]
            ? (
                await loadConversations(pool, session.instanceId, session.id, existing.rows[0].id)
              )[0]
            : undefined;
          if (conversation) return reply.send(conversation);
        }
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.get(
    '/api/v1/conversations/:id/messages',
    { preHandler: requireSession },
    async (request, reply) => {
      if (!(await requireChatModule(request, reply, pool))) return;
      const id = idSchema.safeParse((request.params as { id?: string }).id);
      const query = chatMessagesQuerySchema.safeParse(request.query);
      if (!id.success || !query.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      if (!(await isMember(pool, id.data, request.session!.id))) {
        return reply.code(404).send({ error: 'CONVERSATION_NOT_FOUND' });
      }
      const rows = await pool.query<{ id: string }>(
        `SELECT id FROM message WHERE conversation_id = $1
         ${query.data.before ? 'AND (created_at, id) < ($3::timestamptz, $4::uuid)' : ''}
         ORDER BY created_at DESC, id DESC LIMIT $2`,
        query.data.before
          ? [id.data, query.data.limit, query.data.before, query.data.beforeId]
          : [id.data, query.data.limit],
      );
      const messages = await Promise.all(
        rows.rows.reverse().map((row) => loadMessage(pool, id.data, row.id)),
      );
      return messages.filter((message): message is ChatMessage => Boolean(message));
    },
  );

  app.post(
    '/api/v1/conversations/:id/messages',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireChatModule(request, reply, pool))) return;
      const id = idSchema.safeParse((request.params as { id?: string }).id);
      const parsed = chatMessageCreateSchema.safeParse(request.body);
      if (!id.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const session = request.session!;
      const attachmentIds = [...new Set(parsed.data.attachmentIds)];
      if (!(await isMember(pool, id.data, session.id))) {
        return reply.code(404).send({ error: 'CONVERSATION_NOT_FOUND' });
      }
      if (parsed.data.replyToId) {
        const parent = await pool.query(
          'SELECT 1 FROM message WHERE id = $1 AND conversation_id = $2',
          [parsed.data.replyToId, id.data],
        );
        if (!parent.rowCount) return reply.code(400).send({ error: 'INVALID_REPLY_TARGET' });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO message (conversation_id, author_id, body, reply_to_id, client_mutation_id)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (conversation_id, client_mutation_id) DO NOTHING RETURNING id`,
          [
            id.data,
            session.id,
            parsed.data.body,
            parsed.data.replyToId ?? null,
            parsed.data.clientMutationId,
          ],
        );
        let messageId = inserted.rows[0]?.id;
        if (!messageId) {
          const existing = await client.query<{ id: string }>(
            'SELECT id FROM message WHERE conversation_id = $1 AND client_mutation_id = $2',
            [id.data, parsed.data.clientMutationId],
          );
          messageId = existing.rows[0]?.id;
        }
        if (!messageId) throw new Error('Message creation returned no row.');
        if (attachmentIds.length) {
          const allowedAttachments = await client.query<{ id: string }>(
            `SELECT a.id
             FROM attachment a
             LEFT JOIN message_attachment ma ON ma.attachment_id = a.id
             WHERE a.id = ANY($1::uuid[]) AND a.instance_id = $2 AND a.uploaded_by = $3
               AND a.status = 'READY' AND a.upload_purpose = 'RESOURCE'
               AND (ma.attachment_id IS NULL OR ma.message_id = $4)`,
            [attachmentIds, session.instanceId, session.id, messageId],
          );
          if (allowedAttachments.rowCount !== attachmentIds.length) {
            await client.query('ROLLBACK');
            return reply.code(400).send({ error: 'INVALID_ATTACHMENTS' });
          }
          await client.query(
            `INSERT INTO message_attachment (message_id, attachment_id, sort_order)
             SELECT $1, attachment_id, sort_order::int
             FROM unnest($2::uuid[]) WITH ORDINALITY AS selected(attachment_id, sort_order)
             ON CONFLICT DO NOTHING`,
            [messageId, attachmentIds],
          );
        }
        await client.query('UPDATE conversation SET updated_at = now() WHERE id = $1', [id.data]);
        await client.query(
          `UPDATE conversation_member SET last_read_at = now()
           WHERE conversation_id = $1 AND member_id = $2`,
          [id.data, session.id],
        );
        if (inserted.rowCount) {
          await client.query(
            `INSERT INTO notification
               (instance_id, recipient_member_id, actor_member_id, type, module_key,
                title, body, resource_type, resource_id)
             SELECT $1, cm.member_id, $2, 'CHAT_MESSAGE', 'chat', $3, $4, 'message', $5
             FROM conversation_member cm
             WHERE cm.conversation_id = $6 AND cm.member_id <> $2 AND cm.muted = false`,
            [
              session.instanceId,
              session.id,
              `Message de ${session.firstName}`,
              parsed.data.body.slice(0, 180) || 'Pièce jointe',
              messageId,
              id.data,
            ],
          );
        }
        await client.query('COMMIT');
        const message = await loadMessage(pool, id.data, messageId);
        if (!message) throw new Error('Message is not readable after creation.');
        publish(await participantIds(pool, id.data), {
          type: 'chat.message',
          conversationId: id.data,
          message,
        });
        return reply.code(inserted.rowCount ? 201 : 200).send(message);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.post(
    '/api/v1/messages/:id/reactions',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireChatModule(request, reply, pool))) return;
      const id = idSchema.safeParse((request.params as { id?: string }).id);
      const parsed = chatReactionUpdateSchema.safeParse(request.body);
      if (!id.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const found = await pool.query<{ conversationId: string }>(
        `SELECT m.conversation_id AS "conversationId" FROM message m
         JOIN conversation_member cm ON cm.conversation_id = m.conversation_id
         WHERE m.id = $1 AND m.deleted_at IS NULL AND cm.member_id = $2`,
        [id.data, request.session!.id],
      );
      const conversationId = found.rows[0]?.conversationId;
      if (!conversationId) return reply.code(404).send({ error: 'MESSAGE_NOT_FOUND' });
      const removed = await pool.query(
        `DELETE FROM message_reaction WHERE message_id = $1 AND member_id = $2 AND emoji = $3`,
        [id.data, request.session!.id, parsed.data.emoji],
      );
      if (!removed.rowCount) {
        await pool.query(
          `INSERT INTO message_reaction (message_id, member_id, emoji) VALUES ($1, $2, $3)`,
          [id.data, request.session!.id, parsed.data.emoji],
        );
      }
      const message = await loadMessage(pool, conversationId, id.data);
      if (!message) return reply.code(404).send({ error: 'MESSAGE_NOT_FOUND' });
      publish(await participantIds(pool, conversationId), {
        type: 'chat.reaction',
        conversationId,
        message,
      });
      return message;
    },
  );

  app.delete(
    '/api/v1/messages/:id',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireChatModule(request, reply, pool))) return;
      const id = idSchema.safeParse((request.params as { id?: string }).id);
      if (!id.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const session = request.session!;
      const found = await pool.query<{
        conversationId: string;
        authorId: string;
        deletedAt: Date | null;
      }>(
        `SELECT m.conversation_id AS "conversationId", m.author_id AS "authorId",
                m.deleted_at AS "deletedAt"
         FROM message m
         JOIN conversation c ON c.id = m.conversation_id AND c.deleted_at IS NULL
         JOIN conversation_member cm ON cm.conversation_id = m.conversation_id
         WHERE m.id = $1 AND cm.member_id = $2`,
        [id.data, session.id],
      );
      const existing = found.rows[0];
      if (!existing) return reply.code(404).send({ error: 'MESSAGE_NOT_FOUND' });
      if (existing.authorId !== session.id) {
        return reply.code(403).send({ error: 'MESSAGE_NOT_OWNED' });
      }
      if (!existing.deletedAt) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            `UPDATE message SET deleted_at = now(), deleted_by = $2
             WHERE id = $1 AND deleted_at IS NULL`,
            [id.data, session.id],
          );
          await client.query(
            `UPDATE notification SET body = 'Message supprimé'
             WHERE resource_type = 'message' AND resource_id = $1`,
            [id.data],
          );
          await client.query('UPDATE conversation SET updated_at = now() WHERE id = $1', [
            existing.conversationId,
          ]);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      }
      const message = await loadMessage(pool, existing.conversationId, id.data);
      if (!message) return reply.code(404).send({ error: 'MESSAGE_NOT_FOUND' });
      publish(await participantIds(pool, existing.conversationId), {
        type: 'chat.message.deleted',
        conversationId: existing.conversationId,
        message,
      });
      return message;
    },
  );

  app.patch(
    '/api/v1/conversations/:id/mute',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireChatModule(request, reply, pool))) return;
      const id = idSchema.safeParse((request.params as { id?: string }).id);
      const parsed = conversationMuteUpdateSchema.safeParse(request.body);
      if (!id.success || !parsed.success) {
        return reply.code(400).send({ error: 'INVALID_REQUEST' });
      }
      const result = await pool.query(
        `UPDATE conversation_member cm
         SET muted = $3
         FROM conversation c
         WHERE cm.conversation_id = $1 AND cm.member_id = $2
           AND c.id = cm.conversation_id AND c.deleted_at IS NULL
         RETURNING cm.member_id`,
        [id.data, request.session!.id, parsed.data.muted],
      );
      if (!result.rowCount) {
        return reply.code(404).send({ error: 'CONVERSATION_NOT_FOUND' });
      }
      return { muted: parsed.data.muted };
    },
  );

  app.patch(
    '/api/v1/conversations/:id/read',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireChatModule(request, reply, pool))) return;
      const id = idSchema.safeParse((request.params as { id?: string }).id);
      if (!id.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const result = await pool.query(
        `UPDATE conversation_member SET last_read_at = now()
         WHERE conversation_id = $1 AND member_id = $2`,
        [id.data, request.session!.id],
      );
      if (!result.rowCount) return reply.code(404).send({ error: 'CONVERSATION_NOT_FOUND' });
      return reply.code(204).send();
    },
  );
}
