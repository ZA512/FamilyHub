import { describe, expect, it } from 'vitest';

import {
  emptyPageContent,
  pageCreateSchema,
  pageRestoreSchema,
  pagesQuerySchema,
} from './index.js';

describe('page contracts', () => {
  const base = {
    title: 'Infos maison',
    content: emptyPageContent,
    folder: 'Maison',
    tags: ['pratique'],
    visibility: 'ALL_MEMBERS' as const,
    groupIds: [],
    memberIds: [],
    linkedPageIds: [],
    clientMutationId: '11111111-1111-4111-8111-111111111111',
  };

  it('accepts the supported rich content', () => {
    const result = pageCreateSchema.safeParse({
      ...base,
      content: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Urgences', marks: [{ type: 'bold' }] }],
          },
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Appeler' }] }],
              },
            ],
          },
          { type: 'image', attrs: { src: 'https://example.test/photo.jpg', alt: 'Photo' } },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects unsafe image and link protocols', () => {
    const unsafeImage = pageCreateSchema.safeParse({
      ...base,
      content: { type: 'doc', content: [{ type: 'image', attrs: { src: 'javascript:alert(1)' } }] },
    });
    const unsafeLink = pageCreateSchema.safeParse({
      ...base,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Piège',
                marks: [{ type: 'link', attrs: { href: 'data:text/html,boom' } }],
              },
            ],
          },
        ],
      },
    });
    expect(unsafeImage.success).toBe(false);
    expect(unsafeLink.success).toBe(false);
  });

  it('requires an audience for targeted sharing', () => {
    expect(
      pageCreateSchema.safeParse({ ...base, visibility: 'SELECTED_USERS', memberIds: [] }).success,
    ).toBe(false);
  });

  it('validates stable pagination and restore requests', () => {
    expect(pagesQuerySchema.safeParse({ before: '2026-09-11T12:00:00Z' }).success).toBe(false);
    expect(
      pageRestoreSchema.safeParse({
        revisionId: '22222222-2222-4222-8222-222222222222',
        version: 3,
      }).success,
    ).toBe(true);
  });
});
