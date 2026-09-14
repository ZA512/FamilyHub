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
