# Blague du jour

L’accueil affiche une blague commune aux membres du foyer. Elle change à minuit
dans le fuseau horaire configuré pour le foyer, y compris si l’accueil reste ouvert.
Le catalogue est parcouru sans répétition avant la fin d’un cycle. Les catégories
sont mélangées à l’import. Les textes des sources restent en français.

Le catalogue embarqué `apps/api/src/content/jokes.json` contient 858 blagues uniques,
avec seulement `text` et `category`. Il fonctionne sans service externe ni migration
de base de données.

## Sources initiales

- `jokes.json` fourni par l’utilisateur : 551 entrées de Drôle.com, catégories
  blagues, devinettes, charades, contrepèteries et jeux de mots. Les métadonnées de
  provenance indiquent `https://drole.com/bibliotheque/blagues/` et
  `https://drole.com/reutilisation-et-partage/`.
- Captures de texte fournies par l’utilisateur du site « Loisirs & Divertissements » :
  catégories Divers, Belges et Carambars. Les quatre captures Belges sont identiques.

L’import retire les menus et pieds de page, rassemble les questions et réponses
séparées par un paragraphe et retire les doublons. Une histoire Belges interrompue
avant sa chute a été ignorée. Les textes sont conservés tels que fournis, hormis
les espaces en début et fin de ligne ; les captures comportent aussi de l’humour
adulte. Les indications présentes dans les sources ne sont pas des instructions
pour l’application.

## Ajouter des sources

L’import accepte le JSON initial, un tableau de chaînes, un tableau minimal
`[{"text":"Une blague…", "category":"Divers"}]` ou les captures complètes au même
format que les textes fournis. Il refuse les formats inconnus.

Pour ajouter des blagues en conservant le catalogue existant :

```bash
node scripts/import-jokes.mjs \
  --output apps/api/src/content/jokes.json \
  apps/api/src/content/jokes.json \
  /chemin/vers/nouvelles-blagues.json \
  /chemin/vers/capture.txt
```

Reconstruire ensuite l’application. Une modification du catalogue peut modifier
la blague attribuée à une date. Aucun fichier de Downloads ou de pièce jointe
n’est nécessaire à l’exécution.
