import { describe, expect, it } from 'vitest';

import {
  collectionCommentCreateSchema,
  collectionCreateSchema,
  collectionItemCreateSchema,
  collectionPreferenceSchema,
  collectionsQuerySchema,
} from './index.js';

const mutationId = '11111111-1111-4111-8111-111111111111';

describe('collection contracts', () => {
  it('accepts a shared typed collection', () => {
    expect(
      collectionCreateSchema.safeParse({
        name: 'Films du dimanche',
        description: 'Nos prochaines séances',
        type: 'MOVIES',
        imageUrl: 'https://example.org/cinema.jpg',
        tags: ['famille'],
        visibility: 'ALL_MEMBERS',
        clientMutationId: mutationId,
      }).success,
    ).toBe(true);
  });

  it('validates item metadata and safe URLs', () => {
    expect(
      collectionItemCreateSchema.safeParse({
        title: 'Le Voyage de Chihiro',
        url: 'https://example.org/chihiro',
        metadata: { Année: '2001', Réalisateur: 'Hayao Miyazaki' },
        clientMutationId: mutationId,
      }).success,
    ).toBe(true);
    expect(
      collectionItemCreateSchema.safeParse({
        title: 'Piège',
        url: 'javascript:alert(1)',
        clientMutationId: mutationId,
      }).success,
    ).toBe(false);
  });

  it('requires recipients for targeted sharing', () => {
    expect(
      collectionCreateSchema.safeParse({
        name: 'Cadeaux',
        type: 'GIFTS',
        visibility: 'GROUPS',
        groupIds: [],
        clientMutationId: mutationId,
      }).success,
    ).toBe(false);
  });

  it('bounds preferences and comments', () => {
    expect(collectionPreferenceSchema.safeParse({ value: 1 }).success).toBe(true);
    expect(collectionPreferenceSchema.safeParse({ value: 2 }).success).toBe(false);
    expect(
      collectionCommentCreateSchema.safeParse({ body: 'Bonne idée', clientMutationId: mutationId })
        .success,
    ).toBe(true);
  });

  it('requires complete pagination cursors', () => {
    expect(collectionsQuerySchema.safeParse({ before: '2026-09-11T12:00:00Z' }).success).toBe(
      false,
    );
  });
});
