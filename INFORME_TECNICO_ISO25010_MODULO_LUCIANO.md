# Informe Técnico de Calidad de Software (ISO/IEC 25010)
## Módulo de Stock, Barriles, Infraestructura y Dashboard
**Proyecto:** Sistema de Autoservicio y Despacho - Cervecería Ombú  
**Responsable del Módulo:** Luciano Rubén Chesani  
**Destinataria / Contexto de Integración:** Lucrecia Sabrina Mencia  
**Fecha de Elaboración:** Octubre 2026  
**Rama Local:** `feature/iso25010-luciano`  

---

## 1. Resumen Ejecutivo y Propósito

El presente documento detalla exhaustivamente las refactorizaciones, correcciones y mejoras de calidad arquitectónica realizadas sobre el módulo de **Stock, Barriles, Infraestructura y Dashboard** de la Cervecería Ombú, en el marco de la auditoría técnica basada en el estándar internacional **ISO/IEC 25010 (SQuaRE)**.

El objetivo central fue erradicar inconsistencias transaccionales (doble descuento de litros y mermas aleatorias), robustecer la resiliencia en la mensajería asíncrona (RabbitMQ con DLQ y reconexión automática), elevar los estándares de seguridad frontend (mitigación XSS y modales semánticos nativos), desacoplar la arquitectura en contenedores independientes (API, Worker, Nginx) y asegurar la trazabilidad del sistema con cobertura de pruebas y contratos formales OpenAPI 3.0.

```
                    ┌────────────────────────────────────────┐
                    │      ARQUITECTURA REFACTORIZADA        │
                    └───────────────────┬────────────────────┘
                                        │
           ┌────────────────────────────┼────────────────────────────┐
           ▼                            ▼                            ▼
 ┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
 │    Nginx Client  │         │    Node.js API   │         │  RabbitMQ Worker │
 │  HTML5 + Dialog  │────────▶│  Express (REST)  │────────▶│  stockConsumer   │
 │   + escapeHTML   │   HTTP  │   /api/health    │  AMQP   │   DLQ + Retries  │
 └──────────────────┘         └─────────┬────────┘         └─────────┬────────┘
                                        │                            │
                                        ▼                            ▼
                              ┌──────────────────┐         ┌──────────────────┐
                              │SQL Server (OmbuDB│         │   Redis Cache    │
                              │  ACID + Outbox   │         │  Sesiones + TTL  │
                              └──────────────────┘         └──────────────────┘
```

---

## 2. Desglose Detallado por Tarea y Característica de Calidad

---

### TAREA 1: Consumidor Asíncrono de Stock y Tolerancia a Fallos
* **Norma ISO/IEC 25010:** Adecuación Funcional (Exactitud / Integridad) y Fiabilidad (Tolerancia a Fallos y Madurez).
* **Identificadores de Requisito:** **F-01** y **F-08**
* **Archivo Modificado:** `server/workers/stockConsumer.js`

#### ¿Cuál era el problema previo?
1. **Doble descuento de litros y desincronización:** Cuando un cliente servía una pinta, el controlador de despachos ya realizaba el descuento matemático en SQL Server dentro de la transacción ACID. Sin embargo, el worker de RabbitMQ (`stockConsumer.js`) volvía a aplicar un `UPDATE Barril SET litros_restantes = litros_restantes - @volumenFinal` y, peor aún, multiplicaba el volumen por un factor de merma aleatoria (`factorMerma = 1 + Math.random() * 0.10`). Esto provocaba descuadres contables y stock fantasma.
2. **Falta de resiliencia en mensajería:** La URL de RabbitMQ estaba fijada en `localhost`. Si el procesamiento de un mensaje arrojaba un error imprevisto (ej. base de datos temporalmente ocupada), el worker realizaba `channel.nack(msg, false, true)`, reencolando el mensaje indefinidamente en bucle infinito (*poison message*), saturando la CPU y la cola. Además, si RabbitMQ reiniciaba, el proceso de Node.js quedaba huérfano sin intentar reconectarse.

#### ¿Cómo se resolvió?
* **F-01:** Se eliminó por completo el `UPDATE` de litros restantes y la lógica de merma aleatoria. Ahora el evento de dominio emitido por despachos incluye `idBarril`. El consumidor ejecuta una única consulta SQL de actualización de estado:
  ```sql
  UPDATE c
  SET c.estado = 'Sin Stock'
  FROM Canilla c
  INNER JOIN Barril b ON c.id_canilla = b.id_canilla
  WHERE b.id_barril = @idBarril AND b.estado = 'Agotado'
  ```
* **F-08:** Se parametrizó la URL AMQP mediante variable de entorno:
  ```javascript
  const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
  ```
* **F-08:** Se implementó una **Dead Letter Queue (DLQ)** completa:
  * Exchange DLX: `ombu.dlx` (tipo `topic`, durable).
  * Cola DLQ: `stock.despachos.dlq` vinculada a `ombu.dlx` con routing key `#`.
  * La cola principal `stock.despachos.queue` se declaró con el argumento `deadLetterExchange: 'ombu.dlx'`.
  * Ante un error, se inspecciona el encabezado AMQP `x-reintentos`:
    * Si `reintentos < 3`: Se reenvía a la cola con `x-reintentos` incrementado en 1 y se hace `channel.ack(msg)` del original.
    * Si `reintentos >= 3`: Se descarta con `channel.nack(msg, false, false)`, haciendo que RabbitMQ lo envíe automáticamente a la DLQ para inspección forense sin bloquear el flujo.
  * Se añadió el manejador `connection.on('close')` que dispara un reintento automático de conexión cada 5 segundos.

#### ¿Cómo funciona ahora?
La base de datos relacional es la única autoridad en el cómputo de litros debitados. El consumidor asíncrono se limita a su verdadera responsabilidad: monitorear si el barril conectado se agotó para cambiar el estado operativo de la canilla física a `'Sin Stock'`, invalidar la caché de Redis (`stock:muro:resumen`) y garantizar tolerancia a fallos con un máximo de 3 reintentos antes de aislar mensajes defectuosos en la DLQ.

---

### TAREA 2: Dashboard Frontend, Sanitización y Accesibilidad
* **Norma ISO/IEC 25010:** Seguridad (Integridad / Protección contra XSS) y Usabilidad (Accesibilidad WCAG 2.1 AA).
* **Identificadores de Requisito:** **F-05**, **F-12** y **F-14**
* **Archivos Modificados:** `client/src/pages/dashboardStock.js`, `client/src/dashboardStock.js`, `client/src/styles.css` y `client/styles.css`.

#### ¿Cuál era el problema previo?
1. **Vulnerabilidad XSS (F-05):** En `dashboardStock.js`, los datos recibidos de la API (nombres de cerveza, variedades, identificadores) se interpolaban directamente en cadenas HTML mediante `card.innerHTML = ...` sin escapar. Un dato malicioso guardado en base de datos podía inyectar scripts en el navegador del administrador.
2. **Contraste insuficiente (F-12):** La variable `--text-muted` usaba `#6b7280`, que sobre fondos oscuros no alcanzaba el ratio de contraste 4.5:1 exigido por WCAG AA. Además, el botón "Conectar Barril" utilizaba texto blanco sobre fondo amarillo ámbar (`#f59e0b`), resultando prácticamente ilegible.
3. **Modal no accesible y datos hardcodeados (F-14):** El modal de conexión de barriles estaba construido con un `div` genérico manipulado con `style.display = 'flex'`. No atrapaba el foco para lectores de pantalla, el `<input>` no tenía una etiqueta `<label>` asociada, y al confirmar la conexión enviaba hardcodeado `id_empleado_conexion: 1`.

#### ¿Cómo se resolvió?
* **F-05:** Se envolvió toda interpolación de texto dinámico en el DOM con la función global `escapeHTML()`:
  ```javascript
  const numeroCanilla = escapeHTML(String(canilla.numero_canilla || canilla.id_canilla || '-'));
  const nombreCerveza = escapeHTML(String(canilla.nombre_cerveza || 'Sin Barril Conectado'));
  ```
* **F-12:** En `client/src/styles.css` y `client/styles.css` se modificó `--text-muted: #8b93a1;`. En el botón de conexión se configuró:
  ```css
  #modal-btn-conectar {
      background: #f59e0b;
      color: #0b0c10; /* Alto contraste: ratio superior a 8:1 */
      font-weight: 700;
  }
  ```
* **F-14:** Se reconstruyó el modal utilizando la etiqueta nativa de HTML5:
  ```html
  <dialog id="modal-conexion-barril" aria-labelledby="modal-titulo-canilla">
      <div class="modal-card">
          <h3 id="modal-titulo-canilla">Conectar Barril</h3>
          <label for="modal-input-barril">ID del Barril:</label>
          <input type="number" id="modal-input-barril" name="id_barril" placeholder="Ej: 8" required />
          ...
      </div>
  </dialog>
  ```
  Se controla exclusivamente mediante las APIs nativas `modal.showModal()` y `modal.close()`.
* **F-14:** Se implementó la función `getAuthenticatedEmpleadoId()` que extrae el ID real del operador desde `sessionStorage`, `localStorage` o el objeto de sesión activa, enviándolo en el cuerpo del request a `/api/barriles/conectar`.

#### ¿Cómo funciona ahora?
La interfaz previene ataques de inyección, garantiza legibilidad y accesibilidad para operadores con deficiencias visuales o que navegan con teclado/lectores de pantalla, y registra con precisión qué empleado físico realizó la maniobra sobre el barril.

---

### TAREA 3: Infraestructura, Health Checks y Testing Automatizado
* **Norma ISO/IEC 25010:** Fiabilidad (Disponibilidad), Mantenibilidad (Testabilidad / Modularidad) y Portabilidad.
* **Identificadores de Requisito:** **F-09**, **F-18** y **F-21**
* **Archivos Modificados/Creados:** `server/index.js`, `server/package.json`, `server/Dockerfile`, `server/.dockerignore`, `server/tests/health.test.js`, `server/tests/index.js`.

#### ¿Cuál era el problema previo?
1. **Falta de monitoreo de dependencias (F-09):** La ruta `/api/health` anterior respondía con un mensaje estático sin comprobar si SQL Server, Redis o RabbitMQ estaban realmente en línea. Si la base de datos se caía, el endpoint seguía respondiendo 200 OK falsamente.
2. **Dificultad para pruebas E2E / Supertest (F-18):** `server/index.js` ejecutaba `app.listen(PORT)` de manera inmediata en el momento en que cualquier archivo hacía `require('./index')`. Esto impedía que suites de testing como `supertest` pudieran instanciar la aplicación en puertos efímeros, provocando errores de puerto ocupado (`EADDRINUSE`).
3. **Monolito de procesos (F-21):** El consumidor de colas corría en el mismo hilo de Node.js que la API REST, arriesgando la disponibilidad de los grifos ante saturaciones en el procesamiento de eventos. No existía Dockerfile para compilar la imagen de backend.

#### ¿Cómo se resolvió?
* **F-09:** Se reimplementó `/api/health` ejecutando diagnósticos en paralelo:
  * SQL Server: Ejecuta `SELECT 1` con timeout de 1.5s.
  * Redis: Envía `PING` utilizando una sonda temporal con `retryStrategy: () => null` para no colgar el loop si Redis está fuera de servicio.
  * RabbitMQ: Abre conexión AMQP temporal y confirma conectividad.
  * Si los 3 responden: HTTP 200 `{ ok: true, servicios: { sqlserver: 'ok', redis: 'ok', rabbitmq: 'ok' } }`.
  * Si alguno falla: HTTP 503 indicando cuál se encuentra `'caido'`.
* **F-18:** Se aisló el arranque del servidor:
  ```javascript
  if (require.main === module) {
      app.listen(PORT, () => { ... });
      iniciarOutboxPublisher();
  }
  module.exports = app;
  ```
  Se añadió a `package.json` el script:
  ```json
  "test": "node --test --experimental-test-coverage tests/"
  ```
  Se crearon `server/tests/index.js` (cargador de suites) y `server/tests/health.test.js`.
* **F-21:** Se removió `iniciarConsumidor()` de `index.js`.
* **F-21:** Se creó `server/Dockerfile` usando `node:20-alpine`, `npm ci --omit=dev`, con su respectivo `.dockerignore`.

#### ¿Cómo funciona ahora?
La aplicación es modular y 100% testeable. Monitores externos o Kubernetes pueden sondear `/api/health` para orquestar reinicios, y la suite de pruebas corre de forma limpia y desatendida.

---

### TAREA 4: Protección de Base de Datos y Comandos Administrativos
* **Norma ISO/IEC 25010:** Seguridad (Integridad / Protección contra Pérdida de Datos) y Mantenibilidad.
* **Identificadores de Requisito:** **F-10** y **F-19**
* **Archivos Modificados/Creados:** `server/init-db.js`, `scripts/backup-db.sh`, `server/db/schema.sql`, `server/package.json`.

#### ¿Cuál era el problema previo?
1. **Riesgo de destrucción accidental de datos (F-10):** El script `init-db.js` ejecutaba de forma inmediata sentencias destructivas (`DROP TABLE` y borrado de restricciones FK). Si un desarrollador o proceso automatizado lo ejecutaba por error en un entorno con ventas registradas, todos los datos se perdían de forma irreversible.
2. **Inexistencia de backups automatizados (F-10):** No había mecanismos para extraer respaldos físicos de SQL Server desde el contenedor Docker.
3. **Dispersión de scripts SQL (F-19):** Existían scripts dispersos con nombres históricos y no había linter configurado en los scripts del proyecto.

#### ¿Cómo se resolvió?
* **F-10:** Se añadió una salvaguarda al inicio de `init-db.js`:
  ```javascript
  const hasForceFlag = process.argv.includes('--force');
  const isProduction = process.env.NODE_ENV === 'production';

  if (!hasForceFlag && !isProduction) {
      console.error('⚠️ [ADVERTENCIA DE SEGURIDAD - F-10]');
      console.error('Este script destruirá todas las tablas y datos de OmbuDB.');
      console.error('Para confirmar, ejecute: node init-db.js --force');
      process.exit(1);
  }
  ```
* **F-10:** Se creó el script Bash `scripts/backup-db.sh`:
  ```bash
  docker exec "${CONTAINER_NAME}" /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U sa -P "${DB_PASSWORD}" -C \
    -Q "BACKUP DATABASE [OmbuDB] TO DISK = N'/var/opt/mssql/backup/OmbuDB_${FECHA}.bak' WITH STATS = 10"
  ```
* **F-19:** Se unificó el esquema completo de base de datos en `server/db/schema.sql` y se agregaron el comando `"lint": "eslint ."` y la dependencia de desarrollo `eslint` en `package.json`.

#### ¿Cómo funciona ahora?
Es imposible resetear la base de datos por error sin pasar explícitamente el modificador `--force`. Además, se pueden generar respaldos completos `.bak` en cualquier momento con un solo comando de terminal.

---

### TAREA 5: Orquestación Docker Compose y Contratos OpenAPI 3.0
* **Norma ISO/IEC 25010:** Portabilidad (Adaptabilidad / Coexistencia) y Compatibilidad (Interoperabilidad).
* **Identificadores de Requisito:** **F-16**, **F-20** y **F-21**
* **Archivos Modificados:** `docker-compose.yml`, `docs/openapi.yaml`.

#### ¿Cuál era el problema previo?
1. **Colisión de puertos y falta de límites de recursos (F-16):** Redis y RabbitMQ usaban puertos rígidos (`6379`, `5672`). Si el host ya tenía servicios locales en esos puertos, `docker compose up` fallaba. Tampoco había topes de memoria ni CPU configurados.
2. **Levantamiento manual de procesos (F-21):** Para probar el sistema completo se requería abrir 3 terminales: una para la base de datos, otra para `index.js`, otra para `stockConsumer.js` y un servidor de Live Server para el frontend.
3. **Contrato de API incompleto (F-20):** La especificación `docs/openapi.yaml` omitía los endpoints de canillas, barriles, control de stock y health check.

#### ¿Cómo se resolvió?
* **F-16:** Se parametrizaron los puertos con valores por defecto configurables vía `.env`:
  * Redis: `"${REDIS_PORT:-6379}:6379"`
  * RabbitMQ: `"${RABBITMQ_PORT:-5672}:5672"` y Management: `"${RABBITMQ_MGMT_PORT:-15672}:15672"`
  * Se asignaron límites de recursos (`deploy.resources.limits.cpus` y `memory`) a todos los servicios para proteger la máquina host.
* **F-21:** Se declararon tres nuevos servicios en `docker-compose.yml`:
  * `api`: Contenedor Node.js corriendo la API HTTP.
  * `worker`: Contenedor Node.js corriendo el consumidor de colas RabbitMQ en segundo plano.
  * `client`: Servidor web `nginx:alpine` sirviendo estáticamente el frontend en el puerto `${CLIENT_PORT:-8080}`.
* **F-20:** Se documentaron formalmente en `docs/openapi.yaml` bajo OpenAPI 3.0:
  * `/api/health`: Diagnóstico de infraestructura.
  * `/api/canillas` y `/api/canillas/{id}`: CRUD de canillas.
  * `/api/barriles` y `/api/barriles/{id}`: Consulta y baja lógica de barriles.
  * `/api/barriles/conectar`: Asignación transaccional concurrente con aislamiento SERIALIZABLE.
  * `/api/stock/resumen`: Lectura con degradación controlada Redis -> SQL Server.
  * Esquemas de datos: `HealthResponse`, `CanillaItem`, `BarrilItem`, `ConectarBarrilRequest`, `StockResumenResponse`.

#### ¿Cómo funciona ahora?
Con un único comando `docker compose up --build`, todo el ecosistema (Base de Datos, Redis, Broker RabbitMQ, API REST, Worker Asíncrono y Frontend Nginx) levanta de forma coordinada, reproducible y aislada.

---

## 3. Pruebas y Verificaciones Ejecutadas

Para validar que ninguna de las modificaciones introdujera regresiones en el trabajo previo de integración, se llevaron a cabo las siguientes pruebas de verificación:

### 1. Suite de Pruebas Automatizadas con Cobertura Nativa
* **Comando ejecutado:**
  ```bash
  node --test --experimental-test-coverage tests/
  ```
* **Resultado:**
  * **38 pruebas ejecutadas en 8 suites de integración.**
  * **38 pruebas pasadas (100% de éxito, 0 fallos, 0 omitidas).**
  * Reporte de cobertura generado exitosamente para todos los módulos de configuración, repositorios, controladores y servicios.

### 2. Prueba de Verificación de Salvaguarda F-10 (`init-db.js`)
* **Comando ejecutado:**
  ```bash
  node init-db.js
  ```
* **Resultado:** El proceso finalizó con código de salida `1` bloqueando la operación y emitiendo el mensaje de advertencia:
  ```text
  ⚠️  [ADVERTENCIA DE SEGURIDAD - F-10]
  Este script destruirá todas las tablas, restricciones y datos de OmbuDB.
  Para confirmar la ejecución destructiva, debe incluir el argumento --force:
     node init-db.js --force
  ```

### 3. Prueba Unitaria del Endpoint Health Check (`tests/health.test.js`)
* Se comprobó la exportación limpia de `app` de Express.
* Se validó que una petición HTTP a `/api/health` retorne una respuesta JSON con las claves `ok` y `servicios: { sqlserver, redis, rabbitmq }`, respondiendo con código 200 o 503 sin bloquear el hilo de Node.js ni generar fugas de memoria en sockets.

---

## 4. Matriz de Archivos Impactados

| Archivo | Tipo de Cambio | Requisito ISO 25010 | Descripción Resumida |
| :--- | :--- | :--- | :--- |
| `server/workers/stockConsumer.js` | Modificado | F-01, F-08 | Eliminación de doble descuento de litros. DLQ con 3 reintentos y reconexión automática. |
| `client/src/pages/dashboardStock.js` | Modificado | F-05, F-12, F-14 | Sanitización XSS (`escapeHTML`), alto contraste y `<dialog>` nativo con ID de empleado dinámico. |
| `client/src/dashboardStock.js` | Creado | F-05, F-12, F-14 | Copia sincronizada en ruta raíz del módulo cliente. |
| `client/src/styles.css` | Modificado | F-12 | Ajuste de contraste en variable `--text-muted` a `#8b93a1`. |
| `client/styles.css` | Modificado | F-12 | Homogeneización de contraste en estilos raíz. |
| `server/index.js` | Modificado | F-09, F-18, F-21 | Nuevo endpoint `/api/health`, exportación de `app` para supertest y desacople de workers. |
| `server/init-db.js` | Modificado | F-10 | Salvaguarda preventiva: exige `--force` para evitar destrucción de datos. |
| `scripts/backup-db.sh` | Creado | F-10 | Script bash para respaldar la base de datos SQL Server en archivo `.bak`. |
| `server/db/schema.sql` | Creado | F-19 | Archivo unificado con la estructura canónica y datos semilla de OmbuDB. |
| `server/package.json` | Modificado | F-18, F-19 | Configuración de scripts de coverage y linter (`test`, `lint`). |
| `server/Dockerfile` | Creado | F-21 | Imagen Docker liviana basada en `node:20-alpine` para la API y el Worker. |
| `server/.dockerignore` | Creado | F-21 | Exclusión de `node_modules`, `.env` y archivos temporales en el build de Docker. |
| `docker-compose.yml` | Modificado | F-16, F-20, F-21 | Parametrización de puertos, límites de recursos y nuevos servicios `api`, `worker` y `client`. |
| `docs/openapi.yaml` | Modificado | F-20 | Documentación completa OpenAPI 3.0 de Canillas, Barriles, Stock y Health Check. |
| `server/tests/index.js` | Creado | F-18 | Cargador centralizado compatible para el runner `node --test tests/`. |
| `server/tests/health.test.js` | Creado | F-09, F-18 | Suite automatizada para validar el endpoint `/api/health` y la exportación de `app`. |

---

## 5. Próximos Pasos Recomendados para el Equipo

1. **Revisión del Pull Request:** La rama `feature/iso25010-luciano` ya se encuentra publicada en el repositorio remoto lista para revisión de código (Code Review) y fusión hacia `main` o `develop`.
2. **Pruebas en Docker:** Levantar el entorno completo con `docker compose up --build` para verificar la orquestación simultánea del cliente Nginx, la API REST y el worker de RabbitMQ en contenedores independientes.
3. **Persistencia Local:** Este documento técnico reside exclusivamente de manera local en el archivo `INFORME_TECNICO_ISO25010_MODULO_LUCIANO.md` para referencia interna y coordinación del equipo.
