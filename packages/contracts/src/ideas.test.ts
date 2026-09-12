import { describe, expect, it } from 'vitest';

import {
  ideaConvertSchema,
  ideaCreateSchema,
  ideaReactionSchema,
  ideasQuerySchema,
} from './index.js';

const baseIdea = {
  title: 'Un week-end à Annecy',
  clientMutationId: 'a58fddc4-0ce7-4633-a75c-c9b30e0d76e4',
};

describe('idea contracts', () => {
  it('applies family-safe defaults', () => {
    expect(ideaCreateSchema.parse(baseIdea)).toMatchObject({
      category: 'GENERAL',
      visibility: 'ALL_MEMBERS',
      groupIds: [],
      memberIds: [],
    });
  });

  it('requires a selected audience when targeting members', () => {
    expect(
      ideaCreateSchema.safeParse({
        ...baseIdea,
        visibility: 'SELECTED_USERS',
        memberIds: [],
      }).success,
    ).toBe(false);
  });

  it('accepts support, opposition and reaction removal', () => {
    expect(ideaReactionSchema.safeParse({ value: 1 }).success).toBe(true);
    expect(ideaReactionSchema.safeParse({ value: -1 }).success).toBe(true);
    expect(ideaReactionSchema.safeParse({ value: null }).success).toBe(true);
    expect(ideaReactionSchema.safeParse({ value: 0 }).success).toBe(false);
  });

  it('requires chronological dates for an event conversion', () => {
    expect(
      ideaConvertSchema.safeParse({
        target: 'EVENT',
        startsAt: '2026-10-10T18:00:00.000Z',
        endsAt: '2026-10-10T17:00:00.000Z',
        clientMutationId: baseIdea.clientMutationId,
      }).success,
    ).toBe(false);
  });

  it('validates stable pagination', () => {
    expect(ideasQuerySchema.safeParse({ before: new Date().toISOString() }).success).toBe(false);
  });
});
