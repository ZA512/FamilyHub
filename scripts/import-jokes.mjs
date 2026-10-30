import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const categoryLabels = {
  blague: 'Blagues',
  devinette: 'Devinettes',
  charade: 'Charades',
  contrepeterie: 'Contrepèteries',
  'jeu-de-mots': 'Jeux de mots',
};

function cleanText(value) {
  return typeof value === 'string'
    ? value
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        .trim()
    : '';
}

export function jokeKey(text) {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase('fr')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// These sources are content only: navigation, footers and editorial instructions
// from a pasted page never become jokes or application instructions.
export function parseJokeSource(input) {
  const source = input.replace(/^\uFEFF/, '').trim();
  if (source.startsWith('[') || source.startsWith('{')) {
    const data = JSON.parse(source);
    if (!Array.isArray(data)) throw new Error('Le JSON doit contenir une liste de blagues.');
    return data.map((entry) => {
      const text =
        typeof entry === 'string'
          ? cleanText(entry)
          : cleanText(entry?.text) ||
            [cleanText(entry?.setup), cleanText(entry?.answer)].filter(Boolean).join('\n');
      const type = cleanText(entry?.category) || cleanText(entry?.type) || 'Divers';
      if (!text) throw new Error('Une entrée JSON ne contient pas de blague.');
      return { text, category: categoryLabels[type] ?? type };
    });
  }

  const category = source.match(/🤣 Histoires de la catégorie ([^\n]+)/)?.[1]?.trim();
  const marker =
    'Cette catégorie contient plusieurs pages de blagues. Utilisez la pagination pour découvrir l’ensemble des histoires disponibles.';
  const start = source.indexOf(marker);
  const end = source.indexOf('Envie de découvrir', start);
  if (!category || start < 0 || end < 0) {
    throw new Error(
      'Texte de page non reconnu : utilisez une capture complète ou un JSON de blagues.',
    );
  }
  const chunks = source
    .slice(start + marker.length, end)
    .trim()
    .split(/\n\s*\n/);
  const jokes = [];
  for (const chunk of chunks) {
    const text = cleanText(chunk);
    if (!text) continue;
    const previous = jokes.at(-1);
    // Some captures put a blank line between a question and its answer.
    if (
      previous?.text.endsWith('?') &&
      (/^R\s*[.:]/i.test(text) ||
        (!text.includes('\n') && /^-\s/.test(text) && !text.endsWith('?')))
    ) {
      previous.text += `\n${text}`;
    } else if (!text.endsWith(':')) {
      // An unfinished introduction has lost its punchline in the source.
      jokes.push({ text, category });
    }
  }
  return jokes;
}

export function mergeJokes(sources) {
  const unique = new Map();
  for (const jokes of sources) {
    for (const joke of jokes) {
      const key = jokeKey(joke.text);
      if (!unique.has(key)) unique.set(key, joke);
    }
  }
  // Mix categories deterministically so the daily rotation does not spend months
  // on a single source. The catalog itself keeps just the text and category.
  const hash = (joke) => createHash('sha256').update(jokeKey(joke.text)).digest('hex');
  return [...unique.values()].sort((left, right) => hash(left).localeCompare(hash(right)));
}

async function main() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--output');
  if (outputIndex < 0 || !args[outputIndex + 1]) {
    throw new Error(
      'Usage : node scripts/import-jokes.mjs --output catalogue.json source.json capture.txt …',
    );
  }
  const output = resolve(args.splice(outputIndex, 2)[1]);
  if (!args.length) throw new Error('Ajoutez au moins un fichier source.');
  const sources = await Promise.all(
    args.map(async (path) => parseJokeSource(await readFile(path, 'utf8'))),
  );
  const jokes = mergeJokes(sources);
  if (!jokes.length) throw new Error('Aucune blague à importer.');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(jokes, null, 2)}\n`);
  console.log(
    `${jokes.length} blagues uniques importées (${sources.flat().length - jokes.length} doublons retirés).`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
