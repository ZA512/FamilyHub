import { describe, expect, it } from 'vitest';

import { agendaDateRange, defaultAgendaEndValue } from './agenda-dates';

describe('dates du formulaire agenda', () => {
  it('place automatiquement la fin une heure après le début', () => {
    expect(defaultAgendaEndValue('2026-09-28T14:30', false)).toBe(
      '2026-09-28T15:30',
    );
    expect(defaultAgendaEndValue('2026-09-28T23:30', false)).toBe(
      '2026-09-29T00:30',
    );
  });

  it('conserve le même jour pour un événement sur toute la journée', () => {
    expect(defaultAgendaEndValue('2026-09-28', true)).toBe('2026-09-28');
    const range = agendaDateRange('2026-09-28', '2026-09-28', true);
    expect(
      new Date(range.endAt).getTime() - new Date(range.startAt).getTime(),
    ).toBe(24 * 60 * 60 * 1000);
  });

  it('refuse une fin antérieure ou égale au début avec un message explicite', () => {
    expect(() =>
      agendaDateRange('2026-09-28T14:30', '2026-09-28T14:30', false),
    ).toThrow('La fin doit suivre le début.');
    expect(() =>
      agendaDateRange('2026-09-28T14:30', '2026-09-28T13:30', false),
    ).toThrow('La fin doit suivre le début.');
  });
});
