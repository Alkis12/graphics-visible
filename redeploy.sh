#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_TARGET="${DEPLOY_TARGET:-local}"

if [[ -z "${SSH_BIN:-}" ]]; then
  SSH_BIN="ssh"
  if grep -qi microsoft /proc/version 2>/dev/null && [[ -x /mnt/c/Windows/System32/OpenSSH/ssh.exe ]]; then
    SSH_BIN="/mnt/c/Windows/System32/OpenSSH/ssh.exe"
  fi
fi

if [[ "$DEPLOY_TARGET" == "remote" ]]; then
  PROD_HOST="${PROD_HOST:?Set PROD_HOST to the SSH destination}"
  PROD_APP_DIR="${PROD_APP_DIR:?Set PROD_APP_DIR to the application directory on the server}"
  remote_app_dir="$(printf "%q" "$PROD_APP_DIR")"
  echo "Deploying on $PROD_HOST..."
  "$SSH_BIN" "$PROD_HOST" "cd $remote_app_dir && git pull --ff-only origin main && DEPLOY_TARGET=local ./redeploy.sh"
  exit 0
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTERNAL_NETWORK_NAME="${EXTERNAL_NETWORK_NAME:-}"

cd "$APP_DIR"

echo "Pulling latest code..."
git pull --ff-only origin main

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi

  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}

ensure_env_var() {
  local key="$1"
  local value="$2"

  if ! grep -q "^${key}=" .env 2>/dev/null; then
    echo "${key}=${value}" >> .env
  fi
}

set_env_var() {
  local key="$1"
  local value="$2"
  local tmp

  if grep -q "^${key}=" .env 2>/dev/null; then
    tmp="$(mktemp)"
    awk -v key="$key" -v value="$value" '
      index($0, key "=") == 1 {
        print key "=" value
        next
      }
      { print }
    ' .env > "$tmp"
    mv "$tmp" .env
    chmod 600 .env
  else
    echo "${key}=${value}" >> .env
  fi
}

if [[ ! -f .env ]]; then
  echo "Creating .env with generated production secrets..."
  mongo_db="graphics_visible"
  mongo_root_user="graphics_visible_admin"
  mongo_root_password="$(generate_secret)"
  {
    echo "APP_HOST=127.0.0.1"
    echo "APP_PORT=8080"
    echo "MONGO_DB=${mongo_db}"
    echo "MONGO_ROOT_USER=${mongo_root_user}"
    echo "MONGO_ROOT_PASSWORD=${mongo_root_password}"
    echo "MONGO_HOST=127.0.0.1"
    echo "MONGO_PORT=27018"
    echo "SESSION_SECRET=$(generate_secret)"
    echo "TRUST_PROXY=true"
    echo "COOKIE_SECURE=true"
  } > .env
  chmod 600 .env
fi

set_env_var "MONGO_HOST" "${MONGO_HOST:-127.0.0.1}"
ensure_env_var "MONGO_PORT" "27018"
set_env_var "ODEON_USERNAME" "${ODEON_USERNAME:-odeon_manager}"

for required_key in MONGO_ROOT_PASSWORD SESSION_SECRET; do
  if ! grep -Eq "^${required_key}=.+" .env; then
    echo "Missing required ${required_key} in .env" >&2
    exit 1
  fi
done

if docker ps -a --format '{{.Names}}' | grep -Fxq "graphics_visible"; then
  EXISTING_APP_PROJECT="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' graphics_visible 2>/dev/null || true)"
  if [[ "$EXISTING_APP_PROJECT" != "graphics-visible" ]]; then
    echo "Removing legacy graphics_visible container..."
    docker rm -f graphics_visible >/dev/null
  fi
fi

echo "Building and restarting containers..."
docker compose up -d --build

APP_CONTAINER="$(docker compose ps -q app)"

if [[ -n "$APP_CONTAINER" && -n "$EXTERNAL_NETWORK_NAME" ]] && docker network inspect "$EXTERNAL_NETWORK_NAME" >/dev/null 2>&1; then
  if ! docker inspect "$APP_CONTAINER" --format '{{json .NetworkSettings.Networks}}' | grep -q "\"$EXTERNAL_NETWORK_NAME\""; then
    echo "Connecting app container to $EXTERNAL_NETWORK_NAME..."
    docker network connect "$EXTERNAL_NETWORK_NAME" "$APP_CONTAINER" || true
  fi
fi

echo "Current container:"
docker ps --filter "name=graphics_visible" --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Networks}}"

echo "Seeding default users and Odeon dashboards..."
docker compose exec -T app npm run seed
