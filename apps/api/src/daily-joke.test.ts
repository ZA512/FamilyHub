import { describe, expect, it } from 'vitest';

import jokes from './content/jokes.json' with { type: 'json' };
import { dailyJoke } from './daily-joke.js';

const refreshAt = new Date('2026-10-30T23:00:00Z');

describe('blague du jour', () => {
  it('renvoie la même blague pour tous les chargements d’une même date', () => {
    const joke = dailyJoke('2026-10-30', refreshAt);
    expect(dailyJoke('2026-10-30', refreshAt)).toEqual(joke);
    expect(joke).toMatchObject({ date: '2026-10-30', refreshAt: refreshAt.toISOString() });
    expect(joke.text.length).toBeGreaterThan(0);
    expect(joke.category.length).toBeGreaterThan(0);
  });

  it('parcourt tout le catalogue avant de répéter une blague', () => {
    const texts = new Set();
    for (let day = 0; day < jokes.length; day++) {
      const date = new Date(Date.UTC(2026, 9, 30 + day)).toISOString().slice(0, 10);
      texts.add(dailyJoke(date, refreshAt).text);
    }
    expect(texts.size).toBe(jokes.length);
    const nextCycle = new Date(Date.UTC(2026, 9, 30 + jokes.length)).toISOString().slice(0, 10);
    expect(dailyJoke(nextCycle, refreshAt).text).toBe(dailyJoke('2026-10-30', refreshAt).text);
  });

  it.each([
    ['2026-03-28', '2026-03-29'],
    ['2026-03-29', '2026-03-30'],
    ['2026-10-24', '2026-10-25'],
    ['2026-10-25', '2026-10-26'],
    ['2026-12-31', '2027-01-01'],
  ])('change entre %s et %s, y compris les jours de changement d’heure', (before, after) => {
    expect(dailyJoke(before, refreshAt).text).not.toBe(dailyJoke(after, refreshAt).text);
  });

  it('embarque un catalogue unique limité au texte et à la catégorie', () => {
    const keys = jokes.map(({ text }) =>
      text
        .normalize('NFKC')
        .toLocaleLowerCase('fr')
        .replace(/[’‘]/g, "'")
        .replace(/\s+/g, ' ')
        .trim(),
    );
    expect(new Set(keys).size).toBe(jokes.length);
    expect(jokes.length).toBeGreaterThan(800);
    for (const joke of jokes) {
      expect(Object.keys(joke).sort()).toEqual(['category', 'text']);
      expect(joke.text).not.toMatch(/© 2017|Envie de découvrir|Histoires de la catégorie/);
    }
    expect(
      jokes.find(({ text }) => text.startsWith('Pourquoi les Belges ne font pas de ski nautique'))
        ?.text,
    ).toContain('lacs en pente');
    expect(jokes.find(({ text }) => text.startsWith('- Un condamné à mort'))?.text).toContain(
      'mauvais conducteur',
    );
    expect(jokes.some(({ text }) => text.includes("chaque fois qu'il croisait un collègue"))).toBe(
      false,
    );
  });
});
