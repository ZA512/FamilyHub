import {
  pollCreateSchema,
  pollsQuerySchema,
  pollVoteSchema,
  type FamilyPoll,
  type FamilyPollOption,
  type PollVisibility,
} from '@familyhub/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import { createSessionGuard, requireCsrf } from './auth.js';

const idSchema = z.string().uuid();

type PollRow = {
  id: string;
  question: string;
  description: string | null;
  allowMultiple: boolean;
  anonymous: boolean;
  endsAt: Date | null;
  visibility: PollVisibility;
  groupIds: string[];
  memberIds: string[];
  voterCount: number;
  hasVoted: boolean;
  createdBy: string;
  createdByName: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

type OptionRow = {
  id: string;
  label: string;
  position: number;
  voteCount: number;
  selectedByMe: boolean;
  voterNames: string[];
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

const selectPoll = `
  SELECT p.id, p.question, p.description,
         p.allow_multiple AS "allowMultiple", p.anonymous, p.ends_at AS "endsAt",
         r.visibility,
         CASE WHEN r.created_by = $2 THEN COALESCE(ARRAY(
           SELECT rag.group_id FROM resource_acl_group rag WHERE rag.resource_id = p.id
         ), '{}') ELSE '{}' END AS "groupIds",
         CASE WHEN r.created_by = $2 THEN COALESCE(ARRAY(
           SELECT rau.member_id FROM resource_acl_user rau WHERE rau.resource_id = p.id
         ), '{}') ELSE '{}' END AS "memberIds",
         (SELECT count(DISTINCT pv.member_id)::int FROM poll_vote pv
          JOIN poll_option po ON po.id = pv.option_id WHERE po.poll_id = p.id) AS "voterCount",
         EXISTS (SELECT 1 FROM poll_vote pv JOIN poll_option po ON po.id = pv.option_id
                 WHERE po.poll_id = p.id AND pv.member_id = $2) AS "hasVoted",
         r.created_by AS "createdBy", creator.first_name AS "createdByName",
         p.version, p.created_at AS "createdAt", p.updated_at AS "updatedAt"
  FROM poll p
  JOIN resource r ON r.id = p.id
  JOIN instance_member creator_member ON creator_member.id = r.created_by
  JOIN app_user creator ON creator.id = creator_member.user_id
`;

async function requirePollsModule(
  request: FastifyRequest,
  reply: FastifyReply,
  pool: Pool,
): Promise<boolean> {
  if (!request.session) return false;
  const result = await pool.query(
    `SELECT 1 FROM module_config
     WHERE instance_id = $1 AND module_key = 'polls' AND enabled = true`,
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
  visibility: PollVisibility,
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
  pollId: string,
  visibility: PollVisibility,
  groupIds: string[],
  memberIds: string[],
): Promise<void> {
  if (visibility === 'GROUPS') {
    await client.query(
      `INSERT INTO resource_acl_group (resource_id, group_id)
       SELECT $1, id FROM unnest($2::uuid[]) AS selected(id) ON CONFLICT DO NOTHING`,
      [pollId, [...new Set(groupIds)]],
    );
  }
  if (visibility === 'SELECTED_USERS') {
    await client.query(
      `INSERT INTO resource_acl_user (resource_id, member_id)
       SELECT $1, id FROM unnest($2::uuid[]) AS selected(id) ON CONFLICT DO NOTHING`,
      [pollId, [...new Set(memberIds)]],
    );
  }
}

async function loadOptions(
  client: Pool | PoolClient,
  pollId: string,
  memberId: string,
  anonymous: boolean,
  voterCount: number,
): Promise<FamilyPollOption[]> {
  const result = await client.query<OptionRow>(
    `SELECT po.id, po.label, po.position,
            count(pv.member_id)::int AS "voteCount",
            bool_or(pv.member_id = $2) AS "selectedByMe",
            COALESCE(array_agg(DISTINCT voter.first_name ORDER BY voter.first_name)
              FILTER (WHERE voter.first_name IS NOT NULL), '{}') AS "voterNames"
     FROM poll_option po
     LEFT JOIN poll_vote pv ON pv.option_id = po.id
     LEFT JOIN instance_member voter_member ON voter_member.id = pv.member_id
     LEFT JOIN app_user voter ON voter.id = voter_member.user_id
     WHERE po.poll_id = $1
     GROUP BY po.id, po.label, po.position
     ORDER BY po.position`,
    [pollId, memberId],
  );
  return result.rows.map((option) => ({
    ...option,
    selectedByMe: option.selectedByMe ?? false,
    percentage: voterCount ? Math.round((option.voteCount / voterCount) * 100) : 0,
    voterNames: anonymous ? null : option.voterNames,
  }));
}

async function serializePoll(
  client: Pool | PoolClient,
  row: PollRow,
  memberId: string,
): Promise<FamilyPoll> {
  return {
    ...row,
    endsAt: row.endsAt?.toISOString() ?? null,
    ended: Boolean(row.endsAt && row.endsAt.getTime() <= Date.now()),
    options: await loadOptions(client, row.id, memberId, row.anonymous, row.voterCount),
    editable: row.createdBy === memberId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadPoll(
  client: Pool | PoolClient,
  pollId: string,
  instanceId: string,
  memberId: string,
): Promise<FamilyPoll | null> {
  const result = await client.query<PollRow>(
    `${selectPoll} WHERE p.id = $3 AND ${readableResource}`,
    [instanceId, memberId, pollId],
  );
  return result.rows[0] ? serializePoll(client, result.rows[0], memberId) : null;
}

async function notifyAudience(
  client: PoolClient,
  pollId: string,
  actorId: string,
  actorName: string,
  question: string,
): Promise<void> {
  await client.query(
    `INSERT INTO notification
       (instance_id, recipient_member_id, actor_member_id, type, module_key,
        title, body, resource_type, resource_id)
     SELECT r.instance_id, recipient.id, $2, 'POLL_SHARED', 'polls',
            'Nouveau sondage', concat($3::text, ' vous propose : « ', $4::text, ' »'),
            'poll', r.id
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
    [pollId, actorId, actorName, question],
  );
}

export async function registerPollRoutes(app: FastifyInstance, pool: Pool) {
  const requireSession = createSessionGuard(pool);

  app.get('/api/v1/polls', { preHandler: requireSession }, async (request, reply) => {
    if (!(await requirePollsModule(request, reply, pool))) return;
    const parsed = pollsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const session = request.session!;
    const { before, beforeId, limit, q, scope, status } = parsed.data;
    const result = await pool.query<PollRow>(
      `${selectPoll}
       WHERE ${readableResource}
         AND ($3 = 'all' OR ($3 = 'mine' AND r.created_by = $2)
              OR ($3 = 'shared' AND r.created_by <> $2))
         AND ($4 = 'all' OR ($4 = 'active' AND (p.ends_at IS NULL OR p.ends_at > now()))
              OR ($4 = 'ended' AND p.ends_at <= now()))
         AND ($5::text IS NULL OR concat_ws(' ', p.question, p.description, (
           SELECT string_agg(po.label, ' ') FROM poll_option po WHERE po.poll_id = p.id
         )) ILIKE concat('%', $5::text, '%'))
         AND ($6::timestamptz IS NULL OR (p.updated_at, p.id) < ($6::timestamptz, $7::uuid))
       ORDER BY p.updated_at DESC, p.id DESC LIMIT $8`,
      [
        session.instanceId,
        session.id,
        scope,
        status,
        q ?? null,
        before ?? null,
        beforeId ?? null,
        limit + 1,
      ],
    );
    const rows = result.rows.slice(0, limit);
    return {
      polls: await Promise.all(rows.map((row) => serializePoll(pool, row, session.id))),
      hasMore: result.rows.length > limit,
    };
  });

  app.get('/api/v1/polls/:id', { preHandler: requireSession }, async (request, reply) => {
    if (!(await requirePollsModule(request, reply, pool))) return;
    const id = idSchema.safeParse((request.params as { id?: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const session = request.session!;
    const poll = await loadPoll(pool, id.data, session.instanceId, session.id);
    if (!poll) return reply.code(404).send({ error: 'POLL_NOT_FOUND' });
    return { poll };
  });

  app.post(
    '/api/v1/polls',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requirePollsModule(request, reply, pool))) return;
      const parsed = pollCreateSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const session = request.session!;
      const existing = await pool.query<{ id: string }>(
        'SELECT id FROM poll WHERE instance_id = $1 AND client_mutation_id = $2',
        [session.instanceId, parsed.data.clientMutationId],
      );
      if (existing.rows[0]) {
        return { poll: await loadPoll(pool, existing.rows[0].id, session.instanceId, session.id) };
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
           VALUES ($1, 'poll', $2, $3) RETURNING id`,
          [session.instanceId, session.id, parsed.data.visibility],
        );
        const pollId = resource.rows[0]!.id;
        await client.query(
          `INSERT INTO poll
             (id, instance_id, question, description, allow_multiple, anonymous,
              ends_at, client_mutation_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            pollId,
            session.instanceId,
            parsed.data.question,
            parsed.data.description ?? null,
            parsed.data.allowMultiple,
            parsed.data.anonymous,
            parsed.data.endsAt ?? null,
            parsed.data.clientMutationId,
          ],
        );
        for (const [position, label] of parsed.data.options.entries()) {
          await client.query(
            'INSERT INTO poll_option (poll_id, position, label) VALUES ($1, $2, $3)',
            [pollId, position, label],
          );
        }
        await replaceAudience(
          client,
          pollId,
          parsed.data.visibility,
          parsed.data.groupIds,
          parsed.data.memberIds,
        );
        await notifyAudience(client, pollId, session.id, session.firstName, parsed.data.question);
        await client.query('COMMIT');
        return reply.code(201).send({
          poll: await loadPoll(pool, pollId, session.instanceId, session.id),
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.post(
    '/api/v1/polls/:id/votes',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requirePollsModule(request, reply, pool))) return;
      const id = idSchema.safeParse((request.params as { id?: string }).id);
      const parsed = pollVoteSchema.safeParse(request.body);
      if (!id.success || !parsed.success)
        return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const session = request.session!;
      if (!(await loadPoll(pool, id.data, session.instanceId, session.id))) {
        return reply.code(404).send({ error: 'POLL_NOT_FOUND' });
      }
      const optionIds = [...new Set(parsed.data.optionIds)];
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const locked = await client.query<{ allowMultiple: boolean; endsAt: Date | null }>(
          `SELECT allow_multiple AS "allowMultiple", ends_at AS "endsAt"
           FROM poll WHERE id = $1 AND instance_id = $2 FOR UPDATE`,
          [id.data, session.instanceId],
        );
        const poll = locked.rows[0];
        if (!poll) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'POLL_NOT_FOUND' });
        }
        if (poll.endsAt && poll.endsAt.getTime() <= Date.now()) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'POLL_ENDED' });
        }
        if (!poll.allowMultiple && optionIds.length !== 1) {
          await client.query('ROLLBACK');
          return reply.code(400).send({ error: 'SINGLE_CHOICE_REQUIRED' });
        }
        const options = await client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM poll_option
           WHERE poll_id = $1 AND id = ANY($2::uuid[])`,
          [id.data, optionIds],
        );
        if (options.rows[0]?.count !== optionIds.length) {
          await client.query('ROLLBACK');
          return reply.code(400).send({ error: 'INVALID_POLL_OPTION' });
        }
        await client.query(
          `DELETE FROM poll_vote pv USING poll_option po
           WHERE pv.option_id = po.id AND po.poll_id = $1 AND pv.member_id = $2`,
          [id.data, session.id],
        );
        await client.query(
          `INSERT INTO poll_vote (option_id, member_id)
           SELECT option_id, $2 FROM unnest($1::uuid[]) AS selected(option_id)`,
          [optionIds, session.id],
        );
        await client.query('UPDATE poll SET updated_at = now() WHERE id = $1', [id.data]);
        await client.query('UPDATE resource SET updated_at = now() WHERE id = $1', [id.data]);
        await client.query('COMMIT');
        return { poll: await loadPoll(pool, id.data, session.instanceId, session.id) };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.delete(
    '/api/v1/polls/:id',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requirePollsModule(request, reply, pool))) return;
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
          return reply.code(404).send({ error: 'POLL_NOT_FOUND' });
        }
        await client.query(
          `DELETE FROM notification WHERE resource_type = 'poll' AND resource_id = $1`,
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
