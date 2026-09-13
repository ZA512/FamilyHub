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
- import répété vérifiant confidentialité, tags et déduplication ;
- migration 19 vérifiée sur une base neuve, avec avatar réel, anniversaire récurrent,
  confidentialité inter-membres et dépassement du quota refusé en HTTP 507.

Les paramètres personnels couvrent désormais l’avatar, les coordonnées, le fuseau, la
langue et la confidentialité du profil. La date de naissance maintient automatiquement un
événement annuel dans l’agenda. L’administration affiche l’usage des fichiers et permet de
régler le quota global du foyer, ainsi que l’espace libre réel du volume. Elle permet aussi
de gérer le rôle et l’activation des membres, avec protection du dernier administrateur,
révocation des sessions concernées et annulation des invitations encore en attente.

Chaque conversation peut être rendue silencieuse sans quitter le chat. L’import de favoris
accepte désormais les exports HTML Netscape et les arborescences JSON des navigateurs, en
plus des archives FamilyHub, avec normalisation et déduplication des liens.
Un relais SMTP peut être configuré pour envoyer les invitations automatiquement, sans
supprimer le parcours autonome par lien copiable si le relais est absent ou indisponible.

## Enrichissements restant hors critères globaux

Le PRD contient aussi des extensions qui ne bloquent pas le MVP et pourront constituer une
suite : interface entièrement traduite, fichiers attachés à tous les types d'objet et
backend S3.
Une matrice manuelle iPhone/Android et plusieurs reverse proxies NAS reste recommandée avant
une version déclarée stable.
