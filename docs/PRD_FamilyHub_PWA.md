# PRD — Espace privé de groupe / foyer en PWA
**Nom de travail :** FamilyHub  
**Version :** 0.1  
**Statut :** Spécification fonctionnelle initiale destinée à une IA de développement (Codex)  
**Plateformes cibles :** PWA installable sur iPhone et Android + usage direct dans un navigateur desktop/mobile  
**Langue initiale :** Français  
**Licence cible :** Open source

**Déploiement cible :** auto-hébergement simple, notamment sur NAS, via Docker Compose

---

# 1. Objectif produit

Construire une application web progressive privée destinée à un petit groupe de personnes qui se connaissent : famille, colocation, groupe d'amis, petite association.

Le produit doit centraliser dans une seule interface :

- communication ;
- organisation ;
- informations persistantes ;
- recommandations ;
- tâches ;
- agenda ;
- repas et courses ;
- contenus partagés ;
- activité récente.

Le produit ne doit pas ressembler à une suite d'outils d'entreprise ni à un clone de Discord/Teams.

Le principe UX principal est :

> Beaucoup de possibilités, très peu de complexité visible à un instant donné.

L'application doit être modulaire. Un administrateur doit pouvoir activer ou désactiver chaque module non essentiel afin d'adapter l'interface au groupe.

---

# 2. Principes structurants

## 2.1. PWA unique

Une seule application doit fonctionner :

- dans Safari sur iPhone ;
- installée comme PWA sur l'écran d'accueil iPhone ;
- dans Chrome/Firefox/Edge sur Android ;
- installée comme PWA sur Android ;
- dans un navigateur desktop.

Il ne doit pas être nécessaire de maintenir des applications natives iOS et Android séparées.

## 2.2. Privacy by design

L'application est privée par défaut.

Chaque objet partagé doit utiliser le même modèle de visibilité :

- `PRIVATE` : visible uniquement par son créateur ;
- `ALL_MEMBERS` : visible par tous les membres de l'instance ;
- `GROUPS` : visible par un ou plusieurs groupes ;
- `SELECTED_USERS` : visible par une liste explicite de personnes.

Le mot `public` ne doit pas être utilisé dans l'UI car il peut être interprété comme « visible sur Internet ».

Aucun objet ne doit être accessible sans authentification sauf les routes strictement nécessaires à la connexion et aux mécanismes techniques.

## 2.3. Modules

Les modules sont activables/désactivables depuis l'administration.

Modules essentiels non désactivables :

- Accueil ;
- Membres et groupes ;
- Notifications ;
- Recherche ;
- Paramètres.

Modules fonctionnels activables :

- Chat ;
- Agenda ;
- Tâches et corvées ;
- Repas ;
- Courses ;
- Bookmarks ;
- Pages ;
- Collections ;
- Sondages ;
- Boîte à idées ;
- Contacts externes ;
- Documents.

Lorsqu'un module est désactivé :

- il disparaît de la navigation ;
- les actions de création associées disparaissent ;
- les widgets associés disparaissent de l'accueil ;
- ses données ne sont pas supprimées ;
- sa réactivation restaure l'accès aux données existantes.

## 2.4. Objets transversaux

Tous les objets métier qui le permettent doivent partager des propriétés communes :

- identifiant ;
- créateur ;
- date de création ;
- date de modification ;
- visibilité ;
- groupes autorisés ;
- utilisateurs autorisés ;
- commentaires ;
- pièces jointes ;
- tags ;
- favoris ;
- historique minimal ;
- paramètres de notification.

L'implémentation doit éviter de créer des systèmes de permissions indépendants dans chaque module.

---

# 3. Rôles

## 3.1. Administrateur

Un administrateur peut :

- gérer les membres ;
- gérer les groupes ;
- activer/désactiver des modules ;
- configurer l'instance ;
- configurer les limites de stockage ;
- gérer les catégories globales ;
- consulter les journaux d'administration ;
- supprimer/modérer du contenu si nécessaire ;
- lancer un export global ;
- gérer les politiques de rétention éventuelles.

Un administrateur ne doit pas être automatiquement membre des conversations ou groupes privés.

## 3.2. Membre

Un membre peut :

- utiliser tous les modules activés auxquels il a accès ;
- créer des objets selon ses permissions ;
- gérer ses propres contenus ;
- définir ses préférences de notification ;
- masquer personnellement certains modules de sa navigation ;
- gérer ses favoris et bookmarks privés.

---

# 4. Membres et groupes

## 4.1. Profil membre

Champs minimaux :

- prénom ;
- nom optionnel ;
- avatar ;
- date de naissance ;
- numéro de téléphone ;
- email ;
- fuseau horaire ;
- statut actif/inactif.

La date de naissance doit pouvoir générer automatiquement un événement anniversaire dans l'agenda.

## 4.2. Groupes

Un groupe est un ensemble nommé de membres.

Exemples :

- Parents ;
- Enfants ;
- Tout le monde ;
- Groupe temporaire pour un événement.

Un utilisateur peut appartenir à plusieurs groupes.

Les groupes servent au modèle de visibilité de tous les modules.

---

# 5. Accueil et fil d'activité

## 5.1. Objectif

L'accueil doit répondre à :

> Qu'est-ce qui a changé depuis ma dernière visite et qu'est-ce qui mérite mon attention aujourd'hui ?

Il ne doit pas devenir un réseau social infini.

## 5.2. Sections proposées

### Aujourd'hui

Exemples :

- rendez-vous ;
- anniversaires ;
- événements ;
- tâches datées ;
- repas prévu ;
- tâches/corvées à faire.

### À voir

Exemples :

- nouveaux messages ;
- nouvelle affectation ;
- sondage en attente ;
- nouvelle demande de courses ;
- événement auquel répondre.

### Activité récente

Exemples :

- bookmark partagé ;
- nouvelle collection ;
- page modifiée ;
- tâche terminée ;
- sondage créé ;
- événement ajouté.

## 5.3. Agrégation du chat

Le fil d'activité ne doit PAS afficher chaque message du chat.

Il doit afficher une agrégation du type :

`Parents — 3 nouveaux messages`

---

# 6. Notifications

## 6.1. Canaux

Prévoir :

- notifications in-app ;
- Web Push PWA lorsque la plateforme le permet ;
- badge de compteur ;
- email optionnel pour certaines alertes.

## 6.2. Types de notification

Exemples :

- nouveau message direct ;
- mention ;
- invitation à une conversation ;
- tâche affectée ;
- tâche bientôt due ;
- événement bientôt prévu ;
- invitation à un événement ;
- nouveau sondage ;
- fin prochaine d'un sondage ;
- modification importante d'une page suivie ;
- demande de courses ajoutée.

## 6.3. Préférences

Chaque utilisateur doit pouvoir choisir :

- toutes les notifications ;
- importantes uniquement ;
- aucune notification pour un module ;
- silencieux pour une conversation ;
- plage horaire silencieuse.

---

# 7. Chat

## 7.1. Types de conversations

Le chat doit prendre en charge :

- conversation 1:1 ;
- conversation de groupe ;
- conversation thématique.

Une conversation a :

- un titre facultatif ;
- une liste de participants ;
- une visibilité implicite limitée aux participants ;
- un historique ;
- des pièces jointes ;
- des réactions ;
- des réponses à un message.

## 7.2. Sujet

Pour une conversation de groupe, le créateur peut définir un sujet/titre.

Exemples :

- Parents ;
- Vacances ;
- Anniversaire ;
- Travaux maison.

## 7.3. Pièces jointes

Support minimal :

- image ;
- fichier ;
- URL avec prévisualisation.

## 7.4. Hors périmètre initial

Ne pas développer en MVP :

- appels audio ;
- appels vidéo ;
- partage d'écran ;
- bots ;
- intégrations externes complexes.

---

# 8. Agenda

## 8.1. Types

L'agenda doit gérer :

- rendez-vous ;
- événement ;
- anniversaire ;
- rappel ;
- tâche datée ;
- corvée planifiée.

## 8.2. Événement

Champs :

- titre ;
- description ;
- début ;
- fin ;
- journée entière ;
- lieu ;
- participants ;
- récurrence ;
- rappel ;
- visibilité ;
- pièces jointes.

## 8.3. Participants

Pour un événement, chaque participant peut répondre :

- Oui ;
- Non ;
- Peut-être ;
- Pas encore répondu.

## 8.4. Expiration/rappel

Les dates d'expiration ne constituent pas un module séparé.

Elles sont représentées par un événement ou rappel.

Exemples :

- contrôle technique ;
- renouvellement d'un abonnement ;
- garantie ;
- document expirant.

---

# 9. Tâches et routines

Le module expose deux concepts simples. Le destinataire et la planification sont des
propriétés indépendantes, pas des types supplémentaires.

## 9.1. Tâche

Une tâche est réalisée une fois par défaut. Elle peut :

- être personnelle, affectée à une personne, ou ouverte à un groupe ou au foyer ;
- ne posséder aucune date ;
- posséder une échéance ou une période de réalisation ;
- se répéter à partir de cette date ou période.

Exemples :

- `Appeler le médecin — pour moi, sans date` ;
- `Sortir les poubelles le mardi — pour Paul` ;
- `Ramasser les feuilles entre le 1er octobre et le 30 novembre — pour les enfants`.

Une tâche datée reste un objet `Task`. L'agenda en affiche une projection et ne crée pas
un deuxième objet `Event`.

## 9.2. Routine

Une routine est une action disponible indéfiniment, par exemple `Vider le lave-vaisselle`.
Chaque réalisation ajoute une occurrence à l'historique sans supprimer sa définition.

Une routine peut être :

- toujours disponible ;
- de nouveau disponible après un délai minimum ;
- réactivée manuellement.

Elle peut avoir une fréquence indicative, par exemple `environ 1 fois par jour`. Cette
fréquence n'est PAS une date de planification. Mettre fin à une routine est une action
distincte nommée `Archiver`, et non une politique de réouverture.

## 9.3. Destinataires

Le champ `Pour qui ?` propose, dans cet ordre :

- Tout le foyer ;
- Moi ;
- les personnes actives ;
- les groupes du foyer.

Une personne sélectionnée est responsable. Une tâche destinée à un groupe ou au foyer est
ouverte à chacun de ses membres. La visibilité est déduite du destinataire afin d'éviter
des choix contradictoires. `Tout le foyer` est la valeur initiale d'une routine et `Moi`
celle d'une tâche.

## 9.4. États

États minimaux :

- `OPEN` ;
- `IN_PROGRESS` facultatif ;
- `DONE` ;
- `CANCELLED`.

Pour une routine, `DONE` doit créer une occurrence terminée dans l'historique puis rendre
la routine disponible selon sa règle.

## 9.5. Activité et statistiques

Le système doit conserver :

- qui a réalisé la tâche/corvée ;
- date/heure ;
- éventuel commentaire ;
- occurrence concernée.

Objectif : permettre de voir qui participe aux tâches communes sans gamification forcée.

Le module propose un journal chronologique des réalisations et des statistiques sur les
routines partagées. Les statistiques permettent de choisir une période et les personnes
affichées. Elles comptent les réalisations par personne et par routine, sans points ni
classement automatique ; elles ne prétendent pas mesurer l'effort réel.

---

# 10. Repas

## 10.1. Plat

Une fiche plat contient :

- nom ;
- description ;
- photo ;
- portions de référence ;
- ingrédients ;
- quantités ;
- unité ;
- instructions facultatives ;
- tags ;
- commentaires.

## 10.2. Préférences des membres

Pour chaque plat et chaque membre :

- `-1` : n'aime pas ;
- `0` : neutre / sans avis ;
- `+1` : adore.

Aucune moyenne complexe n'est requise.

## 10.3. Planning des repas

Permet d'affecter un plat à :

- une date ;
- déjeuner ;
- dîner ;
- autre créneau facultatif.

Le foyer peut choisir le premier jour de sa semaine de planning (lundi par défaut). La vue
affiche toujours les sept jours consécutifs de cette semaine, par exemple du samedi au
vendredi lorsque les courses sont préparées le samedi.

## 10.4. Génération des courses

Depuis un plat ou une période du planning :

- calculer les ingrédients nécessaires ;
- permettre à l'utilisateur de décocher les ingrédients déjà présents ;
- ajouter le reste à la liste de courses.

Ne pas implémenter de gestion de stock/frigo en MVP.

---

# 11. Courses

## 11.1. Liste commune

Tous les membres autorisés peuvent :

- ajouter un article ;
- indiquer une quantité ;
- ajouter une note ;
- cocher `acheté`.

## 11.2. Demande de courses

Un utilisateur doit pouvoir ajouter une demande pour les prochaines courses.

Exemple :

`Jade demande : shampoing`

L'origine de la demande doit être enregistrée.

## 11.3. Source automatique

Les articles peuvent provenir :

- d'une saisie manuelle ;
- d'une fiche repas ;
- d'un ingrédient ;
- d'une recette planifiée.

## 11.4. Offline

La liste de courses doit fonctionner hors connexion :

- consultation ;
- ajout ;
- coche ;
- décoche.

Les modifications sont synchronisées au retour du réseau.

---

# 12. Bookmarks

## 12.1. Objectif

Créer un gestionnaire de bookmarks individuel + partagé.

Chaque utilisateur possède sa propre bibliothèque.

## 12.2. Bookmark

Champs :

- URL ;
- titre ;
- description ;
- favicon ;
- image OpenGraph si disponible ;
- commentaire personnel ;
- tags ;
- auteur ;
- visibilité ;
- date d'ajout.

## 12.3. Visibilité

Un bookmark peut être :

- privé ;
- partagé avec tous ;
- partagé avec un groupe ;
- partagé avec certaines personnes.

## 12.4. Vue personnelle

Dans `Mes bookmarks`, afficher :

- mes bookmarks privés ;
- mes bookmarks partagés ;
- recommandations partagées par les autres ;
- favoris ;
- filtres par tag ;
- recherche.

## 12.5. Recommandations

Une vue `Recommandé` doit permettre de voir les bookmarks partagés par les autres.

Réaction simple possible :

- favori ;
- utile/j'aime.

Ne pas construire de réseau social de notation complexe.

---

# 13. Pages

## 13.1. Objectif

Créer un wiki simplifié destiné à des utilisateurs non techniques.

Le terme affiché dans l'interface est `Pages`, pas `Wiki`.

## 13.2. Éditeur

L'éditeur doit être WYSIWYG.

Le stockage interne peut être Markdown.

Fonctions minimales :

- titres ;
- paragraphes ;
- gras ;
- italique ;
- liens ;
- listes ;
- cases à cocher ;
- image ;
- tableau simple ;
- citation.

## 13.3. Organisation

Les pages peuvent être organisées :

- par dossiers/catégories ;
- via tags ;
- via liens entre pages.

## 13.4. Historique

Conserver un historique de versions minimal permettant :

- voir qui a modifié ;
- voir quand ;
- restaurer une version précédente.

## 13.5. Objets embarqués

À terme, une page doit pouvoir référencer/embarquer d'autres objets internes :

- événement ;
- tâche ;
- liste ;
- bookmark ;
- collection ;
- sondage.

MVP : un lien interne enrichi peut suffire.

---

# 14. Collections

## 14.1. Objectif

Les collections servent à organiser des listes structurées de recommandations/objets.

Elles ne doivent pas être modélisées comme des pages.

## 14.2. Exemples

- Livres ;
- Films ;
- Séries ;
- YouTubeurs ;
- Musiques ;
- Restaurants ;
- Jeux ;
- Lieux à visiter ;
- Idées cadeaux.

## 14.3. Collection

Une collection contient :

- nom ;
- description ;
- type ;
- visibilité ;
- membres autorisés ;
- tags ;
- image facultative.

## 14.4. Élément de collection

Champs génériques :

- titre ;
- sous-titre ;
- description ;
- URL facultative ;
- image ;
- tags ;
- ajouté par ;
- date d'ajout ;
- commentaires ;
- réactions.

Le modèle doit permettre des métadonnées propres au type.

Exemples :

Livre :
- auteur ;
- ISBN facultatif.

YouTubeur :
- URL de chaîne.

Film :
- année ;
- réalisateur facultatif.

## 14.5. Avis par membre

Un élément peut recevoir un avis simple par membre :

- `-1` ;
- `0` ;
- `+1`.

Une note 1–5 peut être envisagée ultérieurement mais n'est pas requise en MVP.

---

# 15. Sondages

Fonctions minimales :

- question ;
- réponses possibles ;
- choix unique ou multiple ;
- date de fin facultative ;
- vote anonyme optionnel ;
- visibilité ;
- affichage des résultats ;
- notification aux destinataires.

---

# 16. Boîte à idées

## 16.1. Objectif

Permettre de proposer :

- sortie ;
- film ;
- achat ;
- activité ;
- projet ;
- restaurant ;
- destination ;
- idée générale.

## 16.2. Fonctions

Une idée possède :

- titre ;
- description ;
- auteur ;
- visibilité ;
- réactions/votes ;
- commentaires ;
- statut.

États possibles :

- proposée ;
- retenue ;
- rejetée ;
- réalisée.

Une idée retenue peut être convertie en :

- événement ;
- tâche ;
- élément de collection.

---

# 17. Contacts externes

Module optionnel.

Les membres de l'instance sont déjà des contacts internes.

Le module Contacts sert uniquement aux personnes externes.

Champs :

- prénom ;
- nom ;
- téléphone ;
- email ;
- adresse ;
- notes ;
- tags.

---

# 18. Documents

Module optionnel et désactivable.

Il ne doit pas devenir un gestionnaire documentaire complexe.

Fonctions :

- upload ;
- titre ;
- catégorie ;
- tags ;
- commentaire ;
- visibilité ;
- pièce jointe.

Les dates d'expiration éventuelles doivent être modélisées via l'Agenda.

---

# 19. Photos et fichiers

Il n'existe PAS de galerie photo générale ni de stockage photo autonome.

Une photo ou un fichier existe parce qu'il est rattaché à un objet :

- message ;
- plat ;
- page ;
- bookmark ;
- collection ;
- événement ;
- tâche ;
- sondage ;
- idée.

Le backend doit néanmoins mutualiser le stockage des fichiers.

---

# 20. Recherche globale

La recherche globale doit respecter strictement les permissions.

Une recherche `Dune` peut retourner :

- collection ;
- bookmark ;
- message ;
- page ;
- tâche ;
- événement.

Chaque résultat indique son type.

Les données privées d'un autre utilisateur ne doivent jamais apparaître, même via autocomplete, compteur, index ou extrait.

---

# 21. Navigation PWA

## 21.1. Mobile

Barre principale maximum 5 entrées :

- Accueil ;
- Chat ;
- Agenda ;
- Tâches/Listes ;
- Plus.

`Plus` affiche uniquement les modules actifs.

## 21.2. Desktop

Utiliser une sidebar.

La hiérarchie fonctionnelle doit rester identique à la version mobile.

## 21.3. Action globale

Prévoir un bouton `+` global.

Il affiche uniquement les types d'objets appartenant aux modules actifs.

Exemple :

- Message ;
- Événement ;
- Tâche ;
- Bookmark ;
- Page ;
- Sondage ;
- Idée.

---

# 22. Offline et synchronisation

## 22.1. Priorité forte

Doivent fonctionner hors connexion :

- courses ;
- tâches ;
- agenda en lecture ;
- planning repas en lecture.

## 22.2. Comportement

Les opérations locales doivent être stockées puis synchronisées.

Chaque mutation locale doit posséder :

- id client ;
- timestamp ;
- statut de synchronisation.

Le serveur doit gérer les doublons.

## 22.3. Conflits

Pour MVP :

- tâches/courses : stratégie last-write-wins acceptable pour les champs simples ;
- pages : détecter les conflits et ne pas écraser silencieusement une modification distante ;
- chat : messages append-only.

---

# 23. Export et portabilité

L'utilisateur doit pouvoir exporter ses données.

L'administrateur doit pouvoir exporter l'instance.

Formats cibles :

- Agenda : `.ics` ;
- Bookmarks : HTML standard + JSON ;
- Pages : Markdown ;
- Collections : JSON/CSV ;
- Tâches : JSON/CSV ;
- Repas : JSON ;
- pièces jointes : fichiers originaux.

Exemple :

```text
export.zip
  calendar.ics
  bookmarks.html
  bookmarks.json
  pages/
  collections.json
  tasks.json
  meals.json
  attachments/
```

Aucune donnée ne doit être enfermée dans un format propriétaire impossible à relire.

---

# 24. Paramètres personnels

Chaque membre peut gérer :

- avatar ;
- coordonnées ;
- fuseau horaire ;
- modules masqués localement ;
- préférences de notifications ;
- thème clair/sombre/système ;
- langue ;
- confidentialité de profil ;
- export personnel.

---

# 25. Administration des modules

L'admin dispose d'un écran :

```text
Fonctionnalités
[✓] Chat
[✓] Agenda
[✓] Tâches
[✓] Repas
[✓] Courses
[✓] Bookmarks
[✓] Pages
[✓] Collections
[✓] Sondages
[✓] Idées
[ ] Documents
[ ] Contacts externes
```

Une dépendance peut exister entre modules.

Exemple :

- Repas peut fonctionner sans Courses ;
- le bouton `Ajouter aux courses` est caché si Courses est désactivé.

Les dépendances doivent être explicites dans le code.

---

# 26. Sécurité

Exigences minimales :

- HTTPS obligatoire hors développement local ;
- mots de passe hashés avec un algorithme moderne ;
- sessions sécurisées ;
- protection CSRF si cookies de session ;
- validation serveur de toutes les permissions ;
- limitation de débit sur login et endpoints sensibles ;
- journalisation des actions administratives ;
- validation stricte des uploads ;
- taille maximale configurable ;
- types MIME contrôlés ;
- sanitation du HTML/WYSIWYG ;
- aucune confiance dans les contrôles UI ;
- suppression logique ou physique cohérente ;
- sauvegarde documentée.

Les permissions doivent être vérifiées côté serveur pour chaque lecture et écriture.

---

# 27. Données et modèle conceptuel

Entités minimales :

- User
- Group
- GroupMembership
- ModuleConfig
- VisibilityRule
- Attachment
- Tag
- Comment
- ActivityEvent
- Notification
- Conversation
- ConversationMember
- Message
- CalendarEvent
- EventParticipant
- Task
- TaskOccurrence
- Meal
- MealPreference
- Ingredient
- MealIngredient
- MealPlanEntry
- ShoppingItem
- Bookmark
- Page
- PageRevision
- Collection
- CollectionItem
- CollectionItemPreference
- Poll
- PollOption
- PollVote
- Idea
- Contact

Le modèle exact peut être adapté par l'implémenteur, mais les concepts fonctionnels ne doivent pas être fusionnés si cela détruit les comportements décrits.

---

# 28. Règles importantes sur les tâches

Cette section est normative.

## 28.1. Une tâche n'est pas un événement

Une tâche possédant une date apparaît dans l'agenda via projection.

Ne pas créer automatiquement un deuxième objet événement.

## 28.2. Une tâche peut ne jamais avoir de date

Une corvée comme `vider le lave-vaisselle` doit pouvoir exister indéfiniment sans date.

## 28.3. Une tâche peut être ouverte à tous

Une tâche avec `assignee = null` et `claimable = true` peut être accomplie par n'importe quel membre autorisé.

Une ACL de groupe limite ce droit aux membres du groupe ; une ACL d'utilisateurs le limite
aux personnes sélectionnées.

## 28.4. Terminer une routine crée une occurrence

L'historique doit conserver chaque réalisation.

La définition de tâche reste active.

Son archivage est une action séparée de la réalisation d'une occurrence.

## 28.5. Récurrence temporelle et fréquence indicative sont différentes

`Tous les mardis` = récurrence temporelle.

`Environ 1 fois par jour` = fréquence indicative non planifiée.

Ne pas les implémenter avec le même champ.

---

# 29. Non-objectifs MVP

Ne pas développer dans le MVP :

- réseau social public ;
- fédération entre serveurs ;
- appels audio/vidéo ;
- gamification des corvées ;
- comptabilité ou partage de dépenses ;
- gestion de stock alimentaire ;
- galerie photo ;
- gestion documentaire avancée ;
- chatbot IA ;
- marketplace ;
- intégration domotique ;
- système de plugins tiers ;
- application native iOS ;
- application native Android.

---

# 30. MVP recommandé

## Phase 1 — Socle

- authentification ;
- membres ;
- groupes ;
- permissions ;
- modules ;
- navigation PWA ;
- activité ;
- notifications in-app ;
- recherche de base.

## Phase 2 — Organisation

- agenda ;
- tâches/corvées ;
- courses ;
- repas.

## Phase 3 — Communication et contenu

- chat ;
- bookmarks ;
- pages ;
- collections ;
- sondages ;
- idées.

## Phase 4 — PWA avancée

- Web Push ;
- offline ;
- synchronisation ;
- installabilité ;
- amélioration responsive.

## Phase 5 — Portabilité

- export ;
- import partiel ;
- sauvegarde ;
- restauration.

---

# 31. Critères d'acceptation produit globaux

Le produit est considéré fonctionnel lorsque :

1. une instance peut être créée ;
2. un admin peut inviter plusieurs membres ;
3. des groupes peuvent être définis ;
4. chaque objet privé est réellement inaccessible aux non-autorisés ;
5. un module peut être désactivé sans perdre ses données ;
6. deux utilisateurs peuvent discuter en privé ;
7. plusieurs utilisateurs peuvent discuter dans un chat de groupe ;
8. un événement peut être créé avec participants ;
9. une tâche récurrente datée apparaît dans l'agenda ;
10. une corvée ouverte sans date peut être réalisée par n'importe quel membre autorisé ;
11. l'historique indique qui a réalisé chaque occurrence ;
12. un plat peut produire des ingrédients ajoutables aux courses ;
13. la liste de courses fonctionne hors ligne ;
14. un bookmark privé reste privé ;
15. un bookmark partagé apparaît dans les recommandations des destinataires ;
16. une page peut être créée en éditeur visuel ;
17. une collection peut contenir des éléments structurés et des avis par membre ;
18. un sondage peut être créé et voté ;
19. l'accueil résume les nouveautés sans afficher chaque message de chat ;
20. la recherche ne retourne jamais un objet sans droit d'accès ;
21. l'application est utilisable sur iPhone, Android et desktop depuis le même codebase ;
22. les données principales peuvent être exportées dans des formats ouverts.
23. une instance peut être installée et mise à jour sur un NAS avec Docker Compose sans reconstruire le code source.

---

# 32. Contraintes UX

- Pas plus de 5 destinations principales visibles en permanence sur mobile.
- Chaque module désactivé disparaît.
- L'action `+` doit être globale.
- La visibilité doit utiliser le même composant dans tous les modules.
- L'utilisateur ne doit jamais avoir à comprendre le modèle interne de permissions.
- Les formulaires doivent privilégier des choix simples puis afficher les options avancées à la demande.
- Les écrans vides doivent proposer une action utile.
- Aucun dashboard ne doit afficher plus d'informations que nécessaire pour agir.

---

# 33. Direction technique proposée mais non imposée

Cette section est informative.

Architecture compatible avec le besoin :

- frontend PWA TypeScript ;
- backend API ;
- base relationnelle PostgreSQL ;
- stockage objet ou filesystem abstrait pour pièces jointes ;
- Service Worker ;
- IndexedDB pour cache/offline ;
- Web Push ;
- authentification locale initiale ;
- architecture modulaire côté frontend et backend.

Le choix final du framework reste ouvert.

L'implémentation doit privilégier :

- simplicité de maintenance ;
- typage fort ;
- tests ;
- migrations de base ;
- Docker ;
- configuration par variables d'environnement ;
- déploiement self-hosted simple.

Le dépôt doit fournir un fichier `compose.yaml` de production permettant de démarrer
l'application et ses dépendances avec une configuration minimale. Le déploiement doit :

- fonctionner sur architectures `amd64` et `arm64` ;
- conserver la base et les pièces jointes dans des volumes persistants distincts ;
- exposer des healthchecks ;
- permettre l'utilisation du reverse proxy HTTPS déjà présent sur un NAS ;
- documenter la mise à jour, la sauvegarde et la restauration ;
- éviter toute dépendance obligatoire à un service cloud tiers.

---

# 34. Priorités produit

Ordre de priorité :

1. confidentialité et permissions ;
2. simplicité UX ;
3. fiabilité des données ;
4. PWA réellement utilisable ;
5. modularité ;
6. offline pour les cas importants ;
7. fonctionnalités ;
8. esthétique avancée.

Une fonctionnalité qui ajoute beaucoup de complexité sans usage quotidien clair doit être reportée.

---

# 35. Instruction pour l'IA de développement

Avant d'implémenter :

1. produire le schéma d'architecture ;
2. produire le modèle de données ;
3. produire les flux d'authentification et permissions ;
4. produire le découpage en modules ;
5. produire les routes API principales ;
6. produire les écrans et navigation ;
7. identifier les dépendances entre modules ;
8. proposer le plan de migrations ;
9. proposer le plan de tests ;
10. attendre validation avant de générer l'ensemble du code.

Ne pas inventer de fonctionnalité majeure absente du PRD sans la signaler.

Lorsque le PRD laisse une ambiguïté, choisir la solution la plus simple compatible avec :

- privacy by design ;
- modularité ;
- PWA ;
- simplicité d'usage ;
- formats ouverts ;
- self-hosting.
