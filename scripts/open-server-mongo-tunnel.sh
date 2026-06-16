#!/usr/bin/env bash
set -Eeuo pipefail

SERVER_SSH="${SERVER_SSH:-deploy-user@example-host.invalid}"
LOCAL_MONGO_PORT="${LOCAL_MONGO_PORT:-27018}"
REMOTE_MONGO_PORT="${REMOTE_MONGO_PORT:-27018}"

echo "Opening Mongo SSH tunnel: 127.0.0.1:${LOCAL_MONGO_PORT} -> ${SERVER_SSH} -> 127.0.0.1:${REMOTE_MONGO_PORT}"
echo "Keep this terminal open while using the server Mongo locally."

ssh -N -L "${LOCAL_MONGO_PORT}:127.0.0.1:${REMOTE_MONGO_PORT}" "$SERVER_SSH"
