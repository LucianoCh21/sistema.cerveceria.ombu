# AE4 B01 — Implementación del pipeline de integración continua

## Alcance y punto de partida

El requisito B01 aporta evidencia de pruebas automatizadas y construcción del backend dentro del criterio AE4 de contenedores, CI/CD, versionado y despliegue. El corte `3de1aa906a1ce344d8fa005d73a8d9fcf2b6eab1` tenía Dockerfile y scripts de despliegue manual, pero carecía de workflow. El comando general `npm test` incluye carga, integraciones que requieren servicios y un caso de alta que puede escribir en SQL Server.

Se revisó `AE4_AUDITORIA_CUMPLIMIENTO_B_C_D_E.md`, en particular el inventario de §8 y la tarea B01. El checkout Windows seguía en el SHA auditado y coincidía con su referencia local de seguimiento. No había commits posteriores en ese checkout. La referencia local `origin/feature/iso25010-lucrecia` tenía tres commits exclusivos, fuera de la base elegida. Se creó `feature/ae4-ci-luciano` en un worktree limpio. El informe de auditoría y el directorio privado preexistentes permanecen en el checkout original.

## Cómo funciona el workflow

| Paso | Configuración |
|---|---|
| Activación | PR con base `main`, `develop` o `feature/iso25010-luciano`. Push a esas tres ramas o a `feature/ae4-ci-luciano` para validar el primer envío de la rama |
| Entorno | Un job en `ubuntu-24.04` hospedado por GitHub, con timeout de 15 minutos. Node 24 LTS en el job y `node:24-alpine` en el Dockerfile. Se eligió la rama LTS usada para comprobar los tests localmente. [Calendario de Node.js](https://nodejs.org/en/about/previous-releases) |
| Dependencias | `npm ci --no-audit --no-fund` en `server/`, usando el lockfile existente y sin caché automática de la acción |
| Pruebas | `npm run test:unit` ejecuta una lista explícita mediante rutas absolutas y un directorio temporal vacío. TAP en consola y en el artefacto `ae4-unit-tests`, conservado por 14 días. `pipefail` transmite el fallo incluso con `tee` |
| Imagen | Si la instalación y las pruebas terminan bien, `docker build --file server/Dockerfile --tag ombu-api:ci server` construye una imagen con etiqueta local al runner. El fallo del build hace fallar el job |
| Permisos | `contents: read`, checkout con `persist-credentials: false` y acciones oficiales fijadas por SHA. El workflow sólo usa `pull_request` y `push`. El artefacto contiene el log TAP y no es una publicación de imagen. [Sintaxis de workflows de GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) |

## Archivos

| Archivo | Cambio |
|---|---|
| `.github/workflows/ae4-ci.yml` | Eventos, permisos, job, instalación, pruebas, build y log |
| `server/package.json` | Comando `test:unit`; se conservan los scripts existentes |
| `server/run-unit-tests.js` | Lista explícita, cwd temporal para dotenv, TAP y propagación del código de salida |
| `server/Dockerfile` | Actualiza la imagen base a Node 24 LTS; conserva las etapas de instalación y el comando de arranque |
| `server/.dockerignore` | Excluye archivos de entorno, variantes, `.npmrc` y auditorías privadas incluso si aparecen dentro de `server/` |
| `README.md` | Instrucciones mínimas de verificación y estado actualizado de CI |
| `portafolio/AE4/AE4_B01_CI_PIPELINE_REPORT.md` | Implementación, resultados y evidencia pendiente |

## Selección y revisión de pruebas

| Archivos de `server/tests/` | Dependencias y alcance revisados |
|---|---|
| `auth` | Middleware y credenciales sintéticas en el proceso, sin HTTP real |
| `barril_cache`, `barril_conexion_estado` | SQL y Redis doblados. La prueba positiva de conexión conserva el límite del doble señalado en la auditoría |
| `comprobante_privacidad`, `dia5_comprobante_pdf` | PDFKit doblado en la primera y PDF real en memoria en la segunda. Sin archivos de comprobantes ni consultas a la API |
| `despacho_idempotencia_atomica` | Servicio con dobles de repos, SQL y Redis. Concurrencia local de promesas |
| `dia2_nfc_ttl` | Importa helpers de Redis pero comprueba valores locales sin abrir cliente ni esperar un TTL real |
| `dia4_despacho_idempotencia`, `dia6_integracion_cruzada` | Simulaciones locales. El nombre de la segunda no acredita una integración contra servicios |
| `nfc_formatos_sin_barril`, `nfc_tap_canilla` | Repos/SQL y Redis doblados; valida controladores o servicios productivos |
| `rabbitmq_logs` | Importa el módulo AMQP y prueba la función pura de máscara sin abrir conexión |

Quedan fuera `ae3_carga_seguridad`, `ae3_estres_escalonado`, `ae3_practico`, `health`, `integracion_fases` y el cargador global por servicios reales, carga, escrituras o arrastre de otras suites. `outbox` importa la configuración DB que busca entorno con rutas explícitas. El test de navegador requiere Playwright/Chromium y queda fuera de este primer gate. La lista debe revisarse cuando cambien las dependencias de un test. El directorio temporal aísla la búsqueda por defecto de dotenv en estos archivos; el aislamiento no es un bloqueo de red para futuras pruebas.

## Verificación local

| Comprobación | Resultado observado |
|---|---|
| Instalación de CI | `npm ci --no-audit --no-fund`, Node v24.21.0 y npm 11.19.0 en Windows, 277 paquetes instalados y salida 0. npm emitió avisos de dependencias de desarrollo obsoletas |
| Pruebas | `npm run test:unit` · 57 aprobadas, 0 fallos, 0 canceladas, 0 omitidas en 12 archivos |
| YAML y estructura | `actionlint -color=false .github/workflows/ae4-ci.yml`, v1.7.12 verificado por SHA-256 de la release. Aserciones adicionales con `js-yaml` sobre eventos, permisos, ausencia de servicios/entorno, comandos y alineación de Node |
| Prueba negativa | Copia temporal de `package.json` y del runner, 11 casos sintéticos verifican que el cwd no tiene el `.env` de prueba y uno falla deliberadamente. La tubería Bash deja código 1, con 11 aprobados y 1 fallo capturados por `tee`. El build se ubica después de la prueba y no tiene `continue-on-error` |
| Instalación de producción | `npm ci --offline --omit=dev --no-audit --no-fund` en una carpeta temporal con caché local y manifiestos copiados, 165 paquetes. Express presente y Supertest ausente. Esta prueba usa Windows y no sustituye el build Alpine |
| Build Docker | **Pendiente de ejecución**. Se revisaron comando, contexto y Dockerfile. Se inspeccionaron sólo los nombres de contextos con `docker context ls` y no se identificó un motor local separado del contexto activo. El build se ejecutará en el runner hospedado |
| Control de cambios | `node --check server/run-unit-tests.js` y `git diff --check` sin errores. No se consultaron los servicios de demo ni se ejecutó Compose |

Para reproducir la parte local desde el worktree:

```powershell
Push-Location server
npm ci --no-audit --no-fund
npm run test:unit
Pop-Location
node --check server/run-unit-tests.js
actionlint -color=false .github/workflows/ae4-ci.yml
git diff --check
```

En un motor Linux aislado y autorizado, la comprobación pendiente es:

```sh
docker build --file server/Dockerfile --tag ombu-api:ci server
```

## Seguridad y límites

- El contexto es `server/` de un checkout limpio, con exclusiones de entorno, configuración npm privada, dependencias locales y auditoría. La revisión de rutas rastreadas del contexto no encontró archivos de credenciales. La instalación descarga dependencias públicas y el build usa una base pública sin login de registry.
- Se preservan los SQL versionados y el `COPY . .` del Dockerfile. B02 debe revisar semillas históricas, limitar el contenido de runtime y fijar digest de la imagen base antes de publicar. Node 24 y el tag Alpine están fijados por línea mayor; no prometen una imagen idéntica byte por byte.
- Esta fase no aporta evidencia de SQL Server, Redis, RabbitMQ o navegador reales. No se incluyeron servicios, scripts de inicialización/reset, carga, publicación ni pasos de deploy. No se tocó el túnel, el stack activo ni sus volúmenes.

## Primera ejecución y evidencia de AE4

1. Revisar los siete archivos del worktree, preparar exclusivamente esos paths y hacer el commit cuando se autorice.
2. Con aprobación explícita, hacer push de `feature/ae4-ci-luciano`. El evento de push inicia **AE4 CI**. Abrir un PR hacia `feature/iso25010-luciano` para comprobar el evento de PR.
3. En GitHub Actions, abrir la corrida y comprobar el SHA del checkout, los pasos de instalación/pruebas, el build local al runner y el artefacto TAP. Si una prueba falla, revisar el artefacto y verificar que el paso Docker figure omitido.
4. Conservar el enlace a la corrida, SHA, estado de cada paso, resumen TAP y salida del build para el portafolio. Si el repositorio requiere revisión de workflows en PR, un responsable debe habilitar esa corrida desde GitHub.

**Estado de la evidencia remota:** pendiente de push autorizado y primera ejecución. Registry, integración con servicios y despliegue corresponden a fases posteriores.
