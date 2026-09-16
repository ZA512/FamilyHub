# Idées et évolutions à venir

Ce document recueille les évolutions produit à étudier ultérieurement. Une entrée dans cette
liste ne signifie pas qu'elle est planifiée ni en cours de développement.

## Chat — créer une conversation depuis un groupe existant

**Statut :** réalisée. Depuis le 15 septembre 2026, la création d'une conversation de groupe peut
sélectionner un groupe existant sans recomposer ses participants et conserve aussi la sélection
manuelle. Depuis le 16 septembre 2026, la conversation garde également un lien durable vers son
groupe d'origine.

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
- le groupe source est enregistré avec la conversation et permet de retrouver celle-ci même si la
  composition du groupe change ensuite ;
- ce lien reste informatif : les permissions du chat reposent toujours sur ses participants et ne
  sont pas modifiées automatiquement avec le groupe ;
- si le groupe est supprimé, le lien est retiré sans supprimer la conversation ni son historique.
- pour rester simple et prévisible dans un usage familial, aucune synchronisation automatique ou
  manuelle des membres du groupe vers la conversation n'est prévue ;
- il n'existe pas de conversation « principale » : la liste est triée par dernière activité et
  ouvre la conversation la plus récente, à la manière d'une messagerie classique.

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

**Statut :** réalisé. Depuis le 15 septembre 2026, le suivi distingue les demandes manuelles des
articles issus des repas et affiche les dates d'ajout et d'achat. Depuis le 16 septembre 2026, les
filtres de membre et d'état s'appliquent aussi aux achats, lesquels sont supprimés après sept jours.

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
- conserver pendant sept jours un accès borné aux achats plus anciens.

### Décisions retenues pour cette version

- « Mes demandes » montre les articles ajoutés manuellement par le membre courant et « Toutes les
  demandes » ceux de tous les membres ;
- un second filtre permet d'afficher tous les états, uniquement les demandes à acheter ou uniquement
  celles déjà achetées ; les deux filtres se combinent ;
- les achats sont récents pendant les 72 heures suivant leur date d'achat, pas leur date d'ajout ;
- une demande non satisfaite reste visible sans limite de trois jours ;
- les demandes manuelles apparaissent avant les ingrédients issus des repas dans la liste active ;
- vingt éléments d'historique sont affichés initialement, puis « Afficher plus » révèle les suivants ;
- les achats des jours 4 à 7 restent accessibles avec « Voir jusqu'à sept jours » ;
- au-delà de sept jours après l'achat, l'article est supprimé physiquement lors du prochain accès
  au module Courses ; les articles non achetés ne sont jamais concernés par cette purge ;
- cette conservation courte borne naturellement le volume chargé, donc aucune pagination serveur
  supplémentaire n'est nécessaire ;
- les demandes identiques restent des lignes distinctes : deux demandes de la même chose représentent
  bien deux articles à acheter ;
- aucune visibilité fondée sur l'âge n'est introduite.

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

## Navigation mobile — « Plus » ouvre la création rapide au lieu des autres modules

**Statut :** corrigé le 16 septembre 2026. « Plus » ouvre désormais la navigation vers les
modules secondaires ; le bouton vert « + » reste réservé à la création rapide.

### Contexte et reproduction

Sur téléphone, la barre de navigation inférieure contient « Accueil », « Chat », « Agenda »,
« Tâches » et « Plus ». Un bouton flottant vert « + » est également affiché au-dessus de cette
barre.

1. ouvrir un écran mobile, par exemple Documents ;
2. toucher « Plus » dans la barre de navigation ;
3. fermer le menu, puis toucher le bouton flottant vert « + ».

### Résultat observé

Les deux boutons ouvrent le même menu de création rapide. Le code confirme que l'entrée « Plus »
appelle actuellement la même action que le bouton vert. Il ne s'agit donc pas, en premier lieu,
d'un problème de recouvrement ou de zone tactile.

Ce comportement empêche d'utiliser « Plus » pour accéder aux modules absents de la barre mobile,
notamment Repas et les autres entrées visibles dans la navigation de bureau. Choisir « Repas »
depuis ce menu propose d'ajouter un repas au lieu d'ouvrir le module Repas. Le module Chat y est
par ailleurs nommé « Message », alors que la navigation principale utilise « Chat ».

### Résultat attendu

- « Plus » ouvre un menu ou un panneau de **navigation** vers les modules non affichés dans la
  barre mobile ;
- choisir « Repas », « Courses », « Documents » ou un autre module ouvre sa page, sans lancer
  automatiquement une création ;
- le bouton flottant vert « + » reste l'accès à la **création rapide** ;
- les modules proposés dans « Plus » respectent les modules activés, les préférences de visibilité
  et les droits du membre, comme la navigation de bureau ;
- la terminologie du module reste « Chat » dans la navigation. Si une action de création est
  affichée dans le menu « + », employer un libellé d'action explicite comme « Nouveau message »
  afin de ne pas confondre destination et création ;
- vérifier lors de la correction que le bouton flottant ne masque aucun élément de navigation ou
  bouton d'action, y compris avec la zone de sécurité basse du téléphone.

### Critères d'acceptation

- depuis n'importe quel écran mobile, « Plus » permet d'ouvrir Repas et chaque module disponible
  qui n'a pas sa propre entrée dans la barre inférieure ;
- toucher « Plus » n'ouvre jamais le formulaire de création rapide ;
- toucher le bouton vert « + » continue d'ouvrir la création rapide ;
- fermer l'un des deux menus ou utiliser le retour du téléphone ramène à l'écran courant sans
  navigation ou création involontaire ;
- les libellés « Chat » et « Nouveau message » sont employés de façon cohérente selon qu'il s'agit
  de naviguer ou de créer.
