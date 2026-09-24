import {
  collectionItemCreateSchema,
  type CollectionItemCreate,
} from '@familyhub/contracts';

export const MAX_COLLECTION_CSV_ROWS = 200;
export const MAX_COLLECTION_CSV_BYTES = 1_000_000;

const commonColumns = [
  'Titre',
  'Sous-titre',
  'Description',
  'Lien',
  'Image',
  'Étiquettes',
] as const;

type CsvRow = { cells: string[]; line: number };

export type CollectionCsvResult = {
  items: CollectionItemCreate[];
  errors: string[];
};

export function metadataColumnsFromHint(hint: string): string[] {
  return hint
    .split('\n')
    .map((line) => line.split(':')[0]!.trim())
    .filter(Boolean);
}

export function collectionCsvTemplate(metadataColumns: string[]): string {
  const headers = [...commonColumns, ...metadataColumns];
  return `\uFEFF${headers.map(csvCell).join(';')}\r\n`;
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizedHeader(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('fr-FR');
}

function delimiterFromHeader(text: string): ',' | ';' {
  let quoted = false;
  let commas = 0;
  let semicolons = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && (character === '\r' || character === '\n')) {
      break;
    } else if (!quoted && character === ',') commas += 1;
    else if (!quoted && character === ';') semicolons += 1;
  }
  if (semicolons === 0 && commas === 0)
    throw new Error('Séparateur CSV introuvable. Utilisez « ; » ou « , ».');
  return semicolons >= commas ? ';' : ',';
}

function parseRows(text: string, delimiter: ',' | ';'): CsvRow[] {
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  let line = 1;
  let rowLine = 1;

  function finishRow() {
    cells.push(field);
    if (cells.some((cell) => cell.trim())) rows.push({ cells, line: rowLine });
    cells = [];
    field = '';
    afterQuote = false;
    rowLine = line + 1;
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else if (character === '\r' || character === '\n') {
        if (character === '\r' && text[index + 1] === '\n') index += 1;
        field += '\n';
        line += 1;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      if (field || afterQuote)
        throw new Error(`Ligne ${line} : guillemet inattendu.`);
      quoted = true;
    } else if (character === delimiter) {
      cells.push(field);
      field = '';
      afterQuote = false;
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      finishRow();
      line += 1;
    } else if (afterQuote) {
      if (character !== ' ' && character !== '\t') {
        throw new Error(
          `Ligne ${line} : texte après un champ entre guillemets.`,
        );
      }
    } else {
      field += character;
    }
  }
  if (quoted)
    throw new Error(`Ligne ${rowLine} : guillemet de fermeture manquant.`);
  if (cells.length || field || afterQuote) finishRow();
  return rows;
}

export function parseCollectionCsv(
  source: string,
  metadataColumns: string[],
  mutationId: () => string = () => crypto.randomUUID(),
): CollectionCsvResult {
  const text = source.replace(/^\uFEFF/u, '');
  if (text.includes('\uFFFD')) {
    return { items: [], errors: ['Le fichier doit être encodé en UTF-8.'] };
  }
  let rows: CsvRow[];
  try {
    rows = parseRows(text, delimiterFromHeader(text));
  } catch (reason) {
    return {
      items: [],
      errors: [reason instanceof Error ? reason.message : 'CSV invalide.'],
    };
  }
  if (!rows.length) return { items: [], errors: ['Le fichier est vide.'] };

  const expected = [...commonColumns, ...metadataColumns];
  const headers = rows[0]!.cells.map(normalizedHeader);
  const expectedHeaders = expected.map(normalizedHeader);
  const missing = expected.filter(
    (name) => !headers.includes(normalizedHeader(name)),
  );
  const unexpected = rows[0]!.cells.filter(
    (name) => !expectedHeaders.includes(normalizedHeader(name)),
  );
  const duplicates = headers.filter(
    (name, index) => headers.indexOf(name) !== index,
  );
  const errors: string[] = [];
  if (missing.length)
    errors.push(`Colonnes manquantes : ${missing.join(', ')}.`);
  if (unexpected.length)
    errors.push(`Colonnes inconnues : ${unexpected.join(', ')}.`);
  if (duplicates.length)
    errors.push('Le fichier contient des colonnes répétées.');
  if (errors.length) return { items: [], errors };

  const dataRows = rows.slice(1);
  if (!dataRows.length)
    return {
      items: [],
      errors: ['Ajoutez au moins une ligne sous les en-têtes.'],
    };
  if (dataRows.length > MAX_COLLECTION_CSV_ROWS) {
    return {
      items: [],
      errors: [`Limite de ${MAX_COLLECTION_CSV_ROWS} lignes par import.`],
    };
  }

  const cellsAt = (row: CsvRow, name: string) =>
    row.cells[headers.indexOf(normalizedHeader(name))]?.trim() ?? '';
  const items: CollectionItemCreate[] = [];
  for (const row of dataRows) {
    if (row.cells.length !== headers.length) {
      errors.push(
        `Ligne ${row.line} : ${row.cells.length} cellules au lieu de ${headers.length}. Vérifiez les séparateurs et les guillemets.`,
      );
      continue;
    }
    const metadata: Record<string, string> = {};
    for (const name of metadataColumns) {
      const value = cellsAt(row, name);
      if (value) metadata[name] = value;
    }
    const parsed = collectionItemCreateSchema.safeParse({
      title: cellsAt(row, 'Titre'),
      subtitle: cellsAt(row, 'Sous-titre'),
      description: cellsAt(row, 'Description'),
      url: cellsAt(row, 'Lien'),
      imageUrl: cellsAt(row, 'Image'),
      tags: cellsAt(row, 'Étiquettes')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      metadata,
      clientMutationId: mutationId(),
    });
    if (parsed.success) items.push(parsed.data);
    else
      errors.push(
        `Ligne ${row.line} : ${parsed.error.issues.map((issue) => `${issue.path.join('.') || 'champ'} ${issue.message}`).join(' ; ')}`,
      );
  }
  return errors.length
    ? { items: [], errors: errors.slice(0, 10) }
    : { items, errors: [] };
}
