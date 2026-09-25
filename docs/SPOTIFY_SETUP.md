# Configurer Spotify pour FamilyHub

Ce guide s'adresse à la personne qui administre FamilyHub. **Une seule personne crée l'application sur le portail Spotify** ; les autres membres utilisent leurs comptes Spotify habituels. Ils n'ont pas besoin de créer un compte développeur. Chaque membre relie ensuite son compte dans FamilyHub et garde le contrôle de son partage musical.

## Comprendre les cinq places

Une application Spotify en mode développement accepte **cinq comptes Spotify authentifiés au total**. Le compte qui a créé l'application ne prend pas une place parce qu'il est connecté au Developer Dashboard. **S'il relie son propre compte à FamilyHub, il prend une des cinq places et doit figurer dans « User Management ».** Pour un foyer de cinq personnes dont le propriétaire fait partie, ajoutez donc le propriétaire et les quatre autres membres. Le compteur « 0/5 » signifie qu'aucun compte n'a encore été ajouté à cette liste ; il ne réserve pas automatiquement une place au propriétaire.

Ces places concernent les comptes **Spotify**, pas les comptes FamilyHub. Une adresse utilisée pour FamilyHub peut être différente de celle du compte Spotify. Le propriétaire de l'application doit conserver un abonnement Spotify Premium actif pour que l'application en mode développement fonctionne. La lecture à distance nécessite aussi Premium pour le compte qui la lance. Voir les [règles officielles du mode développement et de la liste des utilisateurs](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).

## 1. Créer l'application Spotify

1. Connectez-vous avec le compte Spotify Premium du propriétaire sur le [Developer Dashboard](https://developer.spotify.com/dashboard).
2. Créez une application et sélectionnez **Web API**. Le portail peut demander l'acceptation des conditions développeur.
3. Renseignez l'adresse HTTPS de FamilyHub dans « Website » et ajoutez exactement `https://votre-domaine/api/v1/music/spotify/callback` dans « Redirect URIs ». Pour notre instance, l'adresse est `https://familyhub.jateroka.fr/api/v1/music/spotify/callback`.
4. Enregistrez et relevez le **Client ID** et le **Client Secret** dans les paramètres de l'application. Ne publiez jamais le Client Secret dans Git, une issue ou un message public.

L'application « FamilyHub » de notre instance a déjà été créée avec la bonne URI de retour. La route de retour n'avait pas besoin de répondre au moment de l'enregistrement ; elle doit être disponible quand un membre connecte son compte. Pour une autre installation, l'administrateur crée sa propre application et ses propres identifiants. Spotify ne fournit pas d'accès Web API à FamilyHub sans cette étape. Voir le [guide officiel de création d'application](https://developer.spotify.com/documentation/web-api/concepts/apps).

## 2. Ajouter les membres autorisés

1. Ouvrez l'application dans le [Developer Dashboard](https://developer.spotify.com/dashboard), puis **User Management** (ou **Settings → User Management**, selon l'affichage).
2. Pour chacun des cinq comptes Spotify qui utiliseront FamilyHub, cliquez sur **Add new user**, puis saisissez son nom et **l'adresse email associée à son compte Spotify**.
3. Vérifiez que la liste affiche bien les cinq comptes, y compris celui du propriétaire s'il participe. N'ajoutez pas un compte de test à la place d'un membre : il consommerait une des cinq places.

Être connecté au portail développeur ne suffit pas à autoriser l'utilisation de l'application. Si un membre oublié peut terminer l'écran de connexion mais que l'API répond **403**, contrôlez d'abord cette liste et l'identité du compte Spotify choisi. Spotify décrit ce comportement dans sa [documentation des quotas](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).

## 3. Configurer le serveur, sans publier de secret

Dans le **`.env` du serveur qui exécute Docker Compose**, définissez :

```dotenv
FAMILYHUB_ORIGIN=https://votre-domaine
SPOTIFY_CLIENT_ID=<client-id-de-votre-application>
SPOTIFY_CLIENT_SECRET=<client-secret-de-votre-application>
SPOTIFY_TOKEN_ENCRYPTION_KEY=<64-caracteres-hexadecimaux>
SPOTIFY_REDIRECT_URI=https://votre-domaine/api/v1/music/spotify/callback
```

L'origine et l'URI de retour doivent avoir exactement le même domaine HTTPS, sans `/` final dans l'origine. L'URI doit être identique à celle déclarée dans Spotify. Pour générer la clé de chiffrement, exécutez `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Conservez cette clé lors des mises à jour : la changer empêche de relire les connexions Spotify existantes. Le `Client ID` est visible pendant l'autorisation OAuth ; le `Client Secret`, la clé de chiffrement et les jetons des membres restent uniquement côté serveur.

Le `.env` local du poste de développement et le `.env` du NAS sont **deux fichiers distincts**. Copier le code ou fusionner une pull request ne copie pas les secrets sur le NAS. `.gitignore` et `.dockerignore` excluent les fichiers `.env` privés ; vérifiez qu'ils ne sont jamais ajoutés à Git. Pour notre instance, les quatre valeurs Spotify sont conservées dans un fichier local `.env.spotify.production` ignoré par Git et doivent être transférées de manière privée vers le `.env` du NAS. Ne copiez pas `FAMILYHUB_ORIGIN=http://localhost:3080` du poste local : sur le NAS, utilisez `https://familyhub.jateroka.fr`.

## 4. Déployer et vérifier

Après publication de la version Musique dans l'image Docker `latest`, depuis le répertoire Compose du NAS :

```bash
docker compose pull app
docker compose up -d
```

La migration de base de données est appliquée au démarrage de l'image. Ouvrez `https://votre-domaine/music`, puis connectez-vous à FamilyHub. La route `/api/v1/music/spotify/status` répond normalement **401 sans session FamilyHub** ; une réponse **404** indique que l'ancienne version de l'application tourne encore. Une réponse 401 ne prouve pas que les quatre variables Spotify sont configurées : ouvrez **Paramètres → Intégrations · Spotify** avec une session FamilyHub pour vérifier que le bouton **Connecter Spotify** apparaît.

## 5. Relier chaque compte

Chaque membre ouvre FamilyHub avec **son propre compte FamilyHub**, va dans **Paramètres → Intégrations · Spotify**, choisit **Connecter Spotify**, puis autorise l'application avec **son propre compte Spotify**. Le premier import récupère ses morceaux enregistrés. Le partage avec le foyer est désactivé par défaut ; le membre l'active avec **Partager mes goûts musicaux avec la famille** s'il le souhaite. Il peut aussi lancer **Synchroniser maintenant** ou **Déconnecter Spotify**. La déconnexion retire son autorisation enregistrée par FamilyHub et ses données musicales importées.

## Si quelque chose ne fonctionne pas

| Symptôme | Vérification |
| --- | --- |
| « L’administrateur du serveur doit configurer les identifiants Spotify » | Les quatre `SPOTIFY_*` doivent être présents ensemble dans le `.env` **du NAS** ; redémarrez l'application après modification. |
| Spotify refuse l'URI de retour | Comparez caractère par caractère l'URI du portail, `SPOTIFY_REDIRECT_URI` et `FAMILYHUB_ORIGIN`. |
| Spotify refuse l'accès ou renvoie 403 | Vérifiez le compte Spotify effectivement utilisé et son inscription dans **User Management**. |
| L'autorisation a expiré | Utilisez **Reconnecter Spotify**. Spotify peut demander une nouvelle autorisation après expiration du jeton de renouvellement. |
| La lecture ne démarre pas | Vérifiez qu'un appareil Spotify est actif et que le compte qui lance la lecture est Premium. |
| La limite de requêtes est atteinte | Réessayez plus tard ; les données précédemment synchronisées restent disponibles. |

Pour les choix techniques, la confidentialité des données et les limites fonctionnelles, voir [Musique — faisabilité et mise en service](MUSIC_IMPLEMENTATION.md).
