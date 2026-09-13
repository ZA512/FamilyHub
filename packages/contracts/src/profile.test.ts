import { describe, expect, it } from 'vitest';

import { profileUpdateSchema } from './index.js';

describe('profile contracts', () => {
  it('normalise les champs facultatifs', () => {
    expect(
      profileUpdateSchema.parse({
        firstName: '  Jade ',
        lastName: ' ',
        phone: '',
        birthDate: null,
        timezone: 'Europe/Paris',
      }),
    ).toEqual({
      firstName: 'Jade',
      lastName: null,
      phone: null,
      birthDate: null,
      timezone: 'Europe/Paris',
      locale: 'fr',
      profileVisibility: 'ALL_MEMBERS',
      avatarAttachmentId: null,
    });
  });

  it('refuse un fuseau horaire inconnu', () => {
    expect(() =>
      profileUpdateSchema.parse({
        firstName: 'Jade',
        lastName: null,
        phone: null,
        birthDate: null,
        timezone: 'Mars/Olympus',
      }),
    ).toThrow();
  });

  it('refuse une date qui n’existe pas', () => {
    expect(() =>
      profileUpdateSchema.parse({
        firstName: 'Jade',
        lastName: null,
        phone: null,
        birthDate: '2024-02-31',
        timezone: 'Europe/Paris',
      }),
    ).toThrow();
  });

  it('accepte les préférences personnelles explicites', () => {
    expect(
      profileUpdateSchema.parse({
        firstName: 'Jade',
        lastName: null,
        phone: null,
        birthDate: '1992-02-29',
        timezone: 'Europe/Paris',
        locale: 'en',
        profileVisibility: 'PRIVATE',
        avatarAttachmentId: 'ec3ef472-f269-444d-afd7-05bb635a09cc',
      }),
    ).toMatchObject({
      locale: 'en',
      profileVisibility: 'PRIVATE',
      avatarAttachmentId: 'ec3ef472-f269-444d-afd7-05bb635a09cc',
    });
  });
});
