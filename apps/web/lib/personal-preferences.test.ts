import { describe, expect, it } from 'vitest';

import {
  defaultPersonalPreferences,
  parsePersonalPreferences,
  resolveDarkTheme,
} from './personal-preferences';

describe('personal preferences', () => {
  it('accepts supported values and removes duplicate hidden modules', () => {
    expect(
      parsePersonalPreferences(
        JSON.stringify({
          theme: 'dark',
          hiddenModules: ['chat', 'chat', 'tasks', 'unknown'],
        }),
      ),
    ).toEqual({ theme: 'dark', hiddenModules: ['chat', 'tasks'] });
  });

  it('falls back safely when local storage is invalid', () => {
    expect(parsePersonalPreferences('{')).toEqual(defaultPersonalPreferences);
    expect(
      parsePersonalPreferences(JSON.stringify({ theme: 'sepia' })),
    ).toEqual(defaultPersonalPreferences);
  });

  it('resolves the system theme without overriding explicit choices', () => {
    expect(resolveDarkTheme('system', true)).toBe(true);
    expect(resolveDarkTheme('system', false)).toBe(false);
    expect(resolveDarkTheme('light', true)).toBe(false);
    expect(resolveDarkTheme('dark', false)).toBe(true);
  });
});
