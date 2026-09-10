import { describe, expect, it } from 'vitest';

import { canReadResource, type VisibilityContext } from './index.js';

const base: VisibilityContext = {
  actorMemberId: 'actor',
  creatorMemberId: 'creator',
  visibility: 'PRIVATE',
  actorGroupIds: new Set(),
  allowedGroupIds: new Set(),
  allowedMemberIds: new Set(),
};

describe('canReadResource', () => {
  it('réserve une ressource privée à son créateur', () => {
    expect(canReadResource({ ...base, actorMemberId: 'creator' })).toBe(true);
    expect(canReadResource(base)).toBe(false);
  });

  it('autorise tous les membres pour ALL_MEMBERS', () => {
    expect(canReadResource({ ...base, visibility: 'ALL_MEMBERS' })).toBe(true);
  });

  it('exige au moins un groupe commun pour GROUPS', () => {
    expect(
      canReadResource({
        ...base,
        visibility: 'GROUPS',
        actorGroupIds: new Set(['parents']),
        allowedGroupIds: new Set(['parents', 'vacances']),
      }),
    ).toBe(true);
    expect(canReadResource({ ...base, visibility: 'GROUPS' })).toBe(false);
  });

  it('exige une sélection explicite pour SELECTED_USERS', () => {
    expect(
      canReadResource({
        ...base,
        visibility: 'SELECTED_USERS',
        allowedMemberIds: new Set(['actor']),
      }),
    ).toBe(true);
  });
});
