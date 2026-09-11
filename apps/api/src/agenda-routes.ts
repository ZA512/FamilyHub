import {
  agendaEventCreateSchema,
  agendaEventUpdateSchema,
  agendaRangeSchema,
  agendaResponseUpdateSchema,
  type AgendaEntry,
  type AgendaEventType,
  type AgendaParticipant,
  type AgendaRecurrence,
  type AgendaResponse,
} from '@familyhub/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import rrule from 'rrule';
import { z } from 'zod';

import { createSessionGuard, requireCsrf } from './auth.js';

const { RRule } = rrule;

const eventIdSchema = z.string().uuid();

type EventRow = {
  id: string;
  title: string;
  description: string | null;
  eventType: AgendaEventType;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  location: string | null;
  recurrence: AgendaRecurrence;
  recurrenceInterval: number;
  recurrenceUntil: Date | null;
  recurrenceTimezone: string;
  reminderMinutes: number | null;
  visibility: 'PRIVATE' | 'ALL_MEMBERS';
  createdBy: string;
  createdByName: string;
  version: number;
};

type ParticipantRow = {
  eventId: string;
  memberId: string;
  memberName: string;
  response: AgendaResponse;
};

type TaskProjectionRow = {
  id: string;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date | null;
  createdBy: string;
  createdByName: string;
  visibility: 'PRIVATE' | 'ALL_MEMBERS';
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
      SELECT 1
      FROM resource_acl_group rag
      JOIN group_membership gm ON gm.group_id = rag.group_id
      WHERE rag.resource_id = r.id AND gm.member_id = $2
    )
  )
`;

const selectEvent = `
  SELECT e.id, e.title, e.description, e.event_type AS "eventType",
         e.start_at AS "startAt", e.end_at AS "endAt", e.all_day AS "allDay",
         e.location, e.recurrence, e.recurrence_interval AS "recurrenceInterval",
         e.recurrence_until AS "recurrenceUntil",
         e.recurrence_timezone AS "recurrenceTimezone",
         e.reminder_minutes AS "reminderMinutes", r.visibility,
         r.created_by AS "createdBy", creator.first_name AS "createdByName",
         e.version
  FROM calendar_event e
  JOIN resource r ON r.id = e.id
  JOIN instance_member creator_member ON creator_member.id = r.created_by
  JOIN app_user creator ON creator.id = creator_member.user_id
`;

async function requireAgendaModule(
  request: FastifyRequest,
  reply: FastifyReply,
  pool: Pool,
): Promise<boolean> {
  if (!request.session) return false;
  const result = await pool.query(
    `SELECT 1 FROM module_config
     WHERE instance_id = $1 AND module_key = 'agenda' AND enabled = true`,
    [request.session.instanceId],
  );
  if (!result.rowCount) {
    await reply.code(404).send({ error: 'MODULE_NOT_AVAILABLE' });
    return false;
  }
  return true;
}

async function validateParticipants(
  client: Pool | PoolClient,
  instanceId: string,
  participantIds: string[],
): Promise<boolean> {
  const uniqueIds = [...new Set(participantIds)];
  if (!uniqueIds.length) return true;
  const result = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM instance_member
     WHERE instance_id = $1 AND status = 'ACTIVE' AND id = ANY($2::uuid[])`,
    [instanceId, uniqueIds],
  );
  return result.rows[0]?.count === uniqueIds.length;
}

async function loadParticipants(
  client: Pool | PoolClient,
  eventIds: string[],
): Promise<Map<string, AgendaParticipant[]>> {
  const byEvent = new Map<string, AgendaParticipant[]>();
  if (!eventIds.length) return byEvent;
  const result = await client.query<ParticipantRow>(
    `SELECT p.event_id AS "eventId", p.member_id AS "memberId",
            member.first_name AS "memberName", p.response
     FROM calendar_event_participant p
     JOIN instance_member im ON im.id = p.member_id
     JOIN app_user member ON member.id = im.user_id
     WHERE p.event_id = ANY($1::uuid[])
     ORDER BY lower(member.first_name)`,
    [eventIds],
  );
  for (const row of result.rows) {
    const entries = byEvent.get(row.eventId) ?? [];
    entries.push({ memberId: row.memberId, memberName: row.memberName, response: row.response });
    byEvent.set(row.eventId, entries);
  }
  return byEvent;
}

async function loadReadableEvent(
  client: Pool | PoolClient,
  eventId: string,
  instanceId: string,
  memberId: string,
  lock = false,
): Promise<EventRow | null> {
  const result = await client.query<EventRow>(
    `${selectEvent}
     WHERE e.id = $3 AND ${readableResource}
     ${lock ? 'FOR UPDATE OF e' : ''}`,
    [instanceId, memberId, eventId],
  );
  return result.rows[0] ?? null;
}

function frequency(recurrence: AgendaRecurrence): number {
  switch (recurrence) {
    case 'DAILY':
      return RRule.DAILY;
    case 'WEEKLY':
      return RRule.WEEKLY;
    case 'MONTHLY':
      return RRule.MONTHLY;
    case 'YEARLY':
      return RRule.YEARLY;
    default:
      throw new Error('A non-recurring event has no RRule frequency.');
  }
}

function rruleWallClock(date: Date, timezone: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(date)
    .reduce<Record<string, number>>((values, part) => {
      if (part.type !== 'literal') values[part.type] = Number(part.value);
      return values;
    }, {});
  return new Date(
    Date.UTC(
      parts.year ?? 1970,
      (parts.month ?? 1) - 1,
      parts.day ?? 1,
      parts.hour ?? 0,
      parts.minute ?? 0,
      parts.second ?? 0,
    ),
  );
}

function serializeOccurrence(
  event: EventRow,
  participants: AgendaParticipant[],
  startAt: Date,
  endAt: Date,
  memberId: string,
  role: 'ADMIN' | 'MEMBER',
  recurring: boolean,
): AgendaEntry {
  return {
    id: recurring ? `event:${event.id}:${startAt.toISOString()}` : `event:${event.id}`,
    resourceId: event.id,
    sourceType: 'event',
    title: event.title,
    description: event.description,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    seriesStartAt: event.startAt.toISOString(),
    seriesEndAt: event.endAt.toISOString(),
    allDay: event.allDay,
    location: event.location,
    eventType: event.eventType,
    visibility: event.visibility,
    createdBy: event.createdBy,
    createdByName: event.createdByName,
    editable: role === 'ADMIN' || event.createdBy === memberId,
    recurrence: event.recurrence,
    recurrenceInterval: event.recurrenceInterval,
    recurrenceUntil: event.recurrenceUntil?.toISOString() ?? null,
    reminderMinutes: event.reminderMinutes,
    participants,
  };
}

function expandEvent(
  event: EventRow,
  participants: AgendaParticipant[],
  rangeStart: Date,
  rangeEnd: Date,
  memberId: string,
  role: 'ADMIN' | 'MEMBER',
): AgendaEntry[] {
  const duration = event.endAt.getTime() - event.startAt.getTime();
  if (event.recurrence === 'NONE') {
    if (event.startAt >= rangeEnd || event.endAt <= rangeStart) return [];
    return [
      serializeOccurrence(
        event,
        participants,
        event.startAt,
        event.endAt,
        memberId,
        role,
        false,
      ),
    ];
  }

  const rule = new RRule({
    freq: frequency(event.recurrence),
    interval: event.recurrenceInterval,
    dtstart: rruleWallClock(event.startAt, event.recurrenceTimezone),
    until: event.recurrenceUntil
      ? rruleWallClock(event.recurrenceUntil, event.recurrenceTimezone)
      : null,
    tzid: event.recurrenceTimezone,
  });
  const searchStart = new Date(rangeStart.getTime() - duration);
  return rule
    .between(searchStart, rangeEnd, true)
    .map((occurrenceStart) => ({
      start: occurrenceStart,
      end: new Date(occurrenceStart.getTime() + duration),
    }))
    .filter((occurrence) => occurrence.start < rangeEnd && occurrence.end > rangeStart)
    .map((occurrence) =>
      serializeOccurrence(
        event,
        participants,
        occurrence.start,
        occurrence.end,
        memberId,
        role,
        true,
      ),
    );
}

async function writeParticipants(
  client: PoolClient,
  eventId: string,
  creatorId: string,
  participantIds: string[],
): Promise<void> {
  const ids = [...new Set([creatorId, ...participantIds])];
  for (const memberId of ids) {
    await client.query(
      `INSERT INTO calendar_event_participant (event_id, member_id, response, responded_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (event_id, member_id) DO NOTHING`,
      [eventId, memberId, memberId === creatorId ? 'YES' : 'PENDING', memberId === creatorId ? new Date() : null],
    );
  }
  await client.query(
    `UPDATE calendar_event_participant
     SET response = 'YES', responded_at = COALESCE(responded_at, now())
     WHERE event_id = $1 AND member_id = $2`,
    [eventId, creatorId],
  );
}

export async function registerAgendaRoutes(app: FastifyInstance, pool: Pool) {
  const requireSession = createSessionGuard(pool);

  app.get<{ Querystring: { start?: string; end?: string } }>(
    '/api/v1/agenda',
    { preHandler: requireSession },
    async (request, reply) => {
      if (!(await requireAgendaModule(request, reply, pool))) return;
      const range = agendaRangeSchema.safeParse(request.query);
      if (!range.success) return reply.code(400).send({ error: 'INVALID_RANGE' });
      const rangeStart = new Date(range.data.start);
      const rangeEnd = new Date(range.data.end);

      const events = await pool.query<EventRow>(
        `${selectEvent}
         WHERE ${readableResource}
           AND (
             (e.recurrence = 'NONE' AND e.start_at < $4 AND e.end_at > $3)
             OR (
               e.recurrence <> 'NONE' AND e.start_at < $4
               AND (e.recurrence_until IS NULL OR e.recurrence_until >= $3)
             )
           )`,
        [request.session!.instanceId, request.session!.id, rangeStart, rangeEnd],
      );
      const participantMap = await loadParticipants(
        pool,
        events.rows.map((event) => event.id),
      );
      const eventEntries = events.rows.flatMap((event) =>
        expandEvent(
          event,
          participantMap.get(event.id) ?? [],
          rangeStart,
          rangeEnd,
          request.session!.id,
          request.session!.role,
        ),
      );

      const tasks = await pool.query<TaskProjectionRow>(
        `SELECT t.id, t.title, t.description,
                COALESCE(t.due_at, t.period_start_at) AS "startAt",
                t.period_end_at AS "endAt", r.created_by AS "createdBy",
                creator.first_name AS "createdByName", r.visibility
         FROM family_task t
         JOIN resource r ON r.id = t.id
         JOIN instance_member creator_member ON creator_member.id = r.created_by
         JOIN app_user creator ON creator.id = creator_member.user_id
         WHERE ${readableResource}
           AND t.status IN ('OPEN', 'IN_PROGRESS')
           AND COALESCE(t.due_at, t.period_start_at) IS NOT NULL
           AND COALESCE(t.due_at, t.period_start_at) < $4
           AND COALESCE(t.period_end_at, t.due_at + interval '1 hour', t.period_start_at + interval '1 day') > $3
           AND EXISTS (
             SELECT 1 FROM module_config mc
             WHERE mc.instance_id = t.instance_id AND mc.module_key = 'tasks' AND mc.enabled = true
           )`,
        [request.session!.instanceId, request.session!.id, rangeStart, rangeEnd],
      );
      const taskEntries: AgendaEntry[] = tasks.rows.map((task) => ({
        id: `task:${task.id}`,
        resourceId: task.id,
        sourceType: 'task',
        title: task.title,
        description: task.description,
        startAt: task.startAt.toISOString(),
        endAt: task.endAt?.toISOString() ?? new Date(task.startAt.getTime() + 60 * 60 * 1000).toISOString(),
        seriesStartAt: task.startAt.toISOString(),
        seriesEndAt: task.endAt?.toISOString() ?? null,
        allDay: false,
        location: null,
        eventType: 'TASK',
        visibility: task.visibility,
        createdBy: task.createdBy,
        createdByName: task.createdByName,
        editable: false,
        recurrence: 'NONE',
        recurrenceInterval: 1,
        recurrenceUntil: null,
        reminderMinutes: null,
        participants: [],
      }));

      return { entries: [...eventEntries, ...taskEntries] };
    },
  );

  app.post(
    '/api/v1/agenda/events',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireAgendaModule(request, reply, pool))) return;
      const parsed = agendaEventCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'INVALID_REQUEST', details: parsed.error.flatten() });
      }
      const participantIds = [...new Set(parsed.data.participantIds)];
      if (
        parsed.data.visibility === 'PRIVATE' &&
        participantIds.some((id) => id !== request.session!.id)
      ) {
        return reply.code(400).send({ error: 'PRIVATE_EVENT_PARTICIPANTS_INVALID' });
      }
      if (!(await validateParticipants(pool, request.session!.instanceId, participantIds))) {
        return reply.code(400).send({ error: 'PARTICIPANT_INVALID' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM calendar_event WHERE instance_id = $1 AND client_mutation_id = $2`,
          [request.session!.instanceId, parsed.data.clientMutationId],
        );
        let eventId = existing.rows[0]?.id;
        if (!eventId) {
          const timezone = await client.query<{ timezone: string }>(
            'SELECT timezone FROM instance WHERE id = $1',
            [request.session!.instanceId],
          );
          const resource = await client.query<{ id: string }>(
            `INSERT INTO resource (id, instance_id, resource_type, created_by, visibility)
             VALUES ($1, $2, 'calendar_event', $3, $4) RETURNING id`,
            [
              parsed.data.clientMutationId,
              request.session!.instanceId,
              request.session!.id,
              parsed.data.visibility,
            ],
          );
          eventId = resource.rows[0]?.id;
          if (!eventId) throw new Error('Calendar resource creation returned no row.');
          await client.query(
            `INSERT INTO calendar_event
               (id, instance_id, title, description, event_type, start_at, end_at,
                all_day, location, recurrence, recurrence_interval, recurrence_until,
                recurrence_timezone, reminder_minutes, client_mutation_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            [
              eventId,
              request.session!.instanceId,
              parsed.data.title,
              parsed.data.description ?? null,
              parsed.data.eventType,
              new Date(parsed.data.startAt),
              new Date(parsed.data.endAt),
              parsed.data.allDay,
              parsed.data.location ?? null,
              parsed.data.recurrence,
              parsed.data.recurrenceInterval,
              parsed.data.recurrenceUntil ? new Date(parsed.data.recurrenceUntil) : null,
              timezone.rows[0]?.timezone ?? 'Europe/Paris',
              parsed.data.reminderMinutes ?? null,
              parsed.data.clientMutationId,
            ],
          );
          await writeParticipants(client, eventId, request.session!.id, participantIds);
          const recipients = participantIds.filter((id) => id !== request.session!.id);
          if (recipients.length) {
            await client.query(
              `INSERT INTO notification
                 (instance_id, recipient_member_id, actor_member_id, type, module_key,
                  title, body, resource_type, resource_id)
               SELECT $1, unnest($2::uuid[]), $3, 'AGENDA_INVITATION', 'agenda',
                      'Nouvel événement', $4, 'calendar_event', $5`,
              [
                request.session!.instanceId,
                recipients,
                request.session!.id,
                `${request.session!.firstName} vous invite : ${parsed.data.title}`,
                eventId,
              ],
            );
          }
        }

        const event = await loadReadableEvent(
          client,
          eventId,
          request.session!.instanceId,
          request.session!.id,
        );
        const participants = await loadParticipants(client, [eventId]);
        if (!event) throw new Error('Calendar event creation returned no readable row.');
        await client.query('COMMIT');
        return reply.code(201).send({
          event: serializeOccurrence(
            event,
            participants.get(eventId) ?? [],
            event.startAt,
            event.endAt,
            request.session!.id,
            request.session!.role,
            false,
          ),
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.put<{ Params: { id: string } }>(
    '/api/v1/agenda/events/:id',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireAgendaModule(request, reply, pool))) return;
      const eventId = eventIdSchema.safeParse(request.params.id);
      const parsed = agendaEventUpdateSchema.safeParse(request.body);
      if (!eventId.success) return reply.code(404).send({ error: 'EVENT_NOT_FOUND' });
      if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const participantIds = [...new Set(parsed.data.participantIds)];
      if (
        parsed.data.visibility === 'PRIVATE' &&
        participantIds.some((id) => id !== request.session!.id)
      ) {
        return reply.code(400).send({ error: 'PRIVATE_EVENT_PARTICIPANTS_INVALID' });
      }
      if (!(await validateParticipants(pool, request.session!.instanceId, participantIds))) {
        return reply.code(400).send({ error: 'PARTICIPANT_INVALID' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const event = await loadReadableEvent(
          client,
          eventId.data,
          request.session!.instanceId,
          request.session!.id,
          true,
        );
        if (!event) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'EVENT_NOT_FOUND' });
        }
        if (request.session!.role !== 'ADMIN' && event.createdBy !== request.session!.id) {
          await client.query('ROLLBACK');
          return reply.code(403).send({ error: 'EVENT_ACTION_FORBIDDEN' });
        }
        await client.query(
          `UPDATE calendar_event
           SET title = $1, description = $2, event_type = $3, start_at = $4, end_at = $5,
               all_day = $6, location = $7, recurrence = $8, recurrence_interval = $9,
               recurrence_until = $10, reminder_minutes = $11,
               version = version + 1, updated_at = now()
           WHERE id = $12`,
          [
            parsed.data.title,
            parsed.data.description ?? null,
            parsed.data.eventType,
            new Date(parsed.data.startAt),
            new Date(parsed.data.endAt),
            parsed.data.allDay,
            parsed.data.location ?? null,
            parsed.data.recurrence,
            parsed.data.recurrenceInterval,
            parsed.data.recurrenceUntil ? new Date(parsed.data.recurrenceUntil) : null,
            parsed.data.reminderMinutes ?? null,
            event.id,
          ],
        );
        await client.query(
          `UPDATE resource SET visibility = $1, version = version + 1, updated_at = now()
           WHERE id = $2`,
          [parsed.data.visibility, event.id],
        );
        const retainedParticipants = [...new Set([event.createdBy, ...participantIds])];
        await client.query(
          `DELETE FROM calendar_event_participant
           WHERE event_id = $1 AND NOT (member_id = ANY($2::uuid[]))`,
          [event.id, retainedParticipants],
        );
        await writeParticipants(client, event.id, event.createdBy, participantIds);
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

  app.patch<{ Params: { id: string } }>(
    '/api/v1/agenda/events/:id/response',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireAgendaModule(request, reply, pool))) return;
      const eventId = eventIdSchema.safeParse(request.params.id);
      const parsed = agendaResponseUpdateSchema.safeParse(request.body);
      if (!eventId.success) return reply.code(404).send({ error: 'EVENT_NOT_FOUND' });
      if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const event = await loadReadableEvent(
        pool,
        eventId.data,
        request.session!.instanceId,
        request.session!.id,
      );
      if (!event) return reply.code(404).send({ error: 'EVENT_NOT_FOUND' });
      const updated = await pool.query(
        `UPDATE calendar_event_participant
         SET response = $1, responded_at = CASE WHEN $1 = 'PENDING' THEN NULL ELSE now() END
         WHERE event_id = $2 AND member_id = $3`,
        [parsed.data.response, event.id, request.session!.id],
      );
      if (!updated.rowCount) return reply.code(403).send({ error: 'NOT_A_PARTICIPANT' });
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/agenda/events/:id',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireAgendaModule(request, reply, pool))) return;
      const eventId = eventIdSchema.safeParse(request.params.id);
      if (!eventId.success) return reply.code(404).send({ error: 'EVENT_NOT_FOUND' });
      const event = await loadReadableEvent(
        pool,
        eventId.data,
        request.session!.instanceId,
        request.session!.id,
      );
      if (!event) return reply.code(404).send({ error: 'EVENT_NOT_FOUND' });
      if (request.session!.role !== 'ADMIN' && event.createdBy !== request.session!.id) {
        return reply.code(403).send({ error: 'EVENT_ACTION_FORBIDDEN' });
      }
      await pool.query('UPDATE resource SET deleted_at = now(), updated_at = now() WHERE id = $1', [
        event.id,
      ]);
      return reply.code(204).send();
    },
  );
}
