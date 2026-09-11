import { describe, expect, it } from 'vitest';

import {
  chatMessageCreateSchema,
  chatMessagesQuerySchema,
  chatReactionUpdateSchema,
  conversationCreateSchema,
} from './index.js';

describe('chat contracts', () => {
  it('accepts a bounded group conversation', () => {
    expect(
      conversationCreateSchema.safeParse({
        type: 'GROUP',
        title: 'Vacances',
        participantIds: ['f41fb9af-c16d-468f-9881-8b35683cf1f0'],
        clientMutationId: '912b6fb0-1a40-4918-a548-6382e855de82',
      }).success,
    ).toBe(true);
  });

  it('rejects empty and oversized messages', () => {
    expect(
      chatMessageCreateSchema.safeParse({
        body: 'Bonjour !',
        clientMutationId: '912b6fb0-1a40-4918-a548-6382e855de82',
      }).success,
    ).toBe(true);
    expect(
      chatMessageCreateSchema.safeParse({
        body: ' '.repeat(4001),
        clientMutationId: '912b6fb0-1a40-4918-a548-6382e855de82',
      }).success,
    ).toBe(false);
  });

  it('limits history pages and reaction values', () => {
    expect(chatMessagesQuerySchema.parse({ limit: '25' }).limit).toBe(25);
    expect(chatMessagesQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(chatReactionUpdateSchema.safeParse({ emoji: '❤️' }).success).toBe(true);
    expect(chatReactionUpdateSchema.safeParse({ emoji: '<script>' }).success).toBe(false);
  });
});
