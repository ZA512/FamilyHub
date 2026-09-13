# FamilyHub

[![CI](https://github.com/ZA512/FamilyHub/actions/workflows/ci.yml/badge.svg)](https://github.com/ZA512/FamilyHub/actions/workflows/ci.yml)

FamilyHub est une PWA privée pour organiser la vie d'un foyer ou d'un petit groupe. Le
projet est en cours de construction à partir du PRD disponible dans `docs/`.

## Lancer le socle en local

Prérequis : Node.js 22+ et PostgreSQL 16+.

```bash
npm install
cp .env.example .env
# Démarrez PostgreSQL localement, puis adaptez DATABASE_URL si nécessaire.
npm run db:migrate
npm run dev:api
npm run dev:web
```

L'interface de développement écoute sur `http://localhost:5173` et l'API sur
`http://localhost:3001`.

## Lancer avec Docker Compose

Avec l'image publiée :

```bash
cp .env.example .env
docker compose up -d
```

Pour construire l'image depuis les sources :

```bash
docker compose -f compose.yaml -f compose.build.yaml up --build -d
```

Remplacez impérativement les trois secrets `change-me` avant le démarrage. FamilyHub est
ensuite accessible sur `http://localhost:3080` par défaut. En production, placez cette
adresse derrière le reverse proxy HTTPS du NAS.

Consultez `docs/SELF_HOSTING.md` pour le contrat d'exploitation et
`docs/TECHNICAL_DESIGN.md` pour l'architecture validée.

Sauvegarde rapide : `./scripts/backup.sh /chemin/vers/les/sauvegardes` sous Linux/NAS ou
`./scripts/backup.ps1 -OutputDirectory D:\Backups\FamilyHub` sous PowerShell. Les exports
personnels et administrateur sont également disponibles dans l'écran Paramètres.
Les notifications Web Push et l’envoi SMTP des invitations sont optionnels ; leur
configuration est documentée dans le guide d'auto-hébergement.

## Intégration continue et images

Chaque push et pull request exécute les tests, le lint, le typage et le build de production.
Chaque push publie aussi une image Docker `linux/amd64` + `linux/arm64` avec un tag de branche
et un tag immuable `sha-…` ; `main` met également à jour `latest`. Les pull requests vérifient
la construction Docker sans la publier. Un tag Git `vX.Y.Z` publie en plus les tags `X.Y.Z`
et `X.Y` sur `ghcr.io/za512/familyhub`.
