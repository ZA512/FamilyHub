#!/bin/sh
set -eu

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 OUTPUT_DIRECTORY [COMPOSE_PROJECT]" >&2
  exit 2
fi

case "$1" in
  /*) output_root=$1 ;;
  *) output_root="$(pwd)/$1" ;;
esac
mkdir -p "$output_root"
project=${2:-}
repository=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_directory="$output_root/familyhub-$stamp"
mkdir "$backup_directory"

set -- compose
if [ -n "$project" ]; then set -- "$@" -p "$project"; fi
set -- "$@" -f "$repository/compose.yaml"
db_container=$(docker "$@" ps -q db)
app_container=$(docker "$@" ps -q app)
[ -n "$db_container" ] && [ -n "$app_container" ] || {
  echo "Les services FamilyHub app et db doivent être démarrés." >&2
  exit 1
}

db_user=$(docker inspect "$db_container" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^POSTGRES_USER=//p')
db_name=$(docker inspect "$db_container" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^POSTGRES_DB=//p')
temporary_dump="/tmp/familyhub-$stamp.dump"
trap 'docker exec "$db_container" rm -f "$temporary_dump" >/dev/null 2>&1 || true' EXIT
docker exec "$db_container" pg_dump -U "$db_user" -d "$db_name" -Fc -f "$temporary_dump"
docker cp "$db_container:$temporary_dump" "$backup_directory/database.dump"

attachment_volume=$(docker inspect "$app_container" --format '{{range .Mounts}}{{if eq .Destination "/data/attachments"}}{{.Name}}{{end}}{{end}}')
app_image=$(docker inspect "$app_container" --format '{{.Config.Image}}')
[ -n "$attachment_volume" ] || { echo "Volume de pièces jointes introuvable." >&2; exit 1; }
docker run --rm -v "$attachment_volume:/source:ro" -v "$backup_directory:/backup" \
  --entrypoint sh "$app_image" -c 'tar -czf /backup/attachments.tar.gz -C /source .'

schema=$(docker exec "$db_container" psql -U "$db_user" -d "$db_name" -Atc 'select count(*) from drizzle.__drizzle_migrations;')
revision=$(docker inspect "$app_container" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')
database_hash=$(sha256sum "$backup_directory/database.dump" | cut -d ' ' -f 1)
attachments_hash=$(sha256sum "$backup_directory/attachments.tar.gz" | cut -d ' ' -f 1)
cat >"$backup_directory/manifest.json" <<EOF
{
  "format": "familyhub-backup",
  "version": 1,
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "image": "$app_image",
  "revision": "$revision",
  "schemaMigrations": $schema,
  "files": {
    "database.dump": "$database_hash",
    "attachments.tar.gz": "$attachments_hash"
  }
}
EOF
echo "$backup_directory"
