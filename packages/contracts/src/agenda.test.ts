import { describe, expect, it } from 'vitest';

import { agendaEventCreateSchema, agendaRangeSchema } from './index.js';

const mutationId = '11111111-1111-4111-8111-111111111111';

describe('agenda contracts', () => {
  it('accepts a recurring family event', () => {
    const parsed = agendaEventCreateSchema.parse({
      title: 'Cours de natation',
      eventType: 'APPOINTMENT',
      startAt: '2026-09-16T16:00:00+02:00',
      endAt: '2026-09-16T17:00:00+02:00',
      recurrence: 'WEEKLY',
      recurrenceInterval: 1,
      participantIds: [],
      visibility: 'ALL_MEMBERS',
      clientMutationId: mutationId,
    });

    expect(parsed.recurrence).toBe('WEEKLY');
  });

  it('rejects an event ending before it starts', () => {
    expect(
      agendaEventCreateSchema.safeParse({
        title: 'Rendez-vous',
        startAt: '2026-09-16T18:00:00+02:00',
        endAt: '2026-09-16T17:00:00+02:00',
        clientMutationId: mutationId,
      }).success,
    ).toBe(false);
  });

  it('bounds calendar feed requests', () => {
    expect(
      agendaRangeSchema.safeParse({
        start: '2026-01-01T00:00:00Z',
        end: '2028-01-01T00:00:00Z',
      }).success,
    ).toBe(false);
  });
});
