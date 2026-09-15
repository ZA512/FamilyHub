# État d'implémentation du PRD

Mise à jour : 15 septembre 2026.

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
L’interface complète, les messages de validation, les notifications in-app et Web Push,
les dates, les nombres et le calendrier sont disponibles en français et en anglais. Le
choix enregistré dans le profil s’applique immédiatement et suit la session sur les autres
appareils.

Le premier jour du planning des repas est configurable par un administrateur pour tout le
foyer. La navigation hebdomadaire et le retour à la semaine courante respectent ce choix,
avec le lundi comme valeur compatible pour les installations existantes.
La bibliothèque des plats utilise une liste compacte par défaut, compare les avis de tous
les membres actifs, filtre par titre, ingrédient, membre et avis, et conserve une vue en
cartes ainsi qu’un aperçu détaillé au survol ou au focus.
Le choix liste/cartes est maintenant mémorisé sur l'appareil, séparément par membre et par
module. Bookmarks propose les deux vues avec la liste par défaut ; Contacts externes
propose les deux vues avec les cartes par défaut ; Repas conserve la liste par défaut.
Dans le chat, sélectionner à nouveau la conversation active ne vide plus ses messages ni ne
laisse l'écran bloqué sur « Chargement… ». Un échec réel du chargement des messages affiche
une erreur et permet de réessayer.

Le module Tâches distingue désormais les tâches à terminer des routines permanentes sans
multiplier les entrées de navigation. Une création peut cibler soi-même, une personne, un
groupe ou tout le foyer, avec visibilité déduite automatiquement. Les tâches personnelles
sans date, les tâches ouvertes ponctuelles, le journal réel des réalisations et les
statistiques de routines filtrables par période et par personne sont couverts.

## Enrichissements restant hors critères globaux

Le PRD contient aussi des extensions qui ne bloquent pas le MVP et pourront constituer une
suite : fichiers attachés à tous les types d'objet et backend S3.
Une matrice manuelle iPhone/Android et plusieurs reverse proxies NAS reste recommandée avant
une version déclarée stable.
