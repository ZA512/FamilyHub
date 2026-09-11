# Auto-hébergement de FamilyHub

Ce document décrit le contrat du `compose.yaml` livré avec FamilyHub.

## Expérience cible

Un administrateur de NAS doit pouvoir :

1. télécharger `compose.yaml` et `.env.example` depuis une release ;
2. copier `.env.example` vers `.env` et remplacer les secrets signalés ;
3. créer les dossiers ou volumes persistants ;
4. exécuter `docker compose up -d` ;
5. ouvrir FamilyHub derrière le reverse proxy HTTPS de son NAS ;
6. créer le premier foyer et son administrateur depuis l'écran de première configuration.

Aucun outil de compilation, dépôt Git, compte cloud ou service SaaS ne doit être requis.

## Services prévus

### `app`

- image versionnée publiée sur GHCR pour `linux/amd64` et `linux/arm64` ;
- utilisateur non-root ;
- système de fichiers racine en lecture seule si compatible avec le runtime ;
- port interne `3000` ;
- volume `/data/attachments` ;
- healthchecks `/api/v1/health/live` et `/api/v1/health/ready` ;
- arrêt gracieux avant le délai Docker ;
- migrations automatiques verrouillées au démarrage.

### `db`

- PostgreSQL avec version majeure épinglée ;
- volume séparé pour les données ;
- réseau interne sans port publié par défaut ;
- healthcheck `pg_isready` ;
- mot de passe fourni uniquement par l'environnement ou un secret Docker.

### `proxy` facultatif

Un profil Compose optionnel pourra fournir Caddy pour une machine sans reverse proxy. Sur
Synology, QNAP, Unraid ou TrueNAS déjà configuré, l'utilisateur publie uniquement le port de
`app` sur le LAN et termine TLS avec l'outil du NAS.

## Volumes et ports

```text
familyhub_db_data       données PostgreSQL
familyhub_attachments   fichiers originaux importés
familyhub_caddy_data    certificats, seulement avec le profil proxy
```

Le port hôte sera configurable (`FAMILYHUB_PORT`, valeur proposée `3080`). PostgreSQL ne sera
pas exposé sur l'hôte dans la configuration de production.

## Configuration minimale

```dotenv
FAMILYHUB_VERSION=1.0.0
FAMILYHUB_PORT=3080
FAMILYHUB_ORIGIN=https://famille.example.net
FAMILYHUB_TIMEZONE=Europe/Paris
POSTGRES_DB=familyhub
POSTGRES_USER=familyhub
POSTGRES_PASSWORD=replace-with-a-long-random-secret
SESSION_SECRET=replace-with-a-different-long-random-secret
SETUP_TOKEN=replace-with-a-one-time-setup-token
```

Les secrets n'ont aucune valeur par défaut utilisable. Le démarrage échoue avec un message
clair si un secret exemple, trop court ou identique à un autre est détecté.
Utilisez pour `POSTGRES_PASSWORD` une valeur aléatoire d'au moins 32 caractères compatible
avec une URL (lettres, chiffres, tirets et underscores), car elle est injectée dans la chaîne
de connexion interne de l'application.

`MAX_UPLOAD_BYTES` fixe la taille maximale d'un fichier (25 Mio par défaut). Les pièces
jointes du chat acceptent les images JPEG, PNG, GIF et WebP, les PDF, les fichiers texte,
CSV et JSON, les archives ZIP et les formats bureautiques DOCX, XLSX et PPTX. Leur type
binaire réel est contrôlé avant publication et leur empreinte SHA-256 est conservée en base.

Configuration complémentaire prévue : quota global par foyer, SMTP, Web Push, durée de
session, niveau de logs, UID/GID lorsque le NAS utilise des bind mounts, et backend S3
optionnel.

## Réseau et HTTPS

`FAMILYHUB_ORIGIN` est la seule origine canonique. L'application refuse les en-têtes proxy
non fiables. Une liste explicite de proxys de confiance permet de reconstruire correctement
l'adresse client et le protocole. HTTPS est obligatoire hors accès local de développement.

Les WebSockets doivent être activés dans le reverse proxy. Les cookies restent `Secure` dès
que l'origine canonique est HTTPS.

## Sauvegarde

Une sauvegarde cohérente comprend toujours :

- un dump PostgreSQL au format custom ;
- le contenu du volume de pièces jointes ;
- un petit manifeste indiquant version de FamilyHub, version du schéma et date UTC.

Le dépôt fournira des scripts qui écrivent dans un dossier choisi par l'utilisateur, sans
supprimer automatiquement les anciennes sauvegardes. La rétention relève du NAS ou d'un
outil explicitement configuré.

La restauration se fait dans une instance arrêtée et vide, puis vérifie les hashes des
pièces jointes et la version de schéma avant remise en ligne. Un test automatisé réalisera
un cycle sauvegarde/restauration avec des données de démonstration.

## Mise à jour et retour arrière

La documentation de release indiquera :

1. lire les notes et sauvegarder ;
2. modifier `FAMILYHUB_VERSION` vers une version précise ;
3. exécuter `docker compose pull` puis `docker compose up -d` ;
4. vérifier `/api/v1/health/ready` et la version affichée.

`latest` pourra exister pour l'essai, mais les exemples de production utiliseront une
version immuable. Un retour à l'image précédente n'est sûr que si sa version de schéma est
compatible ; sinon la procédure documentée restaure la sauvegarde complète.

## Journalisation et exploitation

- Logs structurés sur stdout/stderr, sans contenu de message, mot de passe, jeton ou fichier.
- Rotation confiée au moteur Docker avec limites conseillées dans Compose.
- Endpoint de santé sans détail sensible et endpoint de diagnostic réservé aux admins.
- Arrêt du conteneur si PostgreSQL est trop ancien, inaccessible ou si les migrations ont
  échoué.
- Taille maximale contrôlée avant et pendant chaque écriture ; quotas globaux et contrôle
  préventif de l'espace libre restent à ajouter.
