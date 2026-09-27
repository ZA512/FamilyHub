import { describe, expect, it } from 'vitest';

import type { FamilyCollectionItem } from '@familyhub/contracts';

import { collectionItemTags, filterCollectionItems } from './collection-items';

function item(
  id: string,
  values: Partial<FamilyCollectionItem>,
): FamilyCollectionItem {
  return {
    id,
    collectionId: 'collection-1',
    title: 'Sans titre',
    subtitle: null,
    description: null,
    url: null,
    imageUrl: null,
    tags: [],
    metadata: {},
    addedBy: 'member-1',
    addedByName: 'Papa',
    editable: true,
    preference: null,
    preferences: { negative: 0, neutral: 0, positive: 0 },
    comments: [],
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...values,
  };
}

const items = [
  item('nebuleuses', {
    title: 'Les Nébuleuses',
    tags: ['science-fiction', 'favori'],
    metadata: { Auteur: 'Franck Herbert', ISBN: '9780000000001' },
  }),
  item('fondation', {
    title: 'Le Cycle de Fondation',
    subtitle: 'Sept tomes',
    description: 'Une grande fresque galactique',
    tags: ['science-fiction', 'classique'],
    metadata: { Auteur: 'Isaac Asimov', ISBN: '9780000000002' },
  }),
];

describe('filtres des éléments de collection', () => {
  it('recherche sans tenir compte des accents dans les champs et métadonnées', () => {
    expect(
      filterCollectionItems(items, { query: 'nebuleuses', tag: '' }).map(
        (entry) => entry.id,
      ),
    ).toEqual(['nebuleuses']);
    expect(
      filterCollectionItems(items, { query: 'asimov', tag: '' }).map(
        (entry) => entry.id,
      ),
    ).toEqual(['fondation']);
    expect(
      filterCollectionItems(items, { query: '9780000000001', tag: '' }).map(
        (entry) => entry.id,
      ),
    ).toEqual(['nebuleuses']);
  });

  it('combine la recherche avec une étiquette', () => {
    expect(
      filterCollectionItems(items, {
        query: 'science fiction',
        tag: 'classique',
      }).map((entry) => entry.id),
    ).toEqual(['fondation']);
  });

  it('retourne les étiquettes uniques triées', () => {
    expect(collectionItemTags(items)).toEqual([
      'classique',
      'favori',
      'science-fiction',
    ]);
  });
});
