# État d'implémentation du PRD

Mise à jour : 13 septembre 2026.

## MVP fonctionnel

Les 23 critères d'acceptation globaux du PRD disposent d'un parcours implémenté : création
d'instance, invitations, groupes, permissions, modules, chat privé et de groupe, agenda,
tâches et corvées avec historique, repas vers courses, bookmarks, pages visuelles,
collections, sondages, accueil agrégé, recherche filtrée par droits, PWA responsive,
formats d'export ouverts et installation NAS par image Docker publiée.

Les cinq phases recommandées sont couvertes :

- socle, activité, notifications in-app, recherche et administration ;
- agenda, tâches, repas et courses ;
- chat, bookmarks, pages, collections, sondages et idées ;
- PWA installable, Web Push optionnel, offline prioritaire et synchronisation ;
- exports personnels/admin, import partiel de bookmarks et sauvegarde/restauration.

## Validation automatisée et opérationnelle

- tests unitaires et de contrats ;
- lint, typage et build de production ;
- image Docker locale complète ;
- migration d'une base PostgreSQL neuve ;
- export ZIP réellement ouvert et inspecté ;
- restauration après altération volontaire de la base et d'une pièce jointe ;
- configuration VAPID, abonnement/désabonnement et écoute PostgreSQL vérifiés ;
- import répété vérifiant confidentialité, tags et déduplication.

## Enrichissements restant hors critères globaux

Le PRD contient aussi des extensions qui ne bloquent pas le MVP et pourront constituer une
suite : import d'autres formats que les bookmarks JSON, avatar téléversé, interface
multilingue, quota global de stockage, SMTP, silence par conversation, fichiers attachés à
tous les types d'objet, et backend S3. Une matrice manuelle iPhone/Android et plusieurs
reverse proxies NAS reste recommandée avant une version déclarée stable.
