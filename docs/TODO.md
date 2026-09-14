# Idées et évolutions à venir

Ce document recueille les évolutions produit à étudier ultérieurement. Une entrée dans cette
liste ne signifie pas qu'elle est planifiée ni en cours de développement.

## Chat — créer une conversation depuis un groupe existant

**Statut :** idée à étudier — ne pas développer pour le moment.

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

### Points à décider avant implémentation

- lien dynamique ou instantané entre le groupe et les participants de la conversation ;
- effet de l'ajout ou du retrait ultérieur d'un membre du groupe sur l'historique du chat ;
- possibilité d'associer après coup une conversation existante à un groupe ;
- titre de conversation proposé par défaut et possibilité de le personnaliser.

## Chat — une conversation reste bloquée sur « Chargement… » après sélection

**Statut :** bug à diagnostiquer — ne pas corriger pour le moment.

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

### Pistes à vérifier lors du diagnostic

- cycle de l'état de chargement lors d'un changement de conversation ;
- cas particulier d'une nouvelle sélection de l'identifiant déjà actif ;
- requête de récupération des messages, gestion de son annulation et de ses erreurs ;
- éventuelle réponse mise en cache ignorée ou écrasée par une requête concurrente.

## Courses — mieux suivre les demandes et les achats récents

**Statut :** idée à étudier — ne pas développer pour le moment.

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

### Points à décider avant implémentation

- point de départ exact des trois jours : date d'ajout, date d'achat ou les deux selon la liste ;
- comportement d'une demande ancienne qui n'a toujours pas été achetée ;
- séparation en onglets, filtres ou sections de « Mes demandes », « Les demandes » et « Déjà acheté » ;
- nombre d'articles affichés avant pagination et type de pagination ou de chargement progressif ;
- durée de conservation de l'historique des achats et possibilité de choisir une autre période ;
- traitement des articles fusionnés lorsque plusieurs sources demandent le même produit ;
- visibilité des demandes selon les droits, les groupes et l'âge des membres.

### Critères d'usage à préserver

- un enfant doit pouvoir savoir rapidement si l'article qu'il a demandé a été acheté ;
- un parent qui ne fait pas les courses doit pouvoir suivre les demandes récentes du foyer ;
- la personne qui fait les courses doit identifier immédiatement les demandes explicites des membres ;
- une longue liste d'articles achetés ne doit pas encombrer en permanence la liste active.
