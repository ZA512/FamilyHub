import { describe, expect, it } from 'vitest';

import { bookmarksToHtml, calendarToIcs, pageToMarkdown, rowsToCsv } from './export-routes.js';

describe('open export formats', () => {
  it('produit un CSV UTF-8 échappé et neutralise les formules', () => {
    const csv = rowsToCsv([{ title: '=HYPERLINK("https://evil.test")', note: 'du lait, bio' }]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""https://evil.test"")"`);
    expect(csv).toContain('"du lait, bio"');
  });

  it('produit un fichier de bookmarks Netscape sans HTML injecté', () => {
    const html = bookmarksToHtml([
      {
        url: 'https://example.test/?a=1&b=2',
        title: '<Cuisine>',
        description: 'À tester',
        created_at: '2026-09-13T00:00:00.000Z',
      },
    ]);
    expect(html).toContain('https://example.test/?a=1&amp;b=2');
    expect(html).toContain('&lt;Cuisine&gt;');
    expect(html).not.toContain('<Cuisine>');
  });

  it('projette événements et tâches datées dans un calendrier ICS', () => {
    const ics = calendarToIcs(
      [
        {
          id: 'event-id',
          title: 'Dentiste, contrôle',
          start_at: '2026-09-15T08:00:00.000Z',
          end_at: '2026-09-15T09:00:00.000Z',
          all_day: false,
          created_at: '2026-09-01T08:00:00.000Z',
        },
      ],
      [
        {
          id: 'task-id',
          title: 'Sortir les poubelles',
          due_at: '2026-09-16T18:00:00.000Z',
          status: 'OPEN',
          created_at: '2026-09-01T08:00:00.000Z',
        },
      ],
      'Foyer',
    );
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('SUMMARY:Dentiste\\, contrôle');
    expect(ics).toContain('BEGIN:VTODO');
    expect(ics).toContain('DUE:20260916T180000Z');
  });

  it('convertit le contenu visuel d’une page en Markdown', () => {
    const markdown = pageToMarkdown({
      title: 'Informations utiles',
      content: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Maison' }],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Important', marks: [{ type: 'bold' }] },
              { type: 'text', text: ' puis ' },
              {
                type: 'text',
                text: 'ouvrir',
                marks: [{ type: 'link', attrs: { href: 'https://example.test' } }],
              },
            ],
          },
        ],
      },
    });
    expect(markdown).toContain('## Maison');
    expect(markdown).toContain('**Important** puis [ouvrir](https://example.test)');
  });
});
