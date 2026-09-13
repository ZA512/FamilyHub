#!/bin/sh
set -eu

if [ "$#" -lt 2 ] || [ "$2" != "--confirm" ]; then
  echo "Usage: $0 BACKUP_DIRECTORY --confirm [COMPOSE_PROJECT]" >&2
  exit 2
fi

backup=$(CDPATH= cd -- "$1" && pwd)
project=${3:-}
repository=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
grep -q '"format": "familyhub-backup"' "$backup/manifest.json" || {
  echo "Format de sauvegarde FamilyHub non reconnu." >&2
  exit 1
}
expected_database=$(sed -n 's/.*"database.dump": "\([a-f0-9]*\)".*/\1/p' "$backup/manifest.json")
expected_attachments=$(sed -n 's/.*"attachments.tar.gz": "\([a-f0-9]*\)".*/\1/p' "$backup/manifest.json")
[ "$(sha256sum "$backup/database.dump" | cut -d ' ' -f 1)" = "$expected_database" ] || {
  echo "Empreinte invalide pour database.dump." >&2; exit 1;
}
[ "$(sha256sum "$backup/attachments.tar.gz" | cut -d ' ' -f 1)" = "$expected_attachments" ] || {
  echo "Empreinte invalide pour attachments.tar.gz." >&2; exit 1;
}

set -- compose
if [ -n "$project" ]; then set -- "$@" -p "$project"; fi
set -- "$@" -f "$repository/compose.yaml"
db_container=$(docker "$@" ps -q db)
app_container=$(docker "$@" ps -q app)
[ -n "$db_container" ] && [ -n "$app_container" ] || {
  echo "Les services FamilyHub app et db doivent être démarrés." >&2; exit 1;
}
db_user=$(docker inspect "$db_container" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^POSTGRES_USER=//p')
db_name=$(docker inspect "$db_container" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^POSTGRES_DB=//p')
attachment_volume=$(docker inspect "$app_container" --format '{{range .Mounts}}{{if eq .Destination "/data/attachments"}}{{.Name}}{{end}}{{end}}')
app_image=$(docker inspect "$app_container" --format '{{.Config.Image}}')
temporary_dump="/tmp/familyhub-restore-$$.dump"
trap 'docker exec "$db_container" rm -f "$temporary_dump" >/dev/null 2>&1 || true; docker "$@" start app >/dev/null' EXIT

docker "$@" stop app
docker cp "$backup/database.dump" "$db_container:$temporary_dump"
docker exec "$db_container" pg_restore -U "$db_user" -d "$db_name" \
  --clean --if-exists --no-owner --no-privileges "$temporary_dump"
docker run --rm -v "$attachment_volume:/target" -v "$backup:/backup:ro" \
  --entrypoint sh "$app_image" -c \
  'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xzf /backup/attachments.tar.gz -C /target'
docker "$@" start app
trap - EXIT
docker exec "$db_container" rm -f "$temporary_dump"
echo "Restauration terminée. Vérifiez /api/v1/health/ready."
