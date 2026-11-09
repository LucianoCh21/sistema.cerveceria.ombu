#!/usr/bin/env bash
# Genera un deploy/.env NUEVO para la VM (contraseñas y tokens propios, distintos del local).
# Se guarda en deploy/runtime/vm.env, que .gitignore excluye. Nunca se commitea.
#   ./deploy/generar_env_vm.sh <FQDN> <ACME_EMAIL>
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FQDN="${1:?Uso: generar_env_vm.sh <FQDN> <ACME_EMAIL>}"
EMAIL="${2:?Uso: generar_env_vm.sh <FQDN> <ACME_EMAIL>}"
SALIDA="$RAIZ/deploy/runtime/vm.env"

if [ -e "$SALIDA" ]; then
    echo "Ya existe $SALIDA: no se pisa (borralo a mano si querés regenerarlo)."
    exit 0
fi
mkdir -p "$(dirname "$SALIDA")"
umask 077
R() { openssl rand -hex "$1"; }
sed -e "s|^SITE_ADDRESS=.*|SITE_ADDRESS=${FQDN}|" \
    -e "s|^CADDY_HTTP_PORT=.*|CADDY_HTTP_PORT=80|" \
    -e "s|^CADDY_HTTPS_PORT=.*|CADDY_HTTPS_PORT=443|" \
    -e "s|^ACME_EMAIL=.*|ACME_EMAIL=${EMAIL}|" \
    -e "s|^CLIENT_ORIGIN=.*|CLIENT_ORIGIN=https://${FQDN}|" \
    -e "s|^BASIC_AUTH_PASSWORD=.*|BASIC_AUTH_PASSWORD=$(R 9)|" \
    -e "s|^DB_PASSWORD=.*|DB_PASSWORD=Ombu-$(R 12)-X9|" \
    -e "s|^RABBITMQ_PASS=.*|RABBITMQ_PASS=$(R 16)|" \
    -e "s|^ADMIN_TOKEN=.*|ADMIN_TOKEN=adm-$(R 24)|" \
    -e "s|^TERMINAL_TOKEN=.*|TERMINAL_TOKEN=term-$(R 24)|" \
    "$RAIZ/deploy/.env.deploy.example" > "$SALIDA"
echo "OK: $SALIDA generado (permisos 600). No se imprimen los valores."
