import { describe, expect, it } from 'vitest';

import { pollCreateSchema, pollsQuerySchema, pollVoteSchema } from './index.js';

const basePoll = {
  question: 'Quel film regarde-t-on ?',
  options: ['Le Voyage de Chihiro', 'Paddington 2'],
  clientMutationId: '42ee77a8-ab0b-4208-b0c8-069b77b92cdc',
};

describe('poll contracts', () => {
  it('applies safe defaults to a single-choice family poll', () => {
    const result = pollCreateSchema.parse(basePoll);
    expect(result).toMatchObject({
      allowMultiple: false,
      anonymous: false,
      visibility: 'ALL_MEMBERS',
      groupIds: [],
      memberIds: [],
    });
  });

  it('rejects duplicate answers regardless of case', () => {
    expect(
      pollCreateSchema.safeParse({ ...basePoll, options: ['Pizza', 'pizza'] }).success,
    ).toBe(false);
  });

  it('requires an audience for targeted polls', () => {
    expect(
      pollCreateSchema.safeParse({
        ...basePoll,
        visibility: 'SELECTED_USERS',
        memberIds: [],
      }).success,
    ).toBe(false);
  });

  it('rejects an end date in the past', () => {
    expect(
      pollCreateSchema.safeParse({ ...basePoll, endsAt: '2020-01-01T12:00:00.000Z' }).success,
    ).toBe(false);
  });

  it('validates votes and stable pagination', () => {
    expect(pollVoteSchema.safeParse({ optionIds: [] }).success).toBe(false);
    expect(
      pollVoteSchema.safeParse({
        optionIds: ['47d978a2-5a3e-4292-8cb0-ad963cf64fc8'],
      }).success,
    ).toBe(true);
    expect(pollsQuerySchema.safeParse({ before: new Date().toISOString() }).success).toBe(false);
  });
});
