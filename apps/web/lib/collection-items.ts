import type { FamilyCollectionItem } from '@familyhub/contracts';

import { localeTag } from './i18n';

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .toLocaleLowerCase(localeTag())
    .trim();
}

export function collectionItemTags(items: FamilyCollectionItem[]): string[] {
  return [...new Set(items.flatMap((item) => item.tags))].sort((left, right) =>
    left.localeCompare(right, localeTag()),
  );
}

export function filterCollectionItems(
  items: FamilyCollectionItem[],
  filters: { query: string; tag: string },
): FamilyCollectionItem[] {
  const query = normalizeSearch(filters.query);

  return items.filter((item) => {
    if (filters.tag && !item.tags.includes(filters.tag)) return false;
    if (!query) return true;

    return normalizeSearch(
      [
        item.title,
        item.subtitle,
        item.description,
        ...item.tags,
        ...Object.entries(item.metadata).flat(),
      ]
        .filter((value): value is string => Boolean(value))
        .join(' '),
    ).includes(query);
  });
}
