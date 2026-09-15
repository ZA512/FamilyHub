import type { ShoppingItem } from '@familyhub/contracts';

export type ShoppingHistoryView = 'mine' | 'requests' | 'purchased';

const RECENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export function sortPendingShoppingItems(
  items: ShoppingItem[],
): ShoppingItem[] {
  return items
    .filter((item) => !item.purchasedAt)
    .sort((left, right) => {
      const sourcePriority =
        Number(right.source === 'MANUAL') - Number(left.source === 'MANUAL');
      return (
        sourcePriority ||
        Date.parse(right.createdAt) - Date.parse(left.createdAt)
      );
    });
}

export function shoppingHistoryItems(
  items: ShoppingItem[],
  view: ShoppingHistoryView,
  currentMemberId: string,
  now: Date,
  includeOlder = false,
): ShoppingItem[] {
  const cutoff = now.getTime() - RECENT_WINDOW_MS;
  return items
    .filter((item) => {
      if (view === 'purchased') {
        return (
          item.purchasedAt !== null &&
          (includeOlder || Date.parse(item.purchasedAt) >= cutoff)
        );
      }
      if (item.source !== 'MANUAL') return false;
      if (view === 'mine' && item.requestedBy !== currentMemberId) return false;
      return (
        !item.purchasedAt ||
        includeOlder ||
        Date.parse(item.purchasedAt) >= cutoff
      );
    })
    .sort((left, right) => {
      if (
        view !== 'purchased' &&
        Boolean(left.purchasedAt) !== Boolean(right.purchasedAt)
      ) {
        return left.purchasedAt ? 1 : -1;
      }
      return (
        Date.parse(right.purchasedAt ?? right.createdAt) -
        Date.parse(left.purchasedAt ?? left.createdAt)
      );
    });
}
