import { describe, expect, it } from 'vitest';
import type {
  ConversationSummary,
  FamilyGroup,
  FamilyMember,
} from '@familyhub/contracts';

import { existingGroupChat, groupChatRecipients } from './chat-groups';

const group = {
  memberIds: ['parent', 'child', 'inactive'],
} as FamilyGroup;
const members = [
  { id: 'parent', status: 'ACTIVE' },
  { id: 'child', status: 'ACTIVE' },
  { id: 'inactive', status: 'INACTIVE' },
] as FamilyMember[];

describe('group chat selection', () => {
  it('uses only active members of a group the creator belongs to', () => {
    expect(groupChatRecipients(group, members, 'parent')).toEqual(['child']);
    expect(groupChatRecipients(group, members, 'outsider')).toEqual([]);
  });

  it('finds an existing group conversation with the same participants', () => {
    const direct = {
      id: 'direct',
      type: 'DIRECT',
      participants: [{ memberId: 'child' }, { memberId: 'parent' }],
    } as ConversationSummary;
    const existing = {
      id: 'group',
      type: 'GROUP',
      participants: [{ memberId: 'child' }, { memberId: 'parent' }],
    } as ConversationSummary;
    expect(existingGroupChat([direct, existing], 'parent', ['child'])).toBe(
      existing,
    );
    expect(existingGroupChat([existing], 'parent', ['another'])).toBeNull();
  });

  it('prefers a conversation permanently linked to the selected group', () => {
    const linked = {
      id: 'linked',
      type: 'GROUP',
      sourceGroupId: 'parents',
      participants: [{ memberId: 'former-member' }],
    } as ConversationSummary;
    const sameParticipants = {
      id: 'same-participants',
      type: 'GROUP',
      sourceGroupId: null,
      participants: [{ memberId: 'child' }, { memberId: 'parent' }],
    } as ConversationSummary;

    expect(
      existingGroupChat(
        [sameParticipants, linked],
        'parent',
        ['child'],
        'parents',
      ),
    ).toBe(linked);
  });
});
