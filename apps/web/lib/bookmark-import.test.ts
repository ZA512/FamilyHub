import { describe, expect, it } from 'vitest';

import { parseBookmarkImport } from './bookmark-import';

describe('parseBookmarkImport', () => {
  it('preserves a FamilyHub export', () => {
    const payload = {
      bookmarks: [{ url: 'https://example.com', title: 'Exemple' }],
      tags: [],
      resourceTags: [],
    };
    expect(parseBookmarkImport(JSON.stringify(payload))).toEqual(payload);
  });

  it('reads nested browser JSON exports and removes duplicates', () => {
    const result = parseBookmarkImport(
      JSON.stringify({
        roots: {
          toolbar: {
            children: [
              { name: 'Docs', url: 'https://example.com/docs#intro' },
              { title: 'Docs bis', uri: 'https://example.com/docs' },
              { name: 'Interne', url: 'javascript:alert(1)' },
            ],
          },
        },
      }),
    );
    expect(result.bookmarks).toEqual([
      { title: 'Docs bis', url: 'https://example.com/docs' },
    ]);
  });

  it('reads Netscape HTML exports and decodes titles', () => {
    const result = parseBookmarkImport(
      '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><A HREF="https://example.org/a">À lire &amp; garder</A>',
    );
    expect(result.bookmarks).toEqual([
      { title: 'À lire & garder', url: 'https://example.org/a' },
    ]);
  });

  it('rejects files without usable web links', () => {
    expect(() => parseBookmarkImport('{"roots":{}}')).toThrow(
      'Aucun lien web valide',
    );
  });
});
