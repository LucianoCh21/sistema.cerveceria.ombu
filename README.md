# Cervecería Ombú - Módulo: Barriles y Control de Stock (AE2)
**Autor:** Luciano Rubén Chesani
**Rama:** `ae2/barriles-stock`

Este módulo gestiona el inventario de barriles en frío, la asignación a las canillas del Tap Wall, y el descuento de litros de forma reactiva mediante mensajería asíncrona.

## Arquitectura Implementada
- **Backend:** Node.js / Express
- **Base de Datos:** SQL Server 2022 (Docker) - Concurrencia controlada con aislamiento `SERIALIZABLE` y bloqueos `UPDLOCK` (RN-03).
- **Caché Efímera:** Redis (Docker) - Patrón de degradación controlada implementado para el resumen del Dashboard.
- **Mensajería Asíncrona:** RabbitMQ (Docker) - Consumidor backend para descuento de stock con validación de idempotencia (RNF-08).
- **Frontend:** Vanilla JS inyectado dinámicamente con interacción mediante modales personalizados HTML/CSS.

## Pasos para Ejecutar el Entorno

### 1. Levantar la Infraestructura
Asegúrese de tener Docker Desktop iniciado. En la raíz del proyecto, levante los contenedores:
\`\`\`bash
docker compose up -d
\`\`\`
*Nota: Esto levantará SQL Server (puerto 1434), Redis y RabbitMQ. Aguarde 15 segundos para que la base de datos inicie por completo.*

### 2. Configurar Variables de Entorno
Dentro de la carpeta `server/`, cree un archivo `.env` configurando las credenciales de conexión:
\`\`\`env
DB_USER="sa"
DB_PASSWORD="TuPassword123!"
DB_SERVER="localhost"
DB_DATABASE="OmbuDB"
DB_PORT=1434
\`\`\`

### 3. Instalar Dependencias e Inicializar Base de Datos
Desde la terminal, ingrese a la carpeta del servidor e instale los paquetes:
\`\`\`bash
cd server
npm install
npm run init-db
\`\`\`
*Este comando creará la base de datos `OmbuDB`, ejecutará el script DDL/DML y poblará las tablas de barriles, canillas y precios.*

### 4. Iniciar el Servidor API y el Consumidor
En la misma carpeta `server/`, encienda la aplicación:
\`\`\`bash
node index.js
\`\`\`
*Verá en consola que el servidor Express está activo y que el Worker de RabbitMQ se encuentra escuchando eventos.*

### 5. Ejecutar el Frontend
Abra el archivo `client/index.html` utilizando la extensión **Live Server** en Visual Studio Code.
Navegue a la sección **"Barriles y Stock"** en el menú lateral para ver el dashboard en tiempo real, visualizar la velocidad de la caché y probar la reasignación de barriles mediante el modal interactivo.

## Despliegue (AE4)

La solución se publica en Internet con **Docker Compose + Caddy + Cloudflare Tunnel**, sin abrir puertos. Guía de 1 página: [`deploy/LEEME_DESPLIEGUE.md`](deploy/LEEME_DESPLIEGUE.md).

```bash
cp deploy/.env.deploy.example deploy/.env   # completar (o usar el .env privado del equipo)
./deploy/levantar.sh --primera-vez          # solo la primera vez: crea y carga OmbuDB (pide confirmación)
./deploy/levantar.sh                        # arranques siguientes; imprime la URL pública https://….trycloudflare.com
./deploy/apagar.sh                          # apaga túnel y contenedores SIN borrar volúmenes
```

| Pieza | Rol |
|---|---|
| `docker-compose.deploy.yml` | Override del compose base: proyecto `ombu-deploy`, secretos desde `deploy/.env`, puertos internos solo en `127.0.0.1`, servicio `caddy` |
| `deploy/Caddyfile` | Único origen: `/api/*` → `api:3000`, resto → `client:80`; headers `nosniff`/`DENY`; `basic_auth` solo en páginas estáticas. `SITE_ADDRESS=:80` (túnel) o un dominio (VM con TLS automático) |
| `deploy/levantar.sh` | Verifica requisitos, genera `config.js` del cliente con tokens rotados, levanta, espera SQL Server y `/api/health`, inicializa la base solo con `--primera-vez`, abre el túnel |
| `deploy/.env` | **Privado, nunca se commitea** (`.gitignore`). Contraseñas, tokens y credenciales de acceso |

Pruebas automatizadas que no necesitan infraestructura (aisladas, sin base ni red):

```bash
cd server && node --test --test-force-exit $(ls tests/*.test.js | grep -v -e ae3_carga -e ae3_estres)
```

## Verificación local y CI (AE4 B01)

Desde `server/`, ejecutar `npm ci --no-audit --no-fund` y `npm run test:unit` con Node.js 24 LTS. Esta selección usa dobles y fixtures en memoria. El workflow **AE4 CI** ejecuta las mismas pruebas y construye la imagen del backend en el runner sin publicarla. [Informe de implementación y verificación B01](portafolio/AE4/AE4_B01_CI_PIPELINE_REPORT.md).

## Mejoras diagnosticadas

Problemas detectados y **no** corregidos en esta entrega, presentados como *observación → diagnóstico → plan*. Las correcciones ya aplicadas en AE4 son: UPDLOCK en la lectura de stock (Padlet 2), idempotencia atómica `SET NX` + `GETDEL` de la sesión (Padlet 1), invalidación de caché al conectar/retirar barriles y comprobante sin UID completo ni saldo (Padlet 3).

| # | Observación | Diagnóstico | Plan |
|---|---|---|---|
| 1 | El comprobante `GET /api/despachos/:id/comprobante` responde sin token | No hay control de propietario (IDOR); la terminal lo abre con `window.open`, que no puede enviar `Authorization` | URL firmada temporal (token en Redis con TTL) que sirva también como QR de validación |
| 2 | CORS acepta cualquier origen | El callback de `cors` termina siempre en `callback(null, true)` (`server/index.js`) | Rechazar orígenes fuera de `CLIENT_ORIGIN`; con Caddy el navegador ya usa un único origen |
| 3 | Canillas, barriles y stock ejecutan SQL en el controlador | Anti-patrón "Controlador Gordo": mezcla HTTP y datos (Mantenibilidad) | Extraer `services/` y `repositories/` como en el módulo de despachos |
| 4 | Algunas entradas inválidas terminan en 500 | Lista de estados de canilla distinta del CHECK de la base; número duplicado y tipos de `conectarBarril` sin validar | Validación de esquema en el backend y traducción de errores SQL a 400/409 |
| 5 | No se puede dar de alta un barril y conectarlo | El modelo no tiene estado `Disponible`; conectar acepta cualquier barril no retirado, incluso uno en uso | Propuesta IB: estado `Disponible`, alta con ID generado, selector en el panel y conectar solo desde `Disponible` |
| 6 | `/api/health` abre una conexión AMQP en cada llamada | Costo de conexión por sondeo; también devuelve 503 si cae RabbitMQ aunque la API siga operativa | Reusar el canal compartido y separar liveness de readiness |
| 7 | El Outbox Publisher corre con `setInterval` dentro de la API | Con dos réplicas ambas publicarían los mismos eventos | Proceso propio con una sola instancia, o `UPDLOCK, READPAST` al tomar pendientes |
| 8 | Tokens fijos por rol, sin JWT | Credenciales compartidas y sin expiración | Login con JWT firmado (expiración, rol, sujeto) |
| 9 | La "latencia media" de las pruebas de estrés baja al subir la carga | Se calcula como tiempo total ÷ N (inverso del throughput); no hay p95 | Medir la latencia por request (autocannon/k6) con media y p95 sobre el flujo de despacho |
| 10 | Parte de las pruebas no ejercita código real y no hay E2E | `dia4`/`dia6` validan objetos locales; la pirámide queda sin el 10 % E2E | Reemplazarlas por pruebas con dobles sobre los servicios y sumar E2E del recorrido NFC → despacho → PDF |
| 11 | CI B01 definido; registry, CD y alta disponibilidad pendientes | Pruebas y build sin publicación en GitHub Actions; primera corrida remota por verificar. Despliegue manual con una sola réplica | Verificar B01 por SHA; después, publicar por digest y evaluar redundancia y healthchecks |
| 12 | `init-db.js` borra todas las tablas | Script pensado para desarrollo | Inicialización idempotente que solo crea el esquema si no existe |
