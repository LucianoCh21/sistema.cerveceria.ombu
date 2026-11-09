#!/usr/bin/env bash
# Apaga el túnel y los contenedores de Cervecería Ombú SIN borrar volúmenes (los datos quedan).
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"
PID_TUNEL="deploy/runtime/cloudflared.pid"

echo "==> Cerrando Cloudflare Tunnel"
if [ -f "$PID_TUNEL" ] && kill -0 "$(cat "$PID_TUNEL")" 2>/dev/null; then
    kill "$(cat "$PID_TUNEL")" && echo "    OK: túnel cerrado"
else
    echo "    El túnel no estaba activo"
fi
rm -f "$PID_TUNEL" deploy/runtime/url_publica.txt

echo "==> Deteniendo contenedores (los volúmenes NO se borran)"
# Las variables de deploy/.env solo se necesitan para interpolar el compose.
BASIC_AUTH_HASH="${BASIC_AUTH_HASH:-apagando}" docker compose -p ombu-deploy --env-file deploy/.env \
    -f docker-compose.yml -f docker-compose.deploy.yml down
echo "    OK: stack detenido. Para volver: ./deploy/levantar.sh (sin --primera-vez)"
