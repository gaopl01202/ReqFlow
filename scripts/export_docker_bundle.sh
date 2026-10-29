#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /secure/path/reqflow-portable-bundle.tar.gz" >&2
  exit 2
fi

output=$(mkdir -p "$(dirname "$1")" && cd "$(dirname "$1")" && pwd)/$(basename "$1")
if [[ -e "$output" ]]; then
  echo "Refusing to overwrite existing bundle: $output" >&2
  exit 1
fi

root=$(cd "$(dirname "$0")/.." && pwd)
deploy="$root/deploy"
work=$(mktemp -d)
umask 077
mkdir -m 0700 "$work/bundle"
bundle="$work/bundle"

cd "$deploy"
docker compose ps --status running db >/dev/null
docker compose stop app web scheduler
restart_services() {
  docker compose start app web scheduler >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap restart_services EXIT

docker compose exec -T db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$bundle/database.dump"
docker compose run --rm --no-deps -T --entrypoint python app \
  /app/scripts/volume_archive.py pack /var/lib/reqflow/attachments > "$bundle/attachments.tar.gz"
docker image save -o "$bundle/images.tar" \
  reqflow/app:stable \
  reqflow/web:stable \
  public.ecr.aws/docker/library/postgres:17-alpine

tar -czf "$bundle/source.tar.gz" -C "$root" \
  Dockerfile .dockerignore requirements.lock backend frontend/dist deploy/compose.yaml \
  deploy/Dockerfile.web deploy/nginx.conf scripts/volume_archive.py
cp "$deploy/.env" "$bundle/deployment.env"
cp -a "$root/tls" "$bundle/tls"
chmod 0600 "$bundle/tls/privkey.pem"
(cd "$bundle" && sha256sum database.dump attachments.tar.gz images.tar source.tar.gz deployment.env tls/* > SHA256SUMS)

mkdir -m 0700 -p "$(dirname "$output")"
tar -czf "$output" -C "$bundle" database.dump attachments.tar.gz images.tar source.tar.gz deployment.env tls SHA256SUMS
chmod 0600 "$output"
echo "Portable bundle created: $output"
