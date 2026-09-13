import { describe, expect, it } from 'vitest';

import {
  chatMessageCreateSchema,
  chatMessagesQuerySchema,
  chatReactionUpdateSchema,
  conversationMuteUpdateSchema,
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
    expect(
      chatMessageCreateSchema.safeParse({
        body: '',
        attachmentIds: ['f41fb9af-c16d-468f-9881-8b35683cf1f0'],
        clientMutationId: '912b6fb0-1a40-4918-a548-6382e855de82',
      }).success,
    ).toBe(true);
  });

  it('limits history pages and reaction values', () => {
    expect(chatMessagesQuerySchema.parse({ limit: '25' }).limit).toBe(25);
    expect(chatMessagesQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(
      chatMessagesQuerySchema.safeParse({
        before: '2026-09-11T12:00:00.000Z',
        beforeId: 'f41fb9af-c16d-468f-9881-8b35683cf1f0',
      }).success,
    ).toBe(true);
    expect(
      chatMessagesQuerySchema.safeParse({
        before: '2026-09-11T12:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(chatReactionUpdateSchema.safeParse({ emoji: '❤️' }).success).toBe(true);
    expect(chatReactionUpdateSchema.safeParse({ emoji: '<script>' }).success).toBe(false);
  });

  it('requires an explicit conversation mute state', () => {
    expect(conversationMuteUpdateSchema.parse({ muted: true })).toEqual({ muted: true });
    expect(conversationMuteUpdateSchema.safeParse({ muted: 'yes' }).success).toBe(false);
  });
});
