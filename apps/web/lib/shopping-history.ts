import type { ShoppingItem } from '@familyhub/contracts';

export type ShoppingHistoryScope = 'mine' | 'all';
export type ShoppingHistoryStatus = 'all' | 'pending' | 'purchased';

const RECENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const RETENTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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
  scope: ShoppingHistoryScope,
  status: ShoppingHistoryStatus,
  currentMemberId: string,
  now: Date,
  includeOlder = false,
): ShoppingItem[] {
  const recentCutoff = now.getTime() - RECENT_WINDOW_MS;
  const retentionCutoff = now.getTime() - RETENTION_WINDOW_MS;
  return items
    .filter((item) => {
      if (item.source !== 'MANUAL') return false;
      if (scope === 'mine' && item.requestedBy !== currentMemberId)
        return false;
      if (status === 'pending') return item.purchasedAt === null;
      if (status === 'purchased' && item.purchasedAt === null) return false;
      if (item.purchasedAt === null) return true;
      const purchasedAt = Date.parse(item.purchasedAt);
      if (purchasedAt < retentionCutoff) return false;
      return includeOlder || purchasedAt >= recentCutoff;
    })
    .sort((left, right) => {
      if (
        status === 'all' &&
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
