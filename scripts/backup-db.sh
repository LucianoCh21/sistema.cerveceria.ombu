#!/usr/bin/env bash
# ==============================================================================
# Script de Respaldo Físico de Base de Datos - Cervecería Ombú (ISO/IEC 25010 F-10)
# Realiza un backup completo de OmbuDB a disco dentro del contenedor SQL Server.
# ==============================================================================

set -euo pipefail

FECHA=$(date +"%Y%m%d_%H%M%S")
CONTAINER_NAME="${SQL_CONTAINER:-sqlserver}"
BACKUP_DIR="/var/opt/mssql/backup"
BACKUP_FILE="${BACKUP_DIR}/OmbuDB_${FECHA}.bak"
DB_PASSWORD="${DB_PASSWORD:-TuPassword123!}"

echo "=========================================================="
echo "🍺 Iniciando Backup de Seguridad de Base de Datos: OmbuDB"
echo "📅 Marca de tiempo: ${FECHA}"
echo "🐳 Contenedor destino: ${CONTAINER_NAME}"
echo "📁 Archivo de salida: ${BACKUP_FILE}"
echo "=========================================================="

# Asegurar la existencia del directorio de backups dentro del contenedor
docker exec "${CONTAINER_NAME}" mkdir -p "${BACKUP_DIR}"

# Ejecutar el comando de backup con sqlcmd oficial de SQL Server 2022
docker exec "${CONTAINER_NAME}" /opt/mssql-tools18/bin/sqlcmd \
  -S localhost \
  -U sa \
  -P "${DB_PASSWORD}" \
  -C \
  -Q "BACKUP DATABASE [OmbuDB] TO DISK = N'${BACKUP_FILE}' WITH NOFORMAT, NOINIT, NAME = N'OmbuDB Backup ${FECHA}', SKIP, NOREWIND, NOUNLOAD, STATS = 10"

echo "=========================================================="
echo "✅ Backup completado exitosamente."
echo "📦 Ubicación: ${BACKUP_FILE}"
echo "=========================================================="
