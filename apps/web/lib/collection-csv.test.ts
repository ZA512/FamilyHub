import { describe, expect, it } from 'vitest';

import {
  collectionCsvTemplate,
  metadataColumnsFromHint,
  parseCollectionCsv,
} from './collection-csv';

let mutationIndex = 0;
const nextMutationId = () =>
  `00000000-0000-4000-8000-${String(++mutationIndex).padStart(12, '0')}`;

describe('collection CSV', () => {
  it('produit un modèle UTF-8 avec les colonnes propres au type', () => {
    const columns = metadataColumnsFromHint('Auteur: …\nISBN: …');
    expect(columns).toEqual(['Auteur', 'ISBN']);
    expect(collectionCsvTemplate(columns)).toBe(
      '\uFEFF"Titre";"Sous-titre";"Description";"Lien";"Image";"Étiquettes";"Auteur";"ISBN"\r\n',
    );
  });

  it('importe les virgules, points-virgules, guillemets et retours à la ligne dans une description', () => {
    const csv = `${collectionCsvTemplate(['Auteur', 'ISBN'])}"Le livre";;"Une histoire, drôle; et ""surprenante""\nà lire";https://example.org/livre;;"famille, lecture";"A. Martin";12345\r\n`;
    const result = parseCollectionCsv(csv, ['Auteur', 'ISBN'], nextMutationId);
    expect(result.errors).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      title: 'Le livre',
      description: 'Une histoire, drôle; et "surprenante"\nà lire',
      tags: ['famille', 'lecture'],
      metadata: { Auteur: 'A. Martin', ISBN: '12345' },
    });
  });

  it('accepte aussi les fichiers séparés par des virgules', () => {
    const csv =
      'Titre,Sous-titre,Description,Lien,Image,Étiquettes\nFilm,,"Drôle, et émouvant",,,"famille, animation"\n';
    const result = parseCollectionCsv(csv, [], nextMutationId);
    expect(result.errors).toEqual([]);
    expect(result.items[0]?.description).toBe('Drôle, et émouvant');
    expect(result.items[0]?.tags).toEqual(['famille', 'animation']);
  });

  it('refuse tout le fichier si une ligne est mal séparée ou invalide', () => {
    const header = collectionCsvTemplate([]);
    const misplacedSeparator = parseCollectionCsv(
      `${header}Valide;;;;;\nInvalide;;description;avec;point-virgule;;\n`,
      [],
      nextMutationId,
    );
    expect(misplacedSeparator.items).toEqual([]);
    expect(misplacedSeparator.errors[0]).toContain('Ligne 3');

    const invalidUrl = parseCollectionCsv(
      `${header}Valide;;;;;\nPiège;;;javascript:alert(1);;\n`,
      [],
      nextMutationId,
    );
    expect(invalidUrl.items).toEqual([]);
    expect(invalidUrl.errors[0]).toContain('Ligne 3');
  });

  it('refuse les en-têtes manquants et les guillemets non fermés', () => {
    expect(
      parseCollectionCsv('Titre;Description\nA;B\n', [], nextMutationId)
        .errors[0],
    ).toContain('Colonnes manquantes');
    expect(
      parseCollectionCsv(
        `${collectionCsvTemplate([])}"Titre non fermé`,
        [],
        nextMutationId,
      ).errors[0],
    ).toContain('guillemet de fermeture');
  });
});
