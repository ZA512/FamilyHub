import type {
  ConversationSummary,
  FamilyGroup,
  FamilyMember,
} from '@familyhub/contracts';

export function groupChatRecipients(
  group: FamilyGroup,
  members: FamilyMember[],
  currentMemberId: string,
): string[] {
  if (!group.memberIds.includes(currentMemberId)) return [];
  const activeIds = new Set(
    members
      .filter((member) => member.status === 'ACTIVE')
      .map((member) => member.id),
  );
  return group.memberIds.filter(
    (id) => id !== currentMemberId && activeIds.has(id),
  );
}

export function existingGroupChat(
  conversations: ConversationSummary[],
  currentMemberId: string,
  recipientIds: string[],
  sourceGroupId?: string,
): ConversationSummary | null {
  const linkedConversation = sourceGroupId
    ? conversations.find(
        (conversation) =>
          conversation.type === 'GROUP' &&
          conversation.sourceGroupId === sourceGroupId,
      )
    : undefined;
  if (linkedConversation) return linkedConversation;

  const participants = [...new Set([currentMemberId, ...recipientIds])].sort();
  return (
    conversations.find(
      (conversation) =>
        conversation.type === 'GROUP' &&
        conversation.participants.length === participants.length &&
        conversation.participants
          .map((participant) => participant.memberId)
          .sort()
          .every((id, index) => id === participants[index]),
    ) ?? null
  );
}
