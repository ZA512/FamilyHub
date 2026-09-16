import { describe, expect, it } from 'vitest';
import type { ShoppingItem } from '@familyhub/contracts';

import {
  shoppingHistoryItems,
  sortPendingShoppingItems,
} from './shopping-history';

const now = new Date('2026-09-15T12:00:00.000Z');
function item(
  id: string,
  source: string,
  requestedBy: string,
  createdAt: string,
  purchasedAt: string | null = null,
) {
  return { id, source, requestedBy, createdAt, purchasedAt } as ShoppingItem;
}

const items = [
  item('old-pending', 'MANUAL', 'child', '2026-09-01T12:00:00.000Z'),
  item('meal-pending', 'MEAL', 'parent', '2026-09-15T10:00:00.000Z'),
  item('manual-pending', 'MANUAL', 'parent', '2026-09-14T10:00:00.000Z'),
  item(
    'recent-bought',
    'MANUAL',
    'child',
    '2026-09-10T12:00:00.000Z',
    '2026-09-14T12:00:00.000Z',
  ),
  item(
    'week-bought',
    'MANUAL',
    'child',
    '2026-09-01T12:00:00.000Z',
    '2026-09-10T12:00:00.000Z',
  ),
  item(
    'expired-bought',
    'MANUAL',
    'child',
    '2026-09-01T12:00:00.000Z',
    '2026-09-02T12:00:00.000Z',
  ),
  item(
    'meal-bought',
    'MEAL',
    'parent',
    '2026-09-14T12:00:00.000Z',
    '2026-09-15T11:00:00.000Z',
  ),
];

describe('shopping history', () => {
  it('places explicit requests before meal ingredients in the active list', () => {
    expect(sortPendingShoppingItems(items).map((entry) => entry.id)).toEqual([
      'manual-pending',
      'old-pending',
      'meal-pending',
    ]);
  });

  it('keeps unanswered requests and only exposes purchases retained for seven days', () => {
    expect(
      shoppingHistoryItems(items, 'mine', 'all', 'child', now).map(
        (entry) => entry.id,
      ),
    ).toEqual(['old-pending', 'recent-bought']);
    expect(
      shoppingHistoryItems(items, 'mine', 'all', 'child', now, true).map(
        (entry) => entry.id,
      ),
    ).toEqual(['old-pending', 'recent-bought', 'week-bought']);
  });

  it('applies the member scope to pending and purchased requests', () => {
    expect(
      shoppingHistoryItems(items, 'all', 'pending', 'child', now).map(
        (entry) => entry.id,
      ),
    ).toEqual(['manual-pending', 'old-pending']);
    expect(
      shoppingHistoryItems(items, 'mine', 'purchased', 'child', now).map(
        (entry) => entry.id,
      ),
    ).toEqual(['recent-bought']);
    expect(
      shoppingHistoryItems(items, 'all', 'purchased', 'child', now).map(
        (entry) => entry.id,
      ),
    ).toEqual(['recent-bought']);
  });
});
