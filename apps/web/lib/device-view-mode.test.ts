import { describe, expect, it } from 'vitest';

import { readDeviceViewMode, writeDeviceViewMode } from './device-view-mode';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe('device view mode', () => {
  it('uses each module default until a choice is stored', () => {
    const storage = memoryStorage();
    expect(readDeviceViewMode(storage, 'member-1', 'bookmarks', 'list')).toBe(
      'list',
    );
    expect(readDeviceViewMode(storage, 'member-1', 'contacts', 'cards')).toBe(
      'cards',
    );
  });

  it('keeps module and account choices independent', () => {
    const storage = memoryStorage();
    writeDeviceViewMode(storage, 'member-1', 'bookmarks', 'cards');
    expect(readDeviceViewMode(storage, 'member-1', 'bookmarks', 'list')).toBe(
      'cards',
    );
    expect(readDeviceViewMode(storage, 'member-1', 'contacts', 'cards')).toBe(
      'cards',
    );
    expect(readDeviceViewMode(storage, 'member-2', 'bookmarks', 'list')).toBe(
      'list',
    );
  });

  it('falls back safely when storage is missing or unavailable', () => {
    const unavailable = {
      getItem: () => {
        throw new Error('Storage denied');
      },
      setItem: () => {
        throw new Error('Storage denied');
      },
    };
    expect(readDeviceViewMode(null, 'member-1', 'meals', 'list')).toBe('list');
    expect(readDeviceViewMode(unavailable, 'member-1', 'meals', 'list')).toBe(
      'list',
    );
    expect(() =>
      writeDeviceViewMode(unavailable, 'member-1', 'meals', 'cards'),
    ).not.toThrow();
  });
});
