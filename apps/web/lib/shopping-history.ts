import type { ShoppingItem } from '@familyhub/contracts';

export type ShoppingHistoryScope = 'mine' | 'all';
export type ShoppingHistoryStatus = 'all' | 'pending' | 'purchased';

export type ShoppingGroup = {
  name: string;
  items: ShoppingItem[];
  summary: string;
};

export function groupPendingShoppingItems(
  items: ShoppingItem[],
): ShoppingGroup[] {
  const groups = new Map<string, ShoppingItem[]>();
  for (const item of items) {
    const key = item.name.normalize('NFKC').trim().toLocaleLowerCase('fr-FR');
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()].map((entries) => ({
    name: entries[0]!.name,
    items: entries,
    summary: summarizeQuantities(entries),
  }));
}

function summarizeQuantities(items: ShoppingItem[]): string {
  const totals = new Map<string, number>();
  const other: string[] = [];
  for (const item of items) {
    const quantity = item.quantity?.trim();
    if (!quantity) {
      other.push('1');
      continue;
    }
    const match = quantity.match(/^(\d+(?:[,.]\d+)?)\s*(.*)$/u);
    if (!match) {
      other.push(quantity);
      continue;
    }
    const unit = match[2]!.trim();
    totals.set(
      unit,
      (totals.get(unit) ?? 0) + Number(match[1]!.replace(',', '.')),
    );
  }
  const parts = [...totals].map(
    ([unit, amount]) =>
      `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(amount)}${unit ? ` ${unit}` : ''}`,
  );
  parts.push(...other);
  return parts.join(' / ');
}

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
