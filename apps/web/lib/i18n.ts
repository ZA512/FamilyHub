import { useSyncExternalStore } from 'react';

import { englishMessages, englishTemplateMessages } from './i18n-messages';

export type AppLocale = 'fr' | 'en';

const LOCALE_STORAGE_KEY = 'familyhub:locale';

function initialLocale(): AppLocale {
  if (typeof window === 'undefined') return 'fr';
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  if (stored === 'fr' || stored === 'en') return stored;
  return window.navigator.language.toLowerCase().startsWith('en') ? 'en' : 'fr';
}

let currentLocale: AppLocale = initialLocale();
const listeners = new Set<() => void>();

export function getLocale() {
  return currentLocale;
}

export function localeTag() {
  return currentLocale === 'en' ? 'en-GB' : 'fr-FR';
}

export function setLocale(locale: AppLocale) {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  if (typeof window !== 'undefined')
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  if (currentLocale === locale) return;
  currentLocale = locale;
  listeners.forEach((listener) => listener());
}

export function useLocale() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getLocale,
    () => 'fr' as const,
  );
}

type Variables = Record<string, string | number>;

export function t(key: string, variables: Variables = {}) {
  const source = currentLocale === 'en' ? translateEnglish(key) : key;
  return source.replace(/\{(\w+)\}/g, (match, name: string) =>
    variables[name] === undefined ? match : String(variables[name]),
  );
}

function translateEnglish(source: string) {
  const exact = englishMessages[source] ?? englishTemplateMessages[source];
  if (exact) return exact;
  for (const [pattern, translate] of englishRuntimePatterns) {
    const match = source.match(pattern);
    if (match) return translate(match);
  }
  return source;
}

const englishRuntimePatterns: Array<[
  RegExp,
  (match: RegExpMatchArray) => string,
]> = [
  [
    /^« (.+) » dépasse la limite de (.+)\.$/,
    (match) => `“${match[1]}” exceeds the ${match[2]} limit.`,
  ],
  [
    /^(\d+) ingrédients? ajoutés? aux courses\.$/,
    (match) => `${match[1]} ingredient${match[1] === '1' ? '' : 's'} added to shopping.`,
  ],
  [/^Envoi de (\d+)\/(\d+)…$/, (match) => `Uploading ${match[1]}/${match[2]}…`],
  [/^Impossible de finaliser « (.+) »\.$/, (match) => `Unable to finalise “${match[1]}”.`],
  [/^Impossible de préparer « (.+) »\.$/, (match) => `Unable to prepare “${match[1]}”.`],
  [/^Le fichier dépasse la limite de (.+)\.$/, (match) => `The file exceeds the ${match[1]} limit.`],
  [/^Le format de « (.+) » est refusé\.$/, (match) => `The format of “${match[1]}” is not allowed.`],
];

export function formatDate(
  value: Date | number | string,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat(localeTag(), options).format(new Date(value));
}

export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
) {
  return new Intl.NumberFormat(localeTag(), options).format(value);
}

export function formatBinarySize(bytes: number) {
  const units =
    currentLocale === 'en'
      ? ['B', 'KiB', 'MiB', 'GiB']
      : ['o', 'Kio', 'Mio', 'Gio'];
  if (bytes < 1_024) return `${bytes} ${units[0]}`;
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1_024)), 3);
  return `${formatNumber(bytes / 1_024 ** unitIndex, {
    maximumFractionDigits: unitIndex === 1 ? 0 : 1,
  })} ${units[unitIndex]}`;
}

export function compareText(left: string, right: string) {
  return left.localeCompare(right, currentLocale);
}

export function hasTranslation(key: string) {
  return (
    Object.hasOwn(englishMessages, key) ||
    Object.hasOwn(englishTemplateMessages, key)
  );
}
