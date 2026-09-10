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
});
