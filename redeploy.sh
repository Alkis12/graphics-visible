#!/usr/bin/env bash
set -Eeuo pipefail

PROD_HOST="${PROD_HOST:-deploy-user@example-host.invalid}"
PROD_HOSTNAME="${PROD_HOSTNAME:-production-host}"
PROD_APP_DIR="${PROD_APP_DIR:-/srv/graphics-visible}"

if [[ -z "${SSH_BIN:-}" ]]; then
  SSH_BIN="ssh"
  if grep -qi microsoft /proc/version 2>/dev/null && [[ -x /mnt/c/Windows/System32/OpenSSH/ssh.exe ]]; then
    SSH_BIN="/mnt/c/Windows/System32/OpenSSH/ssh.exe"
  fi
fi

if [[ "${DEPLOY_TARGET:-prod}" == "prod" && "$(hostname)" != "$PROD_HOSTNAME" ]]; then
  remote_env=""
  for key in ODEON_USERNAME ODEON_PASSWORD; do
    value="${!key:-}"
    if [[ -n "$value" ]]; then
      remote_env+="${key}=$(printf "%q" "$value") "
    fi
  done

  echo "Deploying on $PROD_HOST..."
  "$SSH_BIN" "$PROD_HOST" "cd '$PROD_APP_DIR' && git pull --ff-only origin main && ${remote_env}./redeploy.sh"
  exit 0
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NETWORK_NAME="external-network"

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
  {
    echo "APP_HOST=127.0.0.1"
    echo "APP_PORT=8080"
    echo "MONGO_DB=planetra_dashboards"
    echo "MONGO_ROOT_USER=dashboards_admin"
    echo "MONGO_ROOT_PASSWORD=$(generate_secret)"
    echo "MONGO_HOST=0.0.0.0"
    echo "MONGO_PORT=27018"
    echo "SESSION_SECRET=$(generate_secret)"
    echo "TRUST_PROXY=true"
    echo "COOKIE_SECURE=true"
    echo "PUBLIC_MONGO_USERNAME=dashboards_user"
    echo "PUBLIC_MONGO_PASSWORD=$(generate_secret)"
  } > .env
  chmod 600 .env
fi

ensure_env_var "MONGO_HOST" "0.0.0.0"
ensure_env_var "MONGO_PORT" "27018"
ensure_env_var "PUBLIC_MONGO_USERNAME" "dashboards_user"
ensure_env_var "PUBLIC_MONGO_PASSWORD" "$(generate_secret)"
set_env_var "ODEON_USERNAME" "${ODEON_USERNAME:-odeon_manager}"
if [[ -n "${ODEON_PASSWORD:-}" ]]; then
  set_env_var "ODEON_PASSWORD" "$ODEON_PASSWORD"
else
  ensure_env_var "ODEON_PASSWORD" ""
fi

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

if [[ -n "$APP_CONTAINER" ]] && docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
  if ! docker inspect "$APP_CONTAINER" --format '{{json .NetworkSettings.Networks}}' | grep -q "\"$NETWORK_NAME\""; then
    echo "Connecting app container to $NETWORK_NAME..."
    docker network connect "$NETWORK_NAME" "$APP_CONTAINER" || true
  fi
fi

echo "Current container:"
docker ps --filter "name=graphics_visible" --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Networks}}"

echo "Seeding default users and Odeon dashboards..."
docker compose exec -T app npm run seed

set -a
source .env
set +a

