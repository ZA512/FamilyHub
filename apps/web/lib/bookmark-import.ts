export type BookmarkImportPayload = {
  bookmarks: Array<{
    id?: string;
    url: string;
    title: string;
    description?: string | null;
    personal_comment?: string | null;
    personalComment?: string | null;
    favicon_url?: string | null;
    og_image_url?: string | null;
  }>;
  tags: Array<{ id: string; name: string }>;
  resourceTags: Array<{ resource_id: string; tag_id: string }>;
};

function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return value.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (match, entity: string) => {
      if (entity.startsWith('#x'))
        return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      if (entity.startsWith('#'))
        return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      return named[entity.toLowerCase()] ?? match;
    },
  );
}

function cleanTitle(value: string) {
  return decodeHtml(
    value
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function normalizeCandidate(urlValue: unknown, titleValue: unknown) {
  if (typeof urlValue !== 'string') return null;
  try {
    const url = new URL(decodeHtml(urlValue));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    const title = typeof titleValue === 'string' ? cleanTitle(titleValue) : '';
    return { url: url.href, title: (title || url.hostname).slice(0, 200) };
  } catch {
    return null;
  }
}

function collectedPayload(candidates: Array<{ url: string; title: string }>) {
  const unique = new Map(
    candidates.map((bookmark) => [bookmark.url, bookmark]),
  );
  const bookmarks = [...unique.values()].slice(0, 1_000);
  if (!bookmarks.length)
    throw new Error('Aucun lien web valide n’a été trouvé.');
  return {
    bookmarks,
    tags: [],
    resourceTags: [],
  } satisfies BookmarkImportPayload;
}

function parseJson(text: string): BookmarkImportPayload {
  const source = JSON.parse(text) as unknown;
  if (
    typeof source === 'object' &&
    source !== null &&
    'bookmarks' in source &&
    Array.isArray(source.bookmarks)
  ) {
    return source as BookmarkImportPayload;
  }

  const candidates: Array<{ url: string; title: string }> = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const record = value as Record<string, unknown>;
    const candidate = normalizeCandidate(
      record.url ?? record.uri,
      record.name ?? record.title,
    );
    if (candidate) candidates.push(candidate);
    Object.values(record).forEach(visit);
  };
  visit(source);
  return collectedPayload(candidates);
}

function parseNetscapeHtml(text: string): BookmarkImportPayload {
  const candidates: Array<{ url: string; title: string }> = [];
  const anchorPattern =
    /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(text))) {
    const candidate = normalizeCandidate(match[2], match[3]);
    if (candidate) candidates.push(candidate);
  }
  return collectedPayload(candidates);
}

export function parseBookmarkImport(text: string): BookmarkImportPayload {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Le fichier est vide.');
  try {
    return trimmed.startsWith('<')
      ? parseNetscapeHtml(trimmed)
      : parseJson(trimmed);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'Aucun lien web valide n’a été trouvé.'
    ) {
      throw error;
    }
    throw new Error(
      'Format non reconnu. Utilisez un export HTML ou JSON de favoris.',
    );
  }
}
