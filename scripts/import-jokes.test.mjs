import { describe, expect, it } from 'vitest';

import { mergeJokes, parseJokeSource } from './import-jokes.mjs';

const page = (body) => `Logo Loisirs & Divertissements
Adultes (227)
🤣 Histoires de la catégorie Belges
Cette catégorie contient plusieurs pages de blagues. Utilisez la pagination pour découvrir l’ensemble des histoires disponibles.

${body}

Envie de découvrir d’autres styles d’humour ?
Vous avez vu 51 blagues sur 51
© 2017–2026 Loisirs & Divertissements`;

describe('import de blagues', () => {
  it('garde seulement le texte complet et la catégorie du JSON fourni', () => {
    expect(
      parseJokeSource(
        JSON.stringify([
          {
            text: 'Question ? Réponse.',
            type: 'devinette',
            id: 'source-id',
            explanation: 'Explication',
          },
          { setup: 'Mon premier…', answer: 'Un château.', type: 'charade' },
          { text: 'Un texte simple.', category: 'Carambars' },
        ]),
      ),
    ).toEqual([
      { text: 'Question ? Réponse.', category: 'Devinettes' },
      { text: 'Mon premier…\nUn château.', category: 'Charades' },
      { text: 'Un texte simple.', category: 'Carambars' },
    ]);
  });

  it('retire les menus et le pied de page et rattache les réponses séparées', () => {
    expect(
      parseJokeSource(
        page(`Pourquoi le ski nautique ?

R. : Pas de lac en pente.

Une autre question ?
- Une réponse.

- Savez-vous pourquoi ?

- Parce que.

Une histoire sans chute :`),
      ),
    ).toEqual([
      { text: 'Pourquoi le ski nautique ?\nR. : Pas de lac en pente.', category: 'Belges' },
      { text: 'Une autre question ?\n- Une réponse.', category: 'Belges' },
      { text: '- Savez-vous pourquoi ?\n- Parce que.', category: 'Belges' },
    ]);
  });

  it('déduplique les captures répétées et les différences de mise en forme', () => {
    const first = [{ text: 'C’est une blague.\nUne chute.', category: 'Divers' }];
    const second = [{ text: "C'est une blague. Une chute.", category: 'Belges' }];
    expect(mergeJokes([first, first, second])).toEqual(first);
  });

  it('refuse les formats inconnus et les entrées vides', () => {
    expect(() => parseJokeSource('Menu et publicité')).toThrow('non reconnu');
    expect(() => parseJokeSource('[{"title":"Sans texte"}]')).toThrow('ne contient pas');
  });
});
