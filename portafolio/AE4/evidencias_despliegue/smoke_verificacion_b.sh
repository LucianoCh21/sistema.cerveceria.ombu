#!/usr/bin/env bash
# Smoke test E1–E5 contra la URL pública. Uso: smoke.sh <evidencias_dir>
# No imprime tokens ni contraseñas.
set -uo pipefail
cd /home/lucre/Documentos/sistema.cerveceria.ombu
set -a; . ./deploy/.env; set +a
EV="$1"; mkdir -p "$EV"
U="$(cat deploy/runtime/url_publica.txt)"
TT="$TERMINAL_TOKEN"; AT="$ADMIN_TOKEN"
J='Content-Type: application/json'
sqlq() { docker exec sqlserver /opt/mssql-tools18/bin/sqlcmd -C -I -S localhost -U sa -P "$DB_PASSWORD" -d OmbuDB -h -1 -W -Q "SET NOCOUNT ON; $1"; }
log() { echo "$*" | tee -a "$EV/00_resumen.txt"; }
log "Fecha (reloj de la máquina): $(date -Is)"
log "URL pública: $U"

# Recarga de saldo para poder hacer todas las pruebas (datos de demo; se resetean al final)
sqlq "UPDATE TarjetaNFC SET saldo_actual = 50000 WHERE id_tarjeta IN ('A1B2C3D4E5','F6G7H8I9J0');" >/dev/null

log; log "== E3 (reconsulta): eventos del outbox publicados"
log "$(sqlq "SELECT CAST(COUNT(*) AS varchar) + ' publicados de ' + CAST((SELECT COUNT(*) FROM EventoOutbox) AS varchar) FROM EventoOutbox WHERE publicado_en IS NOT NULL;")"
log "$(sqlq "SELECT TOP 1 'Ultimo evento: id=' + CAST(id_evento AS varchar) + ' tipo=' + tipo + ' publicado_en=' + CONVERT(varchar, publicado_en, 126) FROM EventoOutbox ORDER BY id_evento DESC;")"
log; log "== Verificación B (Padlet 2): sin sobreventa con dos despachos simultáneos"
sqlq "UPDATE Barril SET litros_restantes = 0.40 WHERE id_barril = 5;" >/dev/null
log "barril 5 (canilla 5) con 0.40 L: alcanza para una Media Pinta (0.25 L), no para dos"
for T in A1B2C3D4E5 F6G7H8I9J0; do curl -s -H "Authorization: Bearer $TT" -H "$J" -d "{\"id_tarjeta\":\"$T\",\"id_canilla\":5}" "$U/api/nfc/autenticar" >/dev/null; done
for T in A1B2C3D4E5 F6G7H8I9J0; do curl -s -w ' HTTP %{http_code}\n' -H "Authorization: Bearer $TT" -H "Idempotency-Key: raceB-$T-$(date +%s%N)" -H "$J" -d "{\"id_tarjeta\":\"$T\",\"id_canilla\":5,\"id_formato\":1}" "$U/api/despachos" > "$EV/B_$T.txt" & done; wait
for T in A1B2C3D4E5 F6G7H8I9J0; do log "tarjeta $T -> $(jq -r '(.codigo // ("ok id=" + (.id_despacho|tostring)))' < <(sed 's/ HTTP.*//' "$EV/B_$T.txt")) $(grep -o 'HTTP [0-9]*' "$EV/B_$T.txt")"; done
log "litros_restantes del barril 5 tras la carrera: $(sqlq "SELECT litros_restantes FROM Barril WHERE id_barril = 5;") (esperado 0.15; sin el fix: dos cobros y 0.00)"
