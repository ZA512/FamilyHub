import { describe, expect, it } from 'vitest';

import { taskCompleteSchema, taskCreateSchema } from './index.js';

const mutationId = '11111111-1111-4111-8111-111111111111';
const assigneeId = '22222222-2222-4222-8222-222222222222';

describe('task contracts', () => {
  it('accepts an assigned scheduled task with a temporal recurrence', () => {
    const parsed = taskCreateSchema.parse({
      title: 'Sortir les poubelles',
      kind: 'SCHEDULED',
      assigneeId,
      dueAt: '2026-09-15T18:00:00+02:00',
      recurrenceIntervalDays: 7,
      visibility: 'ALL_MEMBERS',
      clientMutationId: mutationId,
    });

    expect(parsed.recurrenceIntervalDays).toBe(7);
    expect(parsed.reopenPolicy).toBe('NONE');
  });

  it('keeps an open chore frequency separate from its reopening delay', () => {
    const parsed = taskCreateSchema.parse({
      title: 'Vider le lave-vaisselle',
      kind: 'OPEN_CHORE',
      claimable: true,
      frequencyHint: 'Environ une fois par jour',
      reopenPolicy: 'AFTER_DELAY',
      reopenDelayHours: 8,
      clientMutationId: mutationId,
    });

    expect(parsed.frequencyHint).toBe('Environ une fois par jour');
    expect(parsed.reopenDelayHours).toBe(8);
  });

  it('accepts a one-off personal task without a date', () => {
    expect(
      taskCreateSchema.safeParse({
        title: 'Appeler le médecin',
        kind: 'SCHEDULED',
        assigneeId,
        visibility: 'PRIVATE',
        clientMutationId: mutationId,
      }).success,
    ).toBe(true);
  });

  it('accepts a task opened to a family group', () => {
    expect(
      taskCreateSchema.safeParse({
        title: 'Ranger la salle de jeux',
        kind: 'SCHEDULED',
        claimable: true,
        visibility: 'GROUPS',
        groupIds: [assigneeId],
        clientMutationId: mutationId,
      }).success,
    ).toBe(true);
  });

  it('rejects an empty group audience', () => {
    expect(
      taskCreateSchema.safeParse({
        title: 'Ranger la salle de jeux',
        kind: 'SCHEDULED',
        visibility: 'GROUPS',
        clientMutationId: mutationId,
      }).success,
    ).toBe(false);
  });

  it('rejects an assignee who cannot see the selected-users task', () => {
    expect(
      taskCreateSchema.safeParse({
        title: 'Préparer les valises',
        kind: 'SCHEDULED',
        assigneeId,
        visibility: 'SELECTED_USERS',
        userIds: ['33333333-3333-4333-8333-333333333333'],
        clientMutationId: mutationId,
      }).success,
    ).toBe(false);
  });

  it('rejects dates on an open chore', () => {
    expect(
      taskCreateSchema.safeParse({
        title: 'Vider le lave-vaisselle',
        kind: 'OPEN_CHORE',
        dueAt: '2026-09-15T18:00:00+02:00',
        clientMutationId: mutationId,
      }).success,
    ).toBe(false);
  });

  it('accepts an optional completion comment', () => {
    expect(
      taskCompleteSchema.parse({ comment: 'Fait avant le dîner', clientMutationId: mutationId }),
    ).toEqual({ comment: 'Fait avant le dîner', clientMutationId: mutationId });
  });
});
