# Registre des décisions à valider

Ce registre résume les choix structurants proposés. Une décision acceptée devient stable ;
une évolution ultérieure est documentée par une nouvelle entrée plutôt que par la réécriture
silencieuse de l'historique.

| ID | Décision proposée | État |
|---|---|---|
| D-001 | Monorepo TypeScript, React/Vite pour la PWA et Fastify pour l'API | Acceptée |
| D-002 | PostgreSQL et Drizzle, migrations SQL inspectables | Acceptée |
| D-003 | Une image applicative servant frontend, API, WebSocket et jobs légers | Acceptée |
| D-004 | Docker Compose à deux services obligatoires : application et base | Acceptée |
| D-005 | Pièces jointes sur volume local, abstraction S3 optionnelle | Acceptée |
| D-006 | Reverse proxy/TLS du NAS par défaut, Caddy facultatif | Acceptée |
| D-007 | Sessions par cookie sécurisé et Argon2id, sans fournisseur externe | Acceptée |
| D-008 | ACL transversales centralisées et filtrage SQL avant recherche/pagination | Acceptée |
| D-009 | IndexedDB et journal de mutations idempotentes pour l'offline | Acceptée |
| D-010 | Redis, moteur de recherche et MinIO non requis au MVP | Acceptée |

## Conséquences connues

- Le déploiement reste accessible à un foyer sans compétences Kubernetes.
- Le processus applicatif unique est suffisant pour la charge cible mais ne prétend pas à
  une haute disponibilité multi-nœuds au MVP.
- PostgreSQL est l'unique dépendance stateful obligatoire et doit être sauvegardé avec les
  pièces jointes.
- La PWA et l'API peuvent évoluer indépendamment dans le code tout en partageant leurs
  contrats et leur cycle de release.
