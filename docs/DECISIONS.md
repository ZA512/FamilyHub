# Registre des décisions à valider

Ce registre résume les choix structurants proposés. Une décision acceptée devient stable ;
une évolution ultérieure est documentée par une nouvelle entrée plutôt que par la réécriture
silencieuse de l'historique.

| ID    | Décision proposée                                                                                                                                              | État     |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| D-001 | Monorepo TypeScript, React/Vite pour la PWA et Fastify pour l'API                                                                                              | Acceptée |
| D-002 | PostgreSQL et Drizzle, migrations SQL inspectables                                                                                                             | Acceptée |
| D-003 | Une image applicative servant frontend, API, WebSocket et jobs légers                                                                                          | Acceptée |
| D-004 | Docker Compose à deux services obligatoires : application et base                                                                                              | Acceptée |
| D-005 | Pièces jointes sur volume local, abstraction S3 optionnelle                                                                                                    | Acceptée |
| D-006 | Reverse proxy/TLS du NAS par défaut, Caddy facultatif                                                                                                          | Acceptée |
| D-007 | Sessions par cookie sécurisé et Argon2id, sans fournisseur externe                                                                                             | Acceptée |
| D-008 | ACL transversales centralisées et filtrage SQL avant recherche/pagination                                                                                      | Acceptée |
| D-009 | IndexedDB et journal de mutations idempotentes pour l'offline                                                                                                  | Acceptée |
| D-010 | Redis, moteur de recherche et MinIO non requis au MVP                                                                                                          | Acceptée |
| D-011 | Le module Tâches garde une seule destination et expose deux concepts UX, Tâche et Routine ; destinataire et planification restent des dimensions indépendantes | Acceptée |
| D-012 | Créer un chat depuis un groupe copie ses membres actifs au moment de la création, sans synchronisation automatique de l'accès et de l'historique               | Acceptée |
| D-013 | Une conversation créée depuis un groupe conserve un lien informatif vers ce groupe, sans que ce lien accorde ou retire automatiquement l'accès au chat         | Acceptée |
| D-014 | Le chat n'a pas de conversation principale par groupe : il trie les conversations par dernière activité et ouvre la plus récente                               | Acceptée |
| D-015 | Un achat reste consultable sept jours puis est supprimé physiquement ; une demande non achetée est conservée sans limite automatique                           | Acceptée |

## Conséquences connues

- Le déploiement reste accessible à un foyer sans compétences Kubernetes.
- Le processus applicatif unique est suffisant pour la charge cible mais ne prétend pas à
  une haute disponibilité multi-nœuds au MVP.
- PostgreSQL est l'unique dépendance stateful obligatoire et doit être sauvegardé avec les
  pièces jointes.
- La PWA et l'API peuvent évoluer indépendamment dans le code tout en partageant leurs
  contrats et leur cycle de release.
- Le groupe d'origine d'un chat reste identifiable même si sa composition change. Le lien est
  supprimé si le groupe disparaît, sans supprimer la conversation ni son historique.
- Faire évoluer automatiquement les participants d'un chat requerrait toujours une règle explicite
  sur l'accès des nouveaux membres aux anciens messages ; le lien informatif ne change donc pas les
  permissions de la conversation.
- Les conversations remontent naturellement lors d'un nouveau message, sans configuration propre à
  chaque groupe.
- L'historique des courses sert au suivi immédiat des demandes familiales, pas aux statistiques de
  consommation. Les tickets de caisse restent la source d'archive éventuelle.
