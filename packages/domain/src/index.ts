export type Visibility = 'PRIVATE' | 'ALL_MEMBERS' | 'GROUPS' | 'SELECTED_USERS';

export type VisibilityContext = {
  actorMemberId: string;
  creatorMemberId: string;
  visibility: Visibility;
  actorGroupIds: ReadonlySet<string>;
  allowedGroupIds: ReadonlySet<string>;
  allowedMemberIds: ReadonlySet<string>;
};

export function canReadResource(context: VisibilityContext): boolean {
  if (context.actorMemberId === context.creatorMemberId) return true;

  switch (context.visibility) {
    case 'PRIVATE':
      return false;
    case 'ALL_MEMBERS':
      return true;
    case 'GROUPS':
      return [...context.actorGroupIds].some((groupId) => context.allowedGroupIds.has(groupId));
    case 'SELECTED_USERS':
      return context.allowedMemberIds.has(context.actorMemberId);
  }
}
