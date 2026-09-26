# PRD — FamilyHub Music / Spotify

## 1. Contexte

FamilyHub est une application familiale destinée à centraliser différents aspects de la vie du foyer.

L'intégration Spotify ne doit pas chercher à reproduire Spotify. Son objectif est de permettre aux membres de la famille de **découvrir spontanément leurs goûts respectifs** et d'identifier les artistes qu'ils ont en commun.

La philosophie fonctionnelle est :

> **Spotify gère la musique. FamilyHub révèle les goûts musicaux de la famille.**

La V1 doit privilégier la curiosité et l'exploration passive plutôt que la communication explicite entre utilisateurs.

---

# 2. Objectifs produit

La fonctionnalité doit permettre à un membre de :

- connecter son compte Spotify personnel ;
- partager volontairement ses favoris avec sa famille ;
- voir quels artistes intéressent plusieurs membres ;
- découvrir les artistes appréciés par les autres qu'il ne connaît pas ;
- identifier les nouveaux artistes qui apparaissent dans les favoris familiaux ;
- explorer les goûts musicaux d'un membre ;
- recommander explicitement un artiste ou un titre à un ou plusieurs membres ;
- obtenir chaque semaine une sélection musicale équitable provenant de plusieurs membres ;
- lancer un morceau ou la sélection FamilyHub sur Spotify ;
- ouvrir directement un morceau/artiste dans Spotify.

La fonctionnalité doit donner envie de cliquer et d'explorer sans créer de sensation de surveillance.

---

# 3. Non-objectifs V1

Ne pas implémenter dans cette première version :

- historique des écoutes Spotify ;
- morceau actuellement écouté ;
- Top Artists / Top Tracks Spotify ;
- statistiques de durée d'écoute ;
- score de compatibilité entre membres ;
- commentaires ;
- réactions ;
- lecteur audio intégré ;
- mini-player FamilyHub ;
- contrôle pause/suivant/précédent permanent ;
- création automatique de playlist dans le compte Spotify ;
- ajout d'informations musicales à l'accueil général FamilyHub ;
- événements Spotify dans le flux global « Activité récente ».

---

# 4. Source de données Spotify

La principale donnée métier provient de :

```text
GET /me/tracks
```

avec le scope :

```text
user-library-read
```

L'endpoint fournit les morceaux sauvegardés dans la bibliothèque de l'utilisateur ainsi que leur `added_at`, ce qui permet de construire les tendances FamilyHub sans utiliser l'historique d'écoute. :chatgpt-content-reference{index="3"}

Chaque morceau doit notamment permettre de conserver :

```text
spotify_track_id
spotify_uri
name
external_spotify_url
album
album_cover
explicit
duration
artists[]
added_at
```

Les artistes sont ensuite agrégés côté FamilyHub.

---

# 5. Permissions Spotify

Permissions requises pour la V1 :

```text
user-library-read
user-read-playback-state
user-modify-playback-state
```

`user-library-read` permet d'accéder aux morceaux enregistrés. :chatgpt-content-reference{index="4"}

`user-read-playback-state` permet notamment d'obtenir les appareils Spotify disponibles. :chatgpt-content-reference{index="5"}

`user-modify-playback-state` permet de démarrer la lecture sur un client Spotify/Spotify Connect. L'API de lecture nécessite Spotify Premium. :chatgpt-content-reference{index="6"}

Ne pas demander en V1 :

```text
user-read-recently-played
user-read-currently-playing
user-top-read
playlist-modify-private
playlist-modify-public
```

Principe : **demander le moins de privilèges possible**.

---

# 6. Contrainte Spotify Development Mode

Attention à une limitation externe importante.

Une application Spotify en Development Mode est actuellement limitée à **5 utilisateurs Spotify authentifiés**, chacun devant être ajouté à l'allowlist de l'application. :chatgpt-content-reference{index="7"}

Cette limite ne doit **pas être codée comme une règle métier FamilyHub**.

Architecture attendue :

```text
FamilyHub members: N
Spotify connected members: dépend de Spotify
```

L'application doit donc accepter parfaitement les membres FamilyHub sans connexion Spotify.

Si Spotify augmente ultérieurement cette limite ou si le mode d'accès change, aucune migration métier importante ne doit être nécessaire.

Spotify a également modifié en juillet 2026 la gestion des quotas Development Mode : le quota est partagé au niveau du compte développeur et les dépassements peuvent être distingués par le motif `QUOTA_EXCEEDED`. :chatgpt-content-reference{index="8"}

---

# 7. Navigation

Ajouter dans la section actuelle **Notre espace** :

```text
Musique
```

Ne pas appeler l'entrée :

```text
Spotify
```

Spotify doit apparaître comme intégration/service connecté.

Route indicative :

```text
/music
```

À l'intérieur de la page Musique, utiliser trois onglets horizontaux :

```text
Vue d'ensemble | Artistes | Playlist
```

Réutiliser les composants, spacing, typographie, cartes, radius et conventions UX existants de FamilyHub.

**Ne pas redessiner FamilyHub pour cette fonctionnalité.**

---

# 8. Vue d'ensemble

Route :

```text
/music
```

Titre :

> Musique

Sous-titre possible :

> Découvrez ce qui plaît à la famille.

La structure peut reprendre la logique visuelle actuelle de FamilyHub :

```text
┌────────────────────────────────────────────┬──────────────────────┐
│                                            │                      │
│  Recommandé pour toi                       │     Ça bouge         │
│                                            │                      │
│  À découvrir pour toi                      │                      │
│                                            │                      │
│  En commun                                 │                      │
│                                            │                      │
│  Nouveaux dans la famille                  │                      │
│                                            │                      │
│  Playlist de la semaine                    │                      │
│                                            │                      │
└────────────────────────────────────────────┴──────────────────────┘
```

Le panneau droit doit rester secondaire.

---

# 9. Bloc « À découvrir pour toi »

Objectif :

> Montrer ce qu'un autre membre semble apprécier mais qui est absent de mes propres favoris.

Il ne s'agit **pas d'une recommandation Spotify**.

Pour l'utilisateur courant `A`, sélectionner des artistes tels que :

```text
likedBy(otherMember, artist) > 0
AND
likedBy(A, artist) == 0
```

Classement recommandé :

```text
1. nombre de morceaux aimés par les autres membres
2. nombre de membres concernés
3. récence du dernier ajout
```

Exemple :

```text
À découvrir pour toi

┌─────────────────────────────┐
│ Fontaines D.C.              │
│ Jade aime 8 titres          │
│                             │
│ [Découvrir]                 │
└─────────────────────────────┘
```

Privilégier 4 à 6 suggestions maximum.

Le but n'est pas d'avoir un catalogue infini.

---

# 10. Bloc « En commun »

Afficher les artistes présents dans la bibliothèque d'au moins deux membres partageant leurs goûts.

Exemple :

```text
En commun

Muse
Papa · Jade · Lydia
24 titres aimés

Linkin Park
Papa · Jade
17 titres aimés
```

Ne jamais écrire :

> « Toute la famille adore Muse »

à partir de quelques likes.

Employer des formulations factuelles :

> 3 membres ont enregistré des titres de Muse.

---

# 11. Nouveaux dans la famille

Spotify retourne la date à laquelle un morceau a été enregistré (`added_at`). :chatgpt-content-reference{index="9"}

FamilyHub peut donc détecter :

### Nouveau chez un membre

Premier morceau connu de cet artiste sauvegardé par ce membre récemment.

Exemple :

> Jade vient d'ajouter ses premiers titres de Fontaines D.C.

### Nouveau dans la famille

L'artiste n'avait jusqu'alors aucun morceau sauvegardé par un membre participant.

Exemple :

> Fontaines D.C. fait son apparition dans la famille grâce à Jade.

Fenêtre V1 recommandée :

```text
14 jours
```

Ne jamais assimiler cela à :

> Jade écoute Fontaines D.C.

FamilyHub ne dispose volontairement pas de cette information.

---

# 12. « Ça bouge »

Petit flux spécifique à `/music`.

Il doit contenir uniquement des événements significatifs et agrégés.

Exemples autorisés :

```text
Fontaines D.C. est nouveau dans la famille.
Jade a découvert 3 nouveaux artistes.
Muse est maintenant présent chez 3 membres.
La sélection de la semaine est disponible.
```

Exemples interdits :

```text
Jade a ajouté Track X.
Jade a ajouté Track Y.
Jade a ajouté Track Z.
```

Ne pas publier ces événements dans l'activité générale FamilyHub en V1.

---

# 12 bis. Recommandations entre membres

Un membre peut recommander un artiste ou un titre visible dans FamilyHub à un ou plusieurs autres membres actifs du même foyer.

Une recommandation affiche :

```text
Nom de l'artiste ou du titre
Recommandé par Jade
[Lire si c'est un titre] [Ouvrir dans Spotify]
```

Règles V1 :

- toutes les recommandations reçues pendant les 30 derniers jours sont conservées ;
- elles sont affichées sur la vue d'ensemble Musique par pages de 12, de la plus récente à la plus ancienne ;
- une recommandation expire et est supprimée après 30 jours ;
- recommander à nouveau la même cible au même destinataire renouvelle sa date au lieu de créer un doublon ;
- le destinataire reçoit une notification FamilyHub, sauf si ses préférences masquent le module Musique ;
- le backend vérifie que chaque destinataire est actif et appartient au même foyer ;
- le backend vérifie que l'artiste ou le titre est accessible à l'émetteur ;
- recommander un élément constitue un partage explicite de cet élément, indépendamment des futures modifications de favoris.

---

# 13. Vue Artistes

Route indicative :

```text
/music/artists
```

Ajouter une recherche locale par nom d'artiste, insensible à la casse et aux accents, qui se combine avec les filtres par membre et par catégorie.

Filtres :

```text
Tous
En commun
Nouveaux
```

Ajouter un filtre membre via avatars ou select :

```text
Tous les membres
Papa
Jade
...
```

Tri par défaut :

```text
Pertinence familiale
```

Autres tris possibles :

```text
Récents
A → Z
```

Une carte artiste affiche au maximum :

```text
Artwork
Nom
Avatars des membres concernés
Nombre total de titres sauvegardés
```

Exemple :

```text
Muse

Papa · Jade · Lydia
24 titres dans les favoris
```

---

# 14. Fiche artiste

Route indicative :

```text
/music/artists/:spotifyArtistId
```

Header :

```text
[Artwork] Muse

24 titres enregistrés dans la famille
Papa · Jade · Lydia

[Ouvrir dans Spotify]
```

Section :

```text
Dans la famille

Papa      13 titres
Jade       7 titres
Lydia      4 titres
```

Pour l'utilisateur connecté :

```text
À découvrir pour toi
```

Afficher quelques titres que d'autres membres ont sauvegardés mais que l'utilisateur courant n'a pas sauvegardés.

Exemple :

```text
Hysteria
Aimé par Jade
[▶] [Spotify ↗]
```

Puis éventuellement :

```text
Voir tous les titres
```

Ne pas afficher immédiatement des centaines de morceaux.

---

# 15. Exploration d'un membre

Ne pas ajouter un onglet `Membres` dans Musique.

Réutiliser le concept de membre déjà existant dans FamilyHub.

Depuis :

- une carte artiste ;
- un avatar ;
- la page Membres ;
- éventuellement un nom dans « À découvrir » ;

permettre d'ouvrir :

```text
/music/members/:memberId
```

Cette vue répond principalement à :

> **Qu'est-ce que Jade aime que je n'ai pas dans mes propres favoris ?**

Afficher :

```text
À découvrir chez Jade

Twenty One Pilots
14 titres chez Jade
0 chez toi

Fontaines D.C.
8 titres chez Jade
0 chez toi
```

Puis une section secondaire :

```text
Vous avez aussi en commun

Muse
Linkin Park
...
```

Pas de score de compatibilité.

---

# 16. Playlist FamilyHub hebdomadaire

Route :

```text
/music/playlist
```

La sélection appartient conceptuellement à **FamilyHub**, pas à Spotify.

Elle est générée automatiquement à partir des titres aimés et partagés. Les membres n'ajoutent pas manuellement des titres dans cette sélection.

Nom :

> Découvertes de la famille

Sous-titre :

> Semaine du 21 au 27 septembre

Afficher les participants.

Chaque participant fournit exactement le même nombre de morceaux.

V1 :

```text
2 morceaux par membre participant
```

Avec cinq membres :

```text
10 morceaux
```

---

# 17. Algorithme de sélection

Pour chaque membre participant :

Créer une liste de candidats à partir de ses morceaux sauvegardés.

Favoriser :

```text
+ ajout récent
+ morceau peu ou pas sauvegardé par les autres
+ artiste pas déjà représenté dans la sélection
+ morceau jamais utilisé récemment par FamilyHub
```

Pénaliser :

```text
- morceau déjà aimé par presque tout le monde
- artiste déjà sélectionné
- morceau utilisé dans une sélection récente
```

Contrainte absolue :

```text
nombre de morceaux par membre identique
```

V1 :

```text
max 1 morceau du même artiste par membre/semaine
```

Si le nombre de candidats est insuffisant, assouplir progressivement la récence puis la contrainte artiste.

Ne jamais exclure complètement un membre parce qu'il sauvegarde peu de musique.

---

# 18. Ordre de la playlist

Ne pas concaténer :

```text
Jade
Jade
Papa
Papa
Lydia
Lydia
```

Intercaler :

```text
Jade
Papa
Lydia
Emma
Jade
Papa
Lydia
Emma
```

avec un ordre pseudo-aléatoire stable pour la semaine.

Stocker la playlist générée afin qu'elle reste identique jusqu'à la génération suivante.

---

# 19. Lecture Spotify

Chaque morceau possède :

```text
▶
Spotify ↗
```

### Action ▶

FamilyHub demande à Spotify de démarrer le morceau sur l'appareil actif.

Pour la sélection complète, envoyer les URI des morceaux à :

```text
PUT /me/player/play
```

Spotify accepte une liste d'URI de tracks dans cette commande. :chatgpt-content-reference{index="10"}

### Aucun appareil disponible

Afficher :

> Aucun appareil Spotify actif. Ouvrez Spotify sur votre téléphone, ordinateur ou enceinte puis réessayez.

Actions :

```text
[Réessayer]
[Ouvrir dans Spotify]
```

FamilyHub peut récupérer les appareils Spotify disponibles avec l'API prévue à cet effet. :chatgpt-content-reference{index="11"}

---

# 20. Aucun mini-player

Après lancement :

> Lecture lancée sur « PC Bureau »

via un toast FamilyHub.

Pas de :

```text
pause
suivant
précédent
progress bar
volume
album cover persistante
```

FamilyHub n'est pas le lecteur.

Spotify reste le lecteur.

---

# 21. Connexion Spotify

Dans :

```text
Paramètres
→ Intégrations
→ Spotify
```

Afficher :

```text
Spotify
Connecté en tant que XXXXX

Dernière synchronisation : aujourd'hui à 08:12

☑ Partager mes goûts musicaux avec la famille

[Synchroniser maintenant]
[Déconnecter Spotify]
```

Texte d'explication :

> FamilyHub utilise les morceaux enregistrés dans votre bibliothèque pour identifier les artistes que votre famille apprécie et proposer des découvertes. Votre historique d'écoute et votre activité en temps réel ne sont pas importés.

---

# 22. OAuth

Réutiliser l'architecture backend existante.

Si FamilyHub possède un backend capable de conserver correctement un secret, utiliser le flux **Authorization Code** Spotify.

Spotify recommande ce flux pour les applications web longues durées capables de stocker le secret et de renouveler les tokens ; PKCE est recommandé lorsque le secret ne peut pas être conservé de manière sûre. :chatgpt-content-reference{index="12"}

Codex doit inspecter l'architecture existante avant de choisir.

Ne jamais exposer :

```text
client_secret
refresh_token
access_token
```

dans le frontend, les logs ou les réponses API FamilyHub.

---

# 23. Modèle de données indicatif

Adapter les noms et conventions au modèle actuel.

```text
SpotifyConnection
-----------------
id
family_member_id
spotify_account_id
encrypted_refresh_token
granted_scopes
status
share_enabled
connected_at
last_sync_at
last_successful_sync_at
sync_error
```

Utiliser idéalement `account_id` Spotify pour relier durablement un compte : Spotify le documente désormais comme identifiant public, immuable et pseudo-anonyme prévu pour l'account linking. :chatgpt-content-reference{index="13"}

```text
SpotifyArtist
-------------
spotify_artist_id
spotify_uri
name
spotify_url
```

```text
SpotifyTrack
------------
spotify_track_id
spotify_uri
name
spotify_url
album_name
album_image_url
duration_ms
explicit
```

```text
SpotifyTrackArtist
------------------
track_id
artist_id
```

```text
MemberSavedTrack
----------------
family_member_id
track_id
spotify_added_at
first_seen_at
last_seen_at
```

```text
WeeklyMusicMix
--------------
id
week_start
generated_at
algorithm_version
```

```text
WeeklyMusicMixItem
------------------
mix_id
track_id
source_member_id
position
```

---

# 24. Données dérivées

Ne pas obligatoirement persister toutes ces valeurs si elles peuvent être calculées efficacement :

```text
artist_member_count
artist_total_saved_tracks
member_artist_track_count
member_artist_first_added_at
member_artist_last_added_at
artist_first_family_appearance
```

Prévoir éventuellement des agrégats/cache si le volume le justifie.

---

# 25. Synchronisation

### Première connexion

Faire une synchronisation complète de `/me/tracks`, avec pagination.

Spotify permet jusqu'à 50 éléments par page sur cet endpoint. :chatgpt-content-reference{index="14"}

### Synchronisations suivantes

Ne pas appeler Spotify à chaque ouverture d'écran.

Les pages FamilyHub doivent principalement lire **la base locale FamilyHub**.

Prévoir :

- synchronisation périodique raisonnable ;
- bouton manuel « Synchroniser maintenant » ;
- délai minimum entre deux synchronisations manuelles ;
- gestion des erreurs ;
- backoff ;
- gestion du `429`.

Un échec Spotify ne doit pas rendre la page Musique inutilisable si FamilyHub possède déjà des données synchronisées.

Afficher :

> Données Spotify synchronisées hier à 21:32.

---

# 26. Suppressions

La synchronisation doit également détecter qu'un morceau n'est plus dans les favoris Spotify.

Ne pas supposer qu'un élément importé reste éternellement aimé.

Les agrégats familiaux doivent être recalculés après suppression.

---

# 27. Confidentialité

Par défaut, la connexion Spotify et le partage sont deux concepts séparés.

État possible :

```text
Spotify connecté
Partage familial désactivé
```

Dans ce cas :

- le membre peut utiliser ses propres données pour personnaliser son expérience ;
- ses données ne sont pas visibles par les autres ;
- il n'est pas utilisé comme source dans « En commun » ;
- il n'alimente pas « Nouveaux dans la famille » ;
- il ne fournit pas de titres à la playlist hebdomadaire.

Lors de la déconnexion, supprimer :

```text
refresh token
access tokens éventuels
association Spotify personnelle
données MemberSavedTrack du membre
```

Puis recalculer les agrégats.

---

# 28. États vides

Ils sont importants.

### Aucun Spotify connecté

> **Découvrez les goûts musicaux de la famille**  
> Connectez Spotify pour retrouver vos artistes favoris et découvrir ceux des autres.
>
> `[Connecter Spotify]`

### Moi connecté mais personne d'autre

> Spotify est connecté.  
> Dès qu'un autre membre partagera ses goûts, FamilyHub commencera à faire apparaître vos découvertes communes.

### Aucun artiste commun

Ne pas donner une impression d'erreur :

> Aucun artiste commun pour l'instant. Voilà justement quelques univers à explorer.

### Pas de nouvelle découverte

> Rien de nouveau cette semaine.

---

# 29. Gestion des erreurs Spotify

Prévoir explicitement :

```text
401 token expiré
403 utilisateur non autorisé / droits insuffisants
404 ou absence d'appareil actif
429 rate limit
429 QUOTA_EXCEEDED
5xx Spotify
timeout réseau
```

Ne jamais exposer le message technique brut à l'utilisateur.

Journaliser suffisamment côté serveur pour diagnostiquer sans journaliser les tokens.

---

# 30. Responsive

Le comportement doit rester cohérent avec le responsive FamilyHub existant.

Sur mobile :

```text
Vue d'ensemble
  ↓
À découvrir
  ↓
En commun
  ↓
Nouveaux
  ↓
Playlist
  ↓
Ça bouge
```

Les trois onglets doivent rester facilement accessibles.

Les cartes artistes doivent devenir une ou deux colonnes selon la largeur.

---

# 31. Direction graphique

Ne pas adopter le vert Spotify comme couleur dominante de la section.

FamilyHub doit visuellement rester **FamilyHub**.

Le logo Spotify peut apparaître :

- dans le bouton de connexion ;
- dans `Ouvrir dans Spotify` ;
- éventuellement comme petit badge fournisseur.

Les artworks musicaux apporteront déjà énormément de couleur.

Le reste doit utiliser le design system actuel.

---

# 32. Sécurité

Contraintes minimales :

- OAuth `state` anti-CSRF ;
- redirect URI explicitement autorisée ;
- HTTPS hors loopback développement ;
- tokens côté serveur ;
- refresh token chiffré au repos ;
- aucun secret Spotify dans le bundle frontend ;
- scopes minimaux ;
- suppression des tokens à la déconnexion ;
- aucune donnée musicale accessible hors du foyer concerné ;
- toutes les queries doivent être filtrées par le household/family ID côté serveur ;
- aucune confiance dans un `member_id` fourni par le frontend ;
- vérification d'autorisation systématique côté backend.

Spotify impose désormais des redirect URI sécurisées hors cas loopback local. :chatgpt-content-reference{index="15"}

---

# 33. API interne indicative

Adapter impérativement aux patterns existants.

```text
GET  /api/music/overview
GET  /api/music/artists
GET  /api/music/artists/:id
GET  /api/music/members/:memberId
GET  /api/music/weekly-mix
GET  /api/music/recommendation-recipients
GET  /api/music/recommendations?page=1
POST /api/music/recommendations

GET  /api/music/spotify/devices
POST /api/music/spotify/play
POST /api/music/spotify/sync

GET  /api/music/spotify/connect
GET  /api/music/spotify/callback
POST /api/music/spotify/disconnect

PATCH /api/music/settings
```

Exemple :

```json
POST /api/music/spotify/play

{
  "uris": [
    "spotify:track:xxx"
  ]
}
```

Ne jamais accepter arbitrairement un token Spotify depuis le navigateur.

---

# 34. Critères d'acceptation V1

La fonctionnalité sera considérée comme complète lorsque :

1. un membre peut connecter Spotify ;
2. ses favoris sont importés ;
3. les favoris sont agrégés par artiste ;
4. plusieurs membres peuvent partager leurs favoris ;
5. la vue d'ensemble affiche des découvertes personnalisées ;
6. les artistes communs sont identifiés ;
7. les nouveaux artistes sont identifiés à partir des favoris ;
8. une fiche artiste permet de comprendre qui aime quoi ;
9. un membre peut explorer les goûts d'un autre ;
10. la playlist hebdomadaire est générée équitablement ;
11. elle ne répète pas systématiquement les mêmes artistes/morceaux ;
12. un morceau peut être lancé sur Spotify ;
13. la playlist entière peut être lancée sur Spotify ;
14. l'ouverture directe dans Spotify fonctionne comme fallback ;
15. aucun historique d'écoute n'est demandé ;
16. aucune donnée actuellement écoutée n'est demandée ;
17. aucun mini-player n'existe ;
18. la déconnexion Spotify supprime correctement les credentials et données personnelles associées ;
19. les pages restent utilisables avec les dernières données synchronisées lorsque Spotify est indisponible ;
20. les limites et erreurs Spotify sont gérées proprement ;
21. un artiste ou un titre peut être recommandé à plusieurs membres du même foyer ;
22. les recommandations reçues sont visibles sur l'accueil Musique avec une pagination de 12 éléments ;
23. les recommandations expirent après 30 jours et un nouvel envoi identique renouvelle l'existant ;
24. la liste des artistes peut être filtrée par une recherche textuelle ;
25. l'interface explique que la playlist hebdomadaire est générée automatiquement.

---

# 35. Instructions de réalisation pour Codex

**Avant de développer quoi que ce soit :**

Inspecter le dépôt FamilyHub afin d'identifier :

- stack frontend ;
- stack backend ;
- ORM ;
- système d'authentification ;
- modèle Household/Family ;
- modèle Member/User ;
- scheduler existant éventuel ;
- composants UI ;
- gestion des secrets ;
- patterns API ;
- conventions de migration ;
- tests existants.

**Ne pas introduire de nouvelle architecture ou bibliothèque importante lorsque FamilyHub possède déjà une solution équivalente.**

Puis implémenter par incréments :

```text
Phase 1
OAuth Spotify + modèle de connexion

Phase 2
Synchronisation des favoris + modèle local

Phase 3
Agrégation artistes

Phase 4
Vue Artistes + fiche artiste

Phase 5
Vue d'ensemble / découverte

Phase 6
Exploration par membre

Phase 7
Playlist hebdomadaire

Phase 8
Spotify playback

Phase 9
Robustesse, privacy, quota, erreurs et tests
```

Chaque phase doit laisser l'application dans un état fonctionnel.
