#!/usr/bin/env bash
# Smoke test E1–E5 + Padlet 1 + verificaciones A/B (Padlet 2) contra la URL pública.
# Se ejecuta en la máquina que corre el stack (usa docker exec para SQL, Redis y RabbitMQ).
#   ./deploy/smoke-test.sh <dir_evidencias> [URL]     (URL por defecto: deploy/runtime/url_publica.txt)
# ATENCIÓN: modifica datos de demo (saldos, barril 7 retirado, barril 5) y detiene/arranca
# RabbitMQ y Redis. Al terminar, reinicializar con: ./deploy/levantar.sh [--vm] --primera-vez
# No imprime tokens ni contraseñas.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
set -a; . ./deploy/.env; set +a
EV="$1"; mkdir -p "$EV"
U="${2:-$(cat deploy/runtime/url_publica.txt)}"
TT="$TERMINAL_TOKEN"; AT="$ADMIN_TOKEN"
J='Content-Type: application/json'
sqlq() { docker exec sqlserver /opt/mssql-tools18/bin/sqlcmd -C -I -S localhost -U sa -P "$DB_PASSWORD" -d OmbuDB -h -1 -W -Q "SET NOCOUNT ON; $1"; }
log() { echo "$*" | tee -a "$EV/00_resumen.txt"; }
: > "$EV/00_resumen.txt"
log "Fecha (reloj de la máquina): $(date -Is)"
log "URL pública: $U"

# Recarga de saldo para poder hacer todas las pruebas (datos de demo; se resetean al final)
sqlq "UPDATE TarjetaNFC SET saldo_actual = 50000 WHERE id_tarjeta IN ('A1B2C3D4E5','F6G7H8I9J0');" >/dev/null

log; log "== E1 Muro público"
code=$(curl -s -o /dev/null -w '%{http_code}' "$U/"); log "GET / sin credenciales -> $code (esperado 401 basic_auth)"
curl -s -u "$BASIC_AUTH_USER:$BASIC_AUTH_PASSWORD" -D "$EV/E1_headers_index.txt" -o /dev/null "$U/"
log "GET / con credenciales -> $(head -1 "$EV/E1_headers_index.txt" | tr -d '\r')"
grep -iE 'x-content-type-options|x-frame-options|referrer-policy' "$EV/E1_headers_index.txt" | tr -d '\r' | sed 's/^/   /' | tee -a "$EV/00_resumen.txt"
curl -s -D "$EV/E1_headers_api.txt" "$U/api/canillas" > "$EV/E1_canillas.json"
log "GET /api/canillas -> $(head -1 "$EV/E1_headers_api.txt" | tr -d '\r'), canillas: $(jq length "$EV/E1_canillas.json")"
CFG=$(curl -s -u "$BASIC_AUTH_USER:$BASIC_AUTH_PASSWORD" "$U/src/config.js")
log "config.js servido: API_BASE relativo=$(echo "$CFG" | grep -c "location.origin + '/api'"), contiene tokens por defecto del repo=$(echo "$CFG" | grep -c -e 'admin-secret-token-ombu' -e 'terminal-secret-token-ombu')"
log "GET /api/nfc/tarjetas (token terminal, DEMO_MODE) -> $(curl -s -H "Authorization: Bearer $TT" "$U/api/nfc/tarjetas" | jq -r '"ok=" + (.ok|tostring) + " tarjetas=" + (.data|length|tostring)')"
log "Puertos publicados en el host: $(docker ps --format '{{.Ports}}' | grep -oE '[0-9.]+:[0-9]+->' | sort -u | tr '\n' ' ')"
curl -s "$U/api/health" > "$EV/E1_health.json"; log "GET /api/health -> $(cat "$EV/E1_health.json")"

log; log "== E2 Terminal NFC: tap -> formatos -> despacho (idempotente) -> PDF"
curl -s -H "Authorization: Bearer $TT" -H "$J" -d '{"id_tarjeta":"A1B2C3D4E5","id_canilla":1}' "$U/api/nfc/autenticar" > "$EV/E2_autenticar.json"
log "autenticar -> ok=$(jq .ok "$EV/E2_autenticar.json") ttl=$(jq .ttl_segundos "$EV/E2_autenticar.json")"
log "TTL en Redis: $(docker exec ombu-redis redis-cli TTL nfc:sesion:A1B2C3D4E5) s"
curl -s -H "Authorization: Bearer $TT" "$U/api/nfc/formatos?id_canilla=1" > "$EV/E2_formatos.json"
log "formatos -> $(jq -c '[.formatos[] | {id,nombre,precio}]' "$EV/E2_formatos.json")"
K="smoke-$(date +%s)"
curl -s -w '\nHTTP %{http_code}\n' -H "Authorization: Bearer $TT" -H "Idempotency-Key: $K" -H "$J" -d '{"id_tarjeta":"A1B2C3D4E5","id_canilla":1,"id_formato":1}' "$U/api/despachos" > "$EV/E2_despacho_1.txt"
curl -s -w '\nHTTP %{http_code}\n' -H "Authorization: Bearer $TT" -H "Idempotency-Key: $K" -H "$J" -d '{"id_tarjeta":"A1B2C3D4E5","id_canilla":1,"id_formato":1}' "$U/api/despachos" > "$EV/E2_despacho_2_mismo_key.txt"
ID=$(head -1 "$EV/E2_despacho_1.txt" | jq -r .id_despacho)
log "despacho #1 -> $(tail -1 "$EV/E2_despacho_1.txt") id=$ID"
log "despacho #2 misma clave -> $(tail -1 "$EV/E2_despacho_2_mismo_key.txt") idempotencia_aplicada=$(head -1 "$EV/E2_despacho_2_mismo_key.txt" | jq .idempotencia_aplicada) id=$(head -1 "$EV/E2_despacho_2_mismo_key.txt" | jq -r .id_despacho)"
log "filas en Despacho con ese id: $(sqlq "SELECT COUNT(*) FROM Despacho WHERE id_despacho = $ID;")"
curl -s -o "$EV/E2_comprobante_$ID.pdf" "$U/api/despachos/$ID/comprobante"
pdftotext "$EV/E2_comprobante_$ID.pdf" "$EV/E2_comprobante_$ID.txt" 2>/dev/null
log "comprobante -> $(head -c5 "$EV/E2_comprobante_$ID.pdf"), tarjeta: $(grep -o 'Tarjeta NFC: .*' "$EV/E2_comprobante_$ID.txt"), menciona saldo: $(grep -ci saldo "$EV/E2_comprobante_$ID.txt")"

log; log "== E3 Asíncrono: outbox -> RabbitMQ -> worker"
sleep 5
log "EventoOutbox del despacho $ID publicado_en: $(sqlq "SELECT CONVERT(varchar, publicado_en, 126) FROM EventoOutbox WHERE payload LIKE '%\"idDespacho\":$ID,%';")"
docker logs ombu-worker 2>&1 | grep -E "Despacho #$ID" | tee "$EV/E3_worker.log" | sed 's/^/   /' | tee -a "$EV/00_resumen.txt"
log "procesado por stock (idempotencia worker): $(sqlq "SELECT COUNT(*) FROM DespachoProcesadoStock WHERE id_despacho = $ID;")"

log; log "== E4 Panel admin: caché + conectar barril"
r1=$(curl -s -H "Authorization: Bearer $AT" "$U/api/stock/resumen" | jq -r .origen)
r2=$(curl -s -H "Authorization: Bearer $AT" "$U/api/stock/resumen" | jq -r .origen)
log "resumen 1 -> $r1, resumen 2 -> $r2, TTL caché: $(docker exec ombu-redis redis-cli TTL stock:muro:resumen) s"
curl -s -w ' HTTP %{http_code}' -H "Authorization: Bearer $AT" -H "$J" -d '{"id_barril":9,"id_canilla":8,"id_empleado_conexion":1}' "$U/api/barriles/conectar" > "$EV/E4_barril_inexistente.txt"
log "conectar barril 9 (no existe) -> $(cat "$EV/E4_barril_inexistente.txt")"
curl -s -w ' HTTP %{http_code}' -H "Authorization: Bearer $AT" -H "$J" -d '{"id_barril":2,"id_canilla":1,"id_empleado_conexion":1}' "$U/api/barriles/conectar" > "$EV/E4_canilla_ocupada.txt"
log "conectar barril 2 en canilla 1 (ocupada) -> $(cat "$EV/E4_canilla_ocupada.txt")"
curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TT" "$U/api/stock/resumen" > "$EV/E4_terminal_sin_rol.txt"
log "resumen con token de terminal (sin rol admin) -> HTTP $(cat "$EV/E4_terminal_sin_rol.txt")"
log "-- invalidación de caché (fix 12cb92f): retirar barril 7"
curl -s -H "Authorization: Bearer $AT" "$U/api/stock/resumen" >/dev/null
log "clave en caché antes: $(docker exec ombu-redis redis-cli EXISTS stock:muro:resumen)"
log "DELETE /api/barriles/7 -> HTTP $(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "Authorization: Bearer $AT" "$U/api/barriles/7")"
log "clave en caché después: $(docker exec ombu-redis redis-cli EXISTS stock:muro:resumen)"
log "siguiente resumen -> $(curl -s -H "Authorization: Bearer $AT" "$U/api/stock/resumen" | tee "$EV/E4_resumen_post_retiro.json" | jq -r '.origen + " canilla7_barril=" + ((.data[] | select(.id_canilla==7) | .id_barril) | tostring)')"

log; log "== Padlet 1 en vivo (fix 4fd5dd8)"
curl -s -H "Authorization: Bearer $TT" -H "$J" -d '{"id_tarjeta":"F6G7H8I9J0","id_canilla":2}' "$U/api/nfc/autenticar" >/dev/null
K2="paralelo-$(date +%s)"
for i in 1 2; do curl -s -w ' HTTP %{http_code}\n' -H "Authorization: Bearer $TT" -H "Idempotency-Key: $K2" -H "$J" -d '{"id_tarjeta":"F6G7H8I9J0","id_canilla":2,"id_formato":1}' "$U/api/despachos" > "$EV/P1_misma_clave_$i.txt" & done; wait
for i in 1 2; do log "misma clave en paralelo #$i -> $(jq -r '(.codigo // ("ok id=" + (.id_despacho|tostring)))' < <(sed 's/ HTTP.*//' "$EV/P1_misma_clave_$i.txt")) $(grep -o 'HTTP [0-9]*' "$EV/P1_misma_clave_$i.txt")"; done
curl -s -H "Authorization: Bearer $TT" -H "$J" -d '{"id_tarjeta":"F6G7H8I9J0","id_canilla":2}' "$U/api/nfc/autenticar" >/dev/null
for i in 1 2; do curl -s -w ' HTTP %{http_code}\n' -H "Authorization: Bearer $TT" -H "Idempotency-Key: dos-claves-$i-$(date +%s%N)" -H "$J" -d '{"id_tarjeta":"F6G7H8I9J0","id_canilla":2,"id_formato":1}' "$U/api/despachos" > "$EV/P1_un_tap_dos_claves_$i.txt" & done; wait
for i in 1 2; do log "un tap, dos claves #$i -> $(jq -r '(.codigo // ("ok id=" + (.id_despacho|tostring)))' < <(sed 's/ HTTP.*//' "$EV/P1_un_tap_dos_claves_$i.txt")) $(grep -o 'HTTP [0-9]*' "$EV/P1_un_tap_dos_claves_$i.txt")"; done

log; log "== E5a Resiliencia: RabbitMQ caído"
docker stop ombu-rabbitmq >/dev/null; log "docker stop ombu-rabbitmq"
curl -s -H "Authorization: Bearer $TT" -H "$J" -d '{"id_tarjeta":"A1B2C3D4E5","id_canilla":3}' "$U/api/nfc/autenticar" >/dev/null
curl -s -w ' HTTP %{http_code}' -H "Authorization: Bearer $TT" -H "Idempotency-Key: e5-$(date +%s)" -H "$J" -d '{"id_tarjeta":"A1B2C3D4E5","id_canilla":3,"id_formato":1}' "$U/api/despachos" > "$EV/E5_despacho_sin_rabbit.txt"
log "despacho con RabbitMQ caído -> $(grep -o 'HTTP [0-9]*' "$EV/E5_despacho_sin_rabbit.txt")"
sleep 5
log "eventos pendientes en outbox: $(sqlq "SELECT COUNT(*) FROM EventoOutbox WHERE publicado_en IS NULL;")"
log "health: $(curl -s "$U/api/health")"
docker start ombu-rabbitmq >/dev/null; log "docker start ombu-rabbitmq"
for s in $(seq 1 30); do sleep 3; p=$(sqlq "SELECT COUNT(*) FROM EventoOutbox WHERE publicado_en IS NULL;"); [ "$p" = "0" ] && break; done
log "eventos pendientes tras ~$((s*3)) s: $p"
sleep 8
docker logs ombu-worker 2>&1 | tail -8 > "$EV/E5_worker_reconexion.log"
log "worker (últimas líneas):"; sed 's/^/   /' "$EV/E5_worker_reconexion.log" | tee -a "$EV/00_resumen.txt"

log; log "== E5b Resiliencia: Redis caído"
docker stop ombu-redis >/dev/null; log "docker stop ombu-redis"
log "resumen stock -> $(curl -s -m 30 -w ' (%{time_total} s)' -H "Authorization: Bearer $AT" "$U/api/stock/resumen" | sed -E 's/.*"origen":"([a-z-]+)".*\(/origen=\1 (/')"
log "tap NFC -> $(curl -s -m 30 -w ' HTTP %{http_code} (%{time_total} s)' -H "Authorization: Bearer $TT" -H "$J" -d '{"id_tarjeta":"A1B2C3D4E5","id_canilla":1}' "$U/api/nfc/autenticar" | sed -E 's/.*"codigo":"([A-Z_]+)".*( HTTP [0-9]+.*)/\1\2/')"
docker start ombu-redis >/dev/null; log "docker start ombu-redis"
sleep 5
log "health tras reinicio: $(curl -s "$U/api/health")"

log; log "== Verificación A (Padlet 2, fix 669c3f4): exclusión mutua con UPDLOCK"
curl -s -H "Authorization: Bearer $TT" -H "$J" -d '{"id_tarjeta":"A1B2C3D4E5","id_canilla":4}' "$U/api/nfc/autenticar" >/dev/null
docker exec sqlserver /opt/mssql-tools18/bin/sqlcmd -C -I -S localhost -U sa -P "$DB_PASSWORD" -d OmbuDB -Q "BEGIN TRAN; SELECT id_barril FROM Barril WITH (UPDLOCK, ROWLOCK) WHERE id_canilla = 4 AND estado = 'Conectado' AND fecha_desconexion IS NULL; WAITFOR DELAY '00:00:08'; ROLLBACK;" >/dev/null &
SQLPID=$!; sleep 2
curl -s -o "$EV/A_despacho_bloqueado.json" -w '%{http_code} %{time_total}' -H "Authorization: Bearer $TT" -H "Idempotency-Key: lockA-$(date +%s)" -H "$J" -d '{"id_tarjeta":"A1B2C3D4E5","id_canilla":4,"id_formato":1}' "$U/api/despachos" > "$EV/A_tiempo.txt"
wait $SQLPID
log "otra sesión SQL retiene el barril de la canilla 4 durante 8 s; el despacho esperó y respondió HTTP $(cut -d' ' -f1 "$EV/A_tiempo.txt") en $(cut -d' ' -f2 "$EV/A_tiempo.txt") s"

log; log "== Verificación B (Padlet 2): sin sobreventa con dos despachos simultáneos"
sqlq "UPDATE Barril SET litros_restantes = 0.40 WHERE id_barril = 5;" >/dev/null
log "barril 5 (canilla 5) con 0.40 L: alcanza para una Media Pinta (0.25 L), no para dos"
for T in A1B2C3D4E5 F6G7H8I9J0; do curl -s -H "Authorization: Bearer $TT" -H "$J" -d "{\"id_tarjeta\":\"$T\",\"id_canilla\":5}" "$U/api/nfc/autenticar" >/dev/null; done
for T in A1B2C3D4E5 F6G7H8I9J0; do curl -s -w ' HTTP %{http_code}\n' -H "Authorization: Bearer $TT" -H "Idempotency-Key: raceB-$T-$(date +%s%N)" -H "$J" -d "{\"id_tarjeta\":\"$T\",\"id_canilla\":5,\"id_formato\":1}" "$U/api/despachos" > "$EV/B_$T.txt" & done; wait
for T in A1B2C3D4E5 F6G7H8I9J0; do log "tarjeta $T -> $(jq -r '(.codigo // ("ok id=" + (.id_despacho|tostring)))' < <(sed 's/ HTTP.*//' "$EV/B_$T.txt")) $(grep -o 'HTTP [0-9]*' "$EV/B_$T.txt")"; done
log "litros_restantes del barril 5 tras la carrera: $(sqlq "SELECT litros_restantes FROM Barril WHERE id_barril = 5;") (esperado 0.15)"
