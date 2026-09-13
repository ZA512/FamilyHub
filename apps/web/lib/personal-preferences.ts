import type { ModuleKey } from '@familyhub/contracts';

export type ThemePreference = 'light' | 'dark' | 'system';

export type PersonalPreferences = {
  theme: ThemePreference;
  hiddenModules: ModuleKey[];
};

export const defaultPersonalPreferences: PersonalPreferences = {
  theme: 'system',
  hiddenModules: [],
};

const moduleKeys = new Set<ModuleKey>([
  'chat',
  'agenda',
  'tasks',
  'meals',
  'shopping',
  'bookmarks',
  'pages',
  'collections',
  'polls',
  'ideas',
  'contacts',
  'documents',
]);

export function preferencesStorageKey(instanceId: string, memberId: string) {
  return `familyhub:preferences:${instanceId}:${memberId}`;
}

export function parsePersonalPreferences(
  value: string | null,
): PersonalPreferences {
  if (!value) return defaultPersonalPreferences;
  try {
    const parsed = JSON.parse(value) as Partial<PersonalPreferences>;
    const theme =
      parsed.theme === 'light' ||
      parsed.theme === 'dark' ||
      parsed.theme === 'system'
        ? parsed.theme
        : 'system';
    const hiddenModules = Array.isArray(parsed.hiddenModules)
      ? [
          ...new Set(
            parsed.hiddenModules.filter((key): key is ModuleKey =>
              moduleKeys.has(key),
            ),
          ),
        ]
      : [];
    return { theme, hiddenModules };
  } catch {
    return defaultPersonalPreferences;
  }
}

export function resolveDarkTheme(theme: ThemePreference, systemDark: boolean) {
  return theme === 'dark' || (theme === 'system' && systemDark);
}

export function applyTheme(
  theme: ThemePreference,
  systemDark: boolean,
  root: HTMLElement,
) {
  root.classList.toggle('dark', resolveDarkTheme(theme, systemDark));
  root.style.colorScheme = resolveDarkTheme(theme, systemDark)
    ? 'dark'
    : 'light';
}
