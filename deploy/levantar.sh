#!/usr/bin/env bash
# Levanta Cervecería Ombú en modo despliegue y la publica con Cloudflare Tunnel.
#
#   ./deploy/levantar.sh                 # arranques normales (conserva los datos)
#   ./deploy/levantar.sh --primera-vez   # SOLO la primera vez: crea y carga OmbuDB (destructivo)
#
# Se puede ejecutar varias veces: si ya está todo arriba, solo vuelve a mostrar la URL.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

ENV_FILE="deploy/.env"
RUNTIME="deploy/runtime"
PID_TUNEL="$RUNTIME/cloudflared.pid"
LOG_TUNEL="$RUNTIME/cloudflared.log"
TIMEOUT_SQL=240
TIMEOUT_HEALTH=180
TIMEOUT_TUNEL=60

PRIMERA_VEZ=false
SIN_TUNEL=false
for arg in "$@"; do
    case "$arg" in
        --primera-vez) PRIMERA_VEZ=true ;;
        --sin-tunel)   SIN_TUNEL=true ;;
        *) echo "Opción desconocida: $arg (usar --primera-vez o --sin-tunel)"; exit 2 ;;
    esac
done

paso()  { echo; echo "==> $*"; }
ok()    { echo "    OK: $*"; }
error() { echo; echo "ERROR: $*" >&2; exit 1; }

dc() {
    docker compose -p ombu-deploy --env-file "$ENV_FILE" \
        -f docker-compose.yml -f docker-compose.deploy.yml "$@"
}

# ---------------------------------------------------------------- 1. Requisitos
paso "Verificando requisitos"
command -v docker >/dev/null || error "No se encontró 'docker'. Instalá Docker Desktop / Docker Engine."
docker info >/dev/null 2>&1 || error "Docker no responde o tu usuario no tiene permiso (¿Docker Desktop abierto? ¿usuario en el grupo 'docker'?)."
docker compose version >/dev/null 2>&1 || error "Falta 'docker compose' v2 (el plugin). 'docker-compose' v1 no sirve para este override."
ok "Docker y docker compose v2"

CLOUDFLARED="$(command -v cloudflared || true)"
[ -z "$CLOUDFLARED" ] && [ -x "$HOME/.local/bin/cloudflared" ] && CLOUDFLARED="$HOME/.local/bin/cloudflared"
if [ "$SIN_TUNEL" = false ]; then
    [ -n "$CLOUDFLARED" ] || error "No se encontró 'cloudflared'. Instalalo o usá --sin-tunel para probar solo en local."
    ok "cloudflared ($("$CLOUDFLARED" --version 2>&1 | head -1))"
fi

[ -f "$ENV_FILE" ] || error "Falta $ENV_FILE. Pedíselo a tu compañero/a (se pasa en privado) o copiá deploy/.env.deploy.example y completalo."
set -a; . "./$ENV_FILE"; set +a
for v in DB_PASSWORD RABBITMQ_USER RABBITMQ_PASS ADMIN_TOKEN TERMINAL_TOKEN BASIC_AUTH_USER BASIC_AUTH_PASSWORD; do
    [ -n "${!v:-}" ] || error "La variable $v está vacía en $ENV_FILE."
done
ok "$ENV_FILE completo"

PUERTO_LOCAL="${CADDY_HTTP_PORT##*:}"
URL_LOCAL="http://127.0.0.1:${PUERTO_LOCAL}"

# --------------------------------------------- 2. Archivos generados (no versionados)
paso "Generando configuración del cliente y credenciales de acceso"
mkdir -p "$RUNTIME"
cat > "$RUNTIME/config.js" <<EOF
// Generado por deploy/levantar.sh — NO editar ni commitear.
(function () {
    window.OMBU_CONFIG = {
        API_BASE: window.location.origin + '/api',
        TERMINAL_TOKEN: '${TERMINAL_TOKEN}',
        ADMIN_TOKEN: '${ADMIN_TOKEN}'
    };
})();
EOF
chmod 644 "$RUNTIME/config.js"
BASIC_AUTH_HASH="$(docker run --rm -e P="$BASIC_AUTH_PASSWORD" caddy:2-alpine sh -c 'caddy hash-password --plaintext "$P"')"
export BASIC_AUTH_HASH
ok "config.js y hash de basic_auth listos"

# ---------------------------------------------------------------- 3. Contenedores
paso "Construyendo y levantando contenedores (puede tardar varios minutos la primera vez)"
dc up -d --build
ok "Contenedores iniciados"

paso "Esperando a que SQL Server esté listo (máx. ${TIMEOUT_SQL}s)"
inicio=$SECONDS
# grep sin -q: con pipefail, -q cortaría el pipe y el until nunca terminaría
until dc logs sqlserver 2>/dev/null | grep "SQL Server is now ready for client connections" >/dev/null; do
    [ $((SECONDS - inicio)) -ge $TIMEOUT_SQL ] && error "SQL Server no arrancó a tiempo. Mirá: docker compose -p ombu-deploy logs sqlserver"
    sleep 3
done
sleep 5
ok "SQL Server listo"

# ---------------------------------------------------- 4. Base de datos (una sola vez)
if [ "$PRIMERA_VEZ" = true ]; then
    paso "INICIALIZACIÓN DE LA BASE (destructiva)"
    echo "    Esto BORRA todas las tablas de OmbuDB del proyecto ombu-deploy y carga los datos semilla."
    read -r -p "    Escribí BORRAR para continuar: " respuesta
    [ "$respuesta" = "BORRAR" ] || error "Cancelado: no se inicializó la base."
    dc exec -T api node init-db.js --force
    dc restart api worker >/dev/null
    ok "Base OmbuDB creada y cargada"
fi

# ---------------------------------------------------------------- 5. Health
paso "Esperando /api/health (máx. ${TIMEOUT_HEALTH}s)"
inicio=$SECONDS
until curl -fsS "$URL_LOCAL/api/health" 2>/dev/null | grep '"ok":true' >/dev/null; do
    if [ $((SECONDS - inicio)) -ge $TIMEOUT_HEALTH ]; then
        curl -sS "$URL_LOCAL/api/health" || true
        echo
        error "La API no quedó sana. Si es la primera vez en esta máquina, corré: ./deploy/levantar.sh --primera-vez"
    fi
    sleep 3
done
ok "API sana (SQL Server, Redis y RabbitMQ OK) en $URL_LOCAL"

if [ "$SIN_TUNEL" = true ]; then
    echo; echo "Listo en modo local: $URL_LOCAL  (usuario: $BASIC_AUTH_USER, contraseña en $ENV_FILE)"
    exit 0
fi

# ---------------------------------------------------------------- 6. Túnel
paso "Publicando con Cloudflare Tunnel"
if [ -f "$PID_TUNEL" ] && kill -0 "$(cat "$PID_TUNEL")" 2>/dev/null; then
    ok "El túnel ya estaba activo (PID $(cat "$PID_TUNEL"))"
else
    : > "$LOG_TUNEL"
    nohup "$CLOUDFLARED" tunnel --no-autoupdate --url "http://localhost:${PUERTO_LOCAL}" >"$LOG_TUNEL" 2>&1 &
    echo $! > "$PID_TUNEL"
fi

inicio=$SECONDS
URL_PUBLICA=""
until [ -n "$URL_PUBLICA" ]; do
    URL_PUBLICA="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_TUNEL" | head -1 || true)"
    [ $((SECONDS - inicio)) -ge $TIMEOUT_TUNEL ] && error "cloudflared no devolvió una URL. Revisá $LOG_TUNEL"
    sleep 2
done
echo "$URL_PUBLICA" > "$RUNTIME/url_publica.txt"

echo
echo "================================================================"
echo "  CERVECERÍA OMBÚ PUBLICADA"
echo "  URL:      $URL_PUBLICA"
echo "  Usuario:  $BASIC_AUTH_USER   (contraseña: BASIC_AUTH_PASSWORD en $ENV_FILE)"
echo "  Salud:    $URL_PUBLICA/api/health"
echo "  Apagar:   ./deploy/apagar.sh   (no borra datos)"
echo "================================================================"
