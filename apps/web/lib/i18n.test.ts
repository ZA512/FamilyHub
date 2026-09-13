import { afterEach, describe, expect, it } from 'vitest';

import { formatBinarySize, localeTag, setLocale, t } from './i18n';

afterEach(() => setLocale('fr'));

describe('i18n', () => {
  it('keeps the French source copy in French', () => {
    setLocale('fr');
    expect(t('Ajouter un événement')).toBe('Ajouter un événement');
    expect(localeTag()).toBe('fr-FR');
  });

  it('translates fixed and parameterized English copy', () => {
    setLocale('en');
    expect(t('Ajouter un événement')).toBe('Add event');
    expect(t('Invitation envoyée à {0}.', { 0: 'jade@example.com' })).toBe(
      'Invitation sent to jade@example.com.',
    );
    expect(localeTag()).toBe('en-GB');
  });

  it('formats binary units using the selected language', () => {
    setLocale('fr');
    expect(formatBinarySize(1_048_576)).toBe('1 Mio');
    setLocale('en');
    expect(formatBinarySize(1_048_576)).toBe('1 MiB');
  });
});
