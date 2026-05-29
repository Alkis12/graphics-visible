#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER_NAME="graphics_visible"
IMAGE_NAME="graphics-visible:latest"
NETWORK_NAME="external-network"

cd "$APP_DIR"

echo "Pulling latest code..."
git pull --ff-only origin main

echo "Building Docker image..."
docker build -t "$IMAGE_NAME" .

echo "Restarting container..."
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --network "$NETWORK_NAME" \
  "$IMAGE_NAME"

echo "Current container:"
docker ps --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Networks}}"
