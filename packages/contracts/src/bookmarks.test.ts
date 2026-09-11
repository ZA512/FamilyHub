import { describe, expect, it } from 'vitest';

import { bookmarkCreateSchema, bookmarksQuerySchema } from './index.js';

const mutationId = '11111111-1111-4111-8111-111111111111';

describe('bookmark contracts', () => {
  it('accepts a private HTTPS bookmark', () => {
    expect(
      bookmarkCreateSchema.safeParse({
        url: 'https://example.org/guide',
        title: 'Guide familial',
        visibility: 'PRIVATE',
        clientMutationId: mutationId,
      }).success,
    ).toBe(true);
  });

  it('requires recipients for targeted sharing', () => {
    expect(
      bookmarkCreateSchema.safeParse({
        url: 'https://example.org',
        visibility: 'SELECTED_USERS',
        clientMutationId: mutationId,
      }).success,
    ).toBe(false);
  });

  it('rejects executable URLs and incomplete cursors', () => {
    expect(
      bookmarkCreateSchema.safeParse({
        url: 'javascript:alert(1)',
        clientMutationId: mutationId,
      }).success,
    ).toBe(false);
    expect(
      bookmarksQuerySchema.safeParse({ before: '2026-09-11T12:00:00Z' }).success,
    ).toBe(false);
  });
});
