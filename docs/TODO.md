# Idées et évolutions à venir

Ce document recueille les évolutions produit à étudier ultérieurement. Une entrée dans cette
liste ne signifie pas qu'elle est planifiée ni en cours de développement.

## Chat — créer une conversation depuis un groupe existant

**Statut :** première version réalisée le 15 septembre 2026. La création d'une conversation de
groupe peut sélectionner un groupe existant sans recomposer ses participants ; elle conserve
aussi la sélection manuelle.

### Contexte

La création d'une conversation de groupe demande actuellement de sélectionner ses participants,
ce qui revient à recomposer un nouveau groupe. Or, la notion de groupe nommé et réutilisable a été
ajoutée après la conception initiale du chat. Les groupes existants (par exemple « Parents »,
« Enfants » ou « Tout le monde ») devraient pouvoir servir directement de base à une conversation.

### Comportement envisagé

- proposer les groupes existants lors de la création d'une conversation ;
- permettre de choisir un groupe sans devoir sélectionner à nouveau chacun de ses membres ;
- conserver la création actuelle par sélection manuelle de participants ;
- préciser lors de la conception si la conversation prend un instantané des membres au moment de
  sa création ou si ses participants suivent ensuite les changements apportés au groupe ;
- éviter la création de conversations en double lorsqu'une conversation liée à ce groupe existe
  déjà, ou avertir clairement l'utilisateur avant de continuer ;
- appliquer les règles habituelles de visibilité et d'accès du chat aux participants résultants.

### Décisions retenues pour cette version

- les participants actifs du groupe sont copiés lors de la création ; seuls les groupes dont le
  créateur fait partie et qui contiennent au moins un autre membre actif sont proposés ;
- le nom du groupe est proposé comme titre, que l'utilisateur peut personnaliser ;
- les changements ultérieurs du groupe n'ajoutent ni ne retirent automatiquement des participants
  du chat et ne changent pas rétroactivement l'accès à son historique ;
- une conversation de groupe avec les mêmes participants est signalée et peut être ouverte ;
  l'utilisateur peut encore en créer une autre si le sujet est différent ;
- aucun lien permanent au groupe n'est enregistré dans la conversation : le choix sert à sa
  création et ne remplace pas les permissions propres au chat.

### Suite éventuelle à étudier

- association permanente d'une conversation existante à un groupe ;
- synchronisation contrôlée des membres d'une conversation avec ceux du groupe, en définissant
  explicitement ce qu'un nouveau membre peut lire dans l'historique ;
- distinction entre plusieurs conversations d'un même groupe et une conversation « principale ».

## Chat — une conversation reste bloquée sur « Chargement… » après sélection

**Statut :** corrigé le 15 septembre 2026. Le clic sur la conversation déjà active ne réinitialise
plus les messages ; un échec de chargement affiche une erreur et une action « Réessayer ».

### Étapes de reproduction

1. ouvrir le module Chat alors qu'une conversation et ses messages sont affichés ;
2. cliquer dans la liste de gauche sur une conversation, y compris celle qui est déjà active ;
3. observer la zone des messages.

### Résultat observé

Les messages déjà visibles disparaissent et sont remplacés par « Chargement… ». La conversation
sélectionnée et ses messages ne finissent pas de s'afficher.

### Résultat attendu

- sélectionner une autre conversation doit afficher ses messages après le chargement ;
- sélectionner la conversation déjà active ne doit pas effacer les messages affichés ni déclencher
  un chargement permanent ;
- en cas d'échec de chargement, l'interface doit sortir de l'état d'attente et présenter une erreur
  explicite avec une possibilité de réessayer.

### Diagnostic et correction

Le clic sur la conversation déjà sélectionnée réinitialisait les messages et activait le
chargement, mais ne changeait pas son identifiant : l'effet de récupération ne se relançait
donc jamais. La nouvelle sélection identique est ignorée. Le chargement d'une autre
conversation peut être relancé après une erreur ; une sélection abandonnée ne doit pas
réécrire les messages de la conversation suivante.

## Courses — mieux suivre les demandes et les achats récents

**Statut :** première version réalisée le 15 septembre 2026. Le suivi distingue les demandes
manuelles des articles issus des repas et affiche les dates d'ajout et d'achat.

### Contexte

Lorsqu'un article est marqué comme acheté, il rejoint actuellement « Déjà acheté » sans indiquer
clairement quand l'achat a eu lieu. Un membre qui ne fait pas les courses, notamment un enfant ayant
ajouté une demande, doit pouvoir vérifier facilement si sa demande a été prise en compte et satisfaite.

Les articles ajoutés manuellement avec « Ajouter un article » ont donc un intérêt individuel plus
fort que les ingrédients ajoutés automatiquement depuis un plat. Cette différence d'origine doit
être prise en compte dans la présentation, sans rendre les ingrédients de repas invisibles.

### Comportement envisagé

- afficher la date, et éventuellement l'heure, à laquelle chaque article a été marqué comme acheté ;
- proposer une vue « Mes demandes » regroupant les articles ajoutés manuellement par l'utilisateur
  courant, avec leur état : à acheter ou acheté ;
- proposer une vue « Les demandes » regroupant les demandes manuelles de tous les membres afin que
  les autres membres, notamment celui qui fait les courses, puissent les retrouver rapidement ;
- afficher par défaut les demandes et achats récents sur une période glissante de trois jours ;
- permettre de distinguer visuellement l'auteur de la demande et l'origine de l'article : ajout
  manuel ou génération depuis le planning des repas ;
- donner davantage de visibilité aux demandes manuelles, sans modifier la capacité à cocher et
  gérer les ingrédients générés depuis les plats ;
- conserver un accès à un historique plus ancien si cela reste utile.

### Décisions retenues pour cette version

- « Mes demandes » montre les articles ajoutés manuellement par le membre courant ;
  « Les demandes » montre les articles manuels de tous les membres ; « Déjà acheté » montre
  les articles achetés, quelle que soit leur origine ;
- les achats sont récents pendant les 72 heures suivant leur date d'achat, pas leur date d'ajout ;
- une demande non satisfaite reste visible sans limite de trois jours ;
- les demandes manuelles apparaissent avant les ingrédients issus des repas dans la liste active ;
- vingt éléments d'historique sont affichés initialement, puis « Afficher plus » révèle les suivants ;
- les achats plus anciens restent accessibles sur demande, sans appel API supplémentaire ;
- les articles et achats restent conservés dans la base selon le comportement actuel : cette vue
  ne les supprime ni ne change leur durée de conservation.

### Suite éventuelle à étudier

- pagination côté serveur si la taille de l'historique devient coûteuse à charger ou à conserver
  hors connexion ;
- politique de conservation ou d'archivage explicite des anciens achats ;
- fusion de plusieurs demandes pour un même produit sans perdre leurs auteurs ;
- visibilité des demandes selon les droits, les groupes ou l'âge des membres si ce besoin apparaît.

### Critères d'usage à préserver

- un enfant doit pouvoir savoir rapidement si l'article qu'il a demandé a été acheté ;
- un parent qui ne fait pas les courses doit pouvoir suivre les demandes récentes du foyer ;
- la personne qui fait les courses doit identifier immédiatement les demandes explicites des membres ;
- une longue liste d'articles achetés ne doit pas encombrer en permanence la liste active.

## Affichages — modes liste et cartes mémorisés sur l'appareil

**Statut :** réalisé le 15 septembre 2026. Les préférences sont stockées localement par membre et
par module ; elles sont réinitialisées si les données de l'appareil sont supprimées et ne sont pas
synchronisées avec le profil.

### Comportement envisagé

- ajouter aux Bookmarks un choix entre une vue liste et une vue cartes ;
- utiliser la vue liste par défaut pour les Bookmarks tant que l'utilisateur n'a pas exprimé de choix ;
- ajouter aux Contacts externes un choix entre une vue liste et une vue cartes ;
- utiliser la vue cartes par défaut pour les Contacts externes tant que l'utilisateur n'a pas
  exprimé de choix ;
- mémoriser sur l'appareil le dernier mode choisi dans chacun de ces modules ;
- appliquer cette mémorisation à tous les autres modules proposant déjà, ou proposant à l'avenir,
  un choix entre les vues liste et cartes ;
- conserver une préférence distincte par module : choisir la vue liste dans Bookmarks ne doit pas
  modifier le mode d'affichage des Contacts, des Repas ou d'un autre module.

### Règle de repli

En l'absence de préférence enregistrée, chaque module utilise son affichage par défaut. Les défauts
demandés ici sont :

- Bookmarks : liste ;
- Contacts externes : cartes ;
- autres modules : conserver leur valeur par défaut actuelle, sauf décision produit ultérieure.

### Décisions retenues

- stockage uniquement dans le navigateur, sans synchronisation avec le profil ;
- préférence indépendante par membre et par module sur un même appareil ;
- retour au défaut du module après suppression des données locales, en navigation privée sans
  conservation des données, ou sur un nouvel appareil ;
- aucune migration nécessaire : les modules concernés n'enregistraient pas encore ce choix.
