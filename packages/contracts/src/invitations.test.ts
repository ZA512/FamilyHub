import { describe, expect, it } from 'vitest';

import {
  invitationAcceptSchema,
  invitationCreateSchema,
  invitationInspectSchema,
} from './index.js';

describe('invitation contracts', () => {
  it('normalise l’adresse et applique le rôle membre par défaut', () => {
    expect(invitationCreateSchema.parse({ email: '  JADE@EXAMPLE.FR ' })).toEqual({
      email: 'jade@example.fr',
      role: 'MEMBER',
    });
  });

  it('refuse les jetons trop courts', () => {
    expect(() => invitationInspectSchema.parse({ token: 'court' })).toThrow();
  });

  it('exige un mot de passe robuste à l’acceptation', () => {
    expect(() =>
      invitationAcceptSchema.parse({
        token: 'a'.repeat(43),
        firstName: 'Jade',
        password: 'trop-court',
      }),
    ).toThrow();
  });
});
