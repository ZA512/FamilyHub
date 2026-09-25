# Musique — faisabilité et mise en service

Le PRD `MUSIC_PRD.md` est réalisable avec l'architecture actuelle : React/Vite, API Fastify, PostgreSQL et sessions serveur. Le backend lit le secret de l'application depuis l'environnement et chiffre les jetons de renouvellement enregistrés en base ; le navigateur ne reçoit que des données musicales filtrées par foyer. Le partage est désactivé par défaut et peut être modifié indépendamment de la connexion Spotify.

Le dépôt ne contient aucun jeton développeur Spotify. Chaque installation renseigne les identifiants de sa propre application Spotify dans `.env` (ignoré par Git et par le contexte de construction Docker). Le `client_secret` et les jetons de renouvellement restent côté serveur ; chaque membre autorise séparément son compte par OAuth. Le `client_id` apparaît nécessairement dans l'URL d'autorisation Spotify et n'est pas un secret. Le jeton temporaire affiché dans le tutoriel du portail développeur ne remplace pas cette configuration.

## Mise en service

Le parcours complet pour le propriétaire de l'application, les cinq comptes du foyer et le NAS est décrit dans [Configurer Spotify pour FamilyHub](SPOTIFY_SETUP.md).

1. Créer une application dans le [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Ajouter exactement l'URI `https://votre-domaine/api/v1/music/spotify/callback` aux redirect URIs Spotify. En développement local, utiliser une origine `http://127.0.0.1:PORT` pour FamilyHub et l'URI de retour ; `localhost` n'est pas accepté par Spotify.
3. Définir `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_TOKEN_ENCRYPTION_KEY` (32 octets hexadécimaux) et `SPOTIFY_REDIRECT_URI` dans `.env`, puis redémarrer l'application. Garder la clé de chiffrement stable : la changer rend les connexions existantes illisibles et impose leur reconnexion.
4. En développement direct, exécuter les migrations avec `npm run db:migrate`. Dans l'image Docker, elles sont exécutées au démarrage. Pour tester les changements locaux avec Compose, utiliser `docker compose -f compose.yaml -f compose.build.yaml up --build` ; `compose.yaml` seul récupère l'image publiée et ne contient pas les modifications locales.
5. En mode développement Spotify, ajouter chaque compte participant à l'allowlist. Le propriétaire de l'application doit avoir Spotify Premium. La lecture à distance demande aussi Premium pour le membre qui la lance.

### Instance familyhub.jateroka.fr

L'application Spotify FamilyHub est enregistrée avec l'URI de retour `https://familyhub.jateroka.fr/api/v1/music/spotify/callback`. Cette route n'a pas besoin de répondre lors de l'enregistrement sur le portail Spotify ; elle doit répondre après le déploiement, au moment où un membre autorise son compte.

Sur le NAS, mettre à jour les sources contenant `compose.yaml` et renseigner dans le `.env` **du NAS** `FAMILYHUB_ORIGIN=https://familyhub.jateroka.fr` ainsi que les quatre variables `SPOTIFY_*` ci-dessus. Le fichier `.env.spotify.production` conservé uniquement sur le poste de développement peut servir à transférer ces quatre valeurs de façon privée ; il n'est ni publié par Git ni copié automatiquement sur le NAS. Garder le même `SPOTIFY_TOKEN_ENCRYPTION_KEY` lors des mises à jour.

Une fois la version Musique publiée dans l'image `latest`, exécuter `docker compose pull app` puis `docker compose up -d` depuis le répertoire Compose du NAS. L'image applique la migration de base de données au démarrage. Vérifier ensuite que la page `/music` s'ouvre sous le domaine HTTPS, puis connecter chaque compte depuis cette page. Une réponse HTTP 401 de `/api/v1/music/spotify/status` sans session est normale ; une réponse 404 indique que l'ancienne version tourne encore.

## Comportement livré

- Connexion Authorization Code avec `state` lié à la session et à usage unique, refresh token chiffré AES-256-GCM et scopes limités au PRD.
- Synchronisation paginée de `/me/tracks`, au premier lien puis périodiquement, avec déclenchement manuel limité, traitement des 429 et suppression des favoris retirés. Une synchronisation incomplète ne remplace pas les données locales précédentes.
- Agrégation locale des artistes, découvertes, artistes communs, nouveaux artistes, fiche artiste, exploration par membre, sélection hebdomadaire persistée et équitable, ouverture des titres dans Spotify et commande de lecture sur un appareil actif.
- Partage familial désactivé par défaut ; les artistes et morceaux privés d'un autre membre ne sont jamais renvoyés par les routes Musique. La déconnexion retire le credential et les favoris du membre et supprime les données musicales devenues orphelines.

## Limites externes et arbitrage produit

- Le mode développement Spotify est limité à cinq comptes Spotify authentifiés, propriétaire inclus s'il relie son compte à FamilyHub. Le propriétaire doit également être ajouté à « User Management » pour utiliser l'application. Ce plafond est externe à FamilyHub et n'est pas codé comme une limite de membres du foyer.
- Spotify exige une redirect URI HTTPS hors adresses loopback. L'application doit donc être servie sous HTTPS sur le NAS ou un domaine public pour un vrai usage multi-appareils.
- Les refresh tokens Spotify expirent au bout de 180 jours. FamilyHub retire la connexion et les favoris locaux si Spotify répond `invalid_grant` au renouvellement ; le membre peut ensuite reconnecter son compte pour réimporter ses favoris.
- Le PRD demande à la fois une sélection FamilyHub sans création de playlist Spotify et un lien ouvrant toute la sélection dans Spotify. Spotify ne fournit pas de lien direct vers une liste arbitraire de titres. FamilyHub peut lancer cette liste via l'API de lecture sur un appareil actif ; le fallback ouvre un titre individuel. Un lien vers la sélection entière nécessiterait la création d'une playlist Spotify, exclue de la V1.
- L'API des favoris fournit des images d'albums, pas des portraits d'artistes ; les cartes utilisent une pochette représentative.

## Validation restante avant usage réel

Le typage, le lint, le build et les 186 tests automatisés passent. La migration `0021_music.sql` a été appliquée sur un PostgreSQL 16 jetable ; un scénario SQL avec cinq membres a confirmé l'agrégation de dix titres, la stabilité de la sélection hebdomadaire et le retrait des titres d'un membre dès la désactivation du partage.

Il reste à vérifier avec l'application Spotify et les comptes du foyer : le retour OAuth sous l'URL HTTPS définitive, l'import réel des favoris, la synchronisation et la lecture sur un appareil actif. Ces essais nécessitent `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, la clé de chiffrement et une origine FamilyHub accessible aux cinq membres.
