import { describe, expect, it } from 'vitest';

import { localizeNotification } from './notification-copy.js';

describe('notification copy', () => {
  it('keeps French notification copy unchanged', () => {
    expect(
      localizeNotification('fr', {
        type: 'PAGE_SHARED',
        title: 'Page partagée',
        body: 'Jade a partagé : Maison',
      }),
    ).toEqual({
      type: 'PAGE_SHARED',
      title: 'Page partagée',
      body: 'Jade a partagé : Maison',
    });
  });

  it('translates system copy while preserving user-provided content', () => {
    expect(
      localizeNotification('en', {
        type: 'COLLECTION_ITEM_ADDED',
        title: 'Nouvel élément dans une collection',
        body: 'Jade ajoute « Le dîner » dans « Idées vacances »',
      }),
    ).toEqual({
      type: 'COLLECTION_ITEM_ADDED',
      title: 'New item in a collection',
      body: 'Jade added “Le dîner” to “Idées vacances”',
    });
  });

  it('does not alter chat content', () => {
    expect(
      localizeNotification('en', {
        type: 'CHAT_MESSAGE',
        title: 'Famille',
        body: 'On mange à quelle heure ?',
      }).body,
    ).toBe('On mange à quelle heure ?');
  });

  it('translates music recommendation copy while preserving its name', () => {
    expect(
      localizeNotification('en', {
        type: 'MUSIC_RECOMMENDATION',
        title: 'Nouvelle recommandation musicale',
        body: 'Jade vous recommande le titre « Le dîner »',
      }),
    ).toEqual({
      type: 'MUSIC_RECOMMENDATION',
      title: 'New music recommendation',
      body: 'Jade recommends “Le dîner”',
    });
  });
});
