#!/usr/bin/env bash
# Restaura los datos de la demo SIN borrar nada (no usa init-db ni borra volúmenes).
#
#   ./deploy/reset-demo.sh        # pide confirmación
#   ./deploy/reset-demo.sh -y     # sin preguntar
#
# Qué vuelve a los valores de la semilla (server/db/schema.sql):
#   - Saldo y estado de las 2 tarjetas: A1B2C3D4E5 = 6500, F6G7H8I9J0 = 5000, 'Activa'.
#   - Barriles 1..7: conectados en las canillas 1..7, con 50 L (el 1 con 49,50 L).
#   - Canillas 1..7 'Activa' y 8..10 'Inactiva' (un barril agotado deja su canilla en 'Sin Stock').
#   - Barriles agregados después de la semilla que estén conectados: pasan a 'Retirado' para liberar la canilla.
#   - Redis: caché del muro y sesiones NFC abiertas.
# Qué NO toca: el historial de despachos y recargas, el outbox, el esquema y los volúmenes.
# Requiere el stack ombu-deploy levantado (./deploy/levantar.sh). Funciona en Linux y en WSL.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"
ENV_FILE="deploy/.env"

error() { echo; echo "ERROR: $*" >&2; exit 1; }
dc() {
    docker compose -p ombu-deploy --env-file "$ENV_FILE" \
        -f docker-compose.yml -f docker-compose.deploy.yml "$@"
}

[ -f "$ENV_FILE" ] || error "Falta $ENV_FILE."
if grep -q $'\r' "$ENV_FILE"; then
    error "$ENV_FILE tiene fin de línea de Windows (CRLF). Corregilo con: sed -i 's/\r\$//' $ENV_FILE"
fi
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
[ -n "${DB_PASSWORD:-}" ] || error "Falta DB_PASSWORD en $ENV_FILE."
# compose valida esta variable aunque caddy no se use acá.
export BASIC_AUTH_HASH="${BASIC_AUTH_HASH:-reset-demo}"

docker info >/dev/null 2>&1 || error "Docker no responde (¿Docker Desktop abierto? ¿permiso sobre docker?)."
dc ps --status running --services 2>/dev/null | grep -x sqlserver >/dev/null \
    || error "El stack no está levantado. Corré primero ./deploy/levantar.sh"

if [ "${1:-}" != "-y" ]; then
    echo "Esto vuelve saldos, barriles y canillas a los valores iniciales de la demo."
    echo "No borra el historial de despachos ni la base."
    read -r -p "¿Continuar? [s/N] " resp
    [ "$resp" = "s" ] || [ "$resp" = "S" ] || { echo "Cancelado."; exit 0; }
fi

SQL="
SET NOCOUNT ON; SET XACT_ABORT ON;
BEGIN TRAN;
UPDATE Barril
   SET estado = 'Retirado', id_canilla = NULL, fecha_desconexion = GETDATE()
 WHERE id_barril > 7 AND estado = 'Conectado';
UPDATE b
   SET b.id_canilla = v.canilla, b.litros_totales = 50.00, b.litros_restantes = v.litros,
       b.estado = 'Conectado', b.fecha_desconexion = NULL, b.fecha_conexion = GETDATE()
  FROM Barril b
  JOIN (VALUES (1,1,49.50),(2,2,50.00),(3,3,50.00),(4,4,50.00),(5,5,50.00),(6,6,50.00),(7,7,50.00))
       AS v(id_barril, canilla, litros) ON b.id_barril = v.id_barril;
UPDATE Canilla SET estado = CASE WHEN id_canilla <= 7 THEN 'Activa' ELSE 'Inactiva' END
 WHERE id_canilla BETWEEN 1 AND 10;
UPDATE t SET t.saldo_actual = v.saldo, t.estado = 'Activa'
  FROM TarjetaNFC t
  JOIN (VALUES ('A1B2C3D4E5', 6500.00), ('F6G7H8I9J0', 5000.00)) AS v(id_tarjeta, saldo)
    ON t.id_tarjeta = v.id_tarjeta;
COMMIT;
SELECT 'tarjeta ' + id_tarjeta + ' saldo=' + CAST(saldo_actual AS varchar(20)) FROM TarjetaNFC ORDER BY id_tarjeta;
SELECT 'barril ' + CAST(id_barril AS varchar(5)) + ' canilla=' + CAST(id_canilla AS varchar(5))
       + ' litros=' + CAST(litros_restantes AS varchar(10)) + ' ' + estado
  FROM Barril WHERE estado = 'Conectado' ORDER BY id_canilla;
"

echo "==> Restaurando SQL Server"
# La contraseña viaja como variable de entorno (SQLCMDPASSWORD), no como argumento visible en 'ps'.
dc exec -T -e SQLCMDPASSWORD="$DB_PASSWORD" sqlserver \
    /opt/mssql-tools18/bin/sqlcmd -C -I -b -S localhost -U sa -d OmbuDB -h -1 -W -Q "$SQL" \
    || error "Falló la restauración en SQL Server (no se aplicó nada: la transacción es indivisible)."

echo "==> Limpiando Redis (caché del muro y sesiones NFC)"
dc exec -T redis sh -c "redis-cli DEL stock:muro:resumen >/dev/null; \
    redis-cli --scan --pattern 'nfc:sesion:*' | xargs -r redis-cli DEL >/dev/null" \
    || echo "    Aviso: no se pudo limpiar Redis; la caché expira sola en 60 s."

echo
echo "OK: demo restaurada."
