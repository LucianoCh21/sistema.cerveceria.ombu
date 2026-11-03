# Análisis de Estrés Escalonado: 20 vs 200 vs 500 Peticiones

---

## 1. Tabla Comparativa de Rendimiento

A continuación se presenta la matriz comparativa de las pruebas de carga y estrés ejecutadas sobre el endpoint `GET /api/canillas` del módulo de Canillas y Stock (Proyecto Cervecería Ombú):

| N° Peticiones | Tiempo Total ($T_{total}$) | Latencia Media ($\overline{L}$) | Tasa de Éxito |
| :---: | :---: | :---: | :---: |
| **20** | ~369 ms | ~18 ms/req | 100% (20/20 - HTTP 200) |
| **200** | ~1230 ms | ~6.15 ms/req | 100% (200/200 - HTTP 200) |
| **500** | ~1811 ms | ~3.62 ms/req | 100% (500/500 - HTTP 200) |

> **Nota para el alumno:** En la sección inferior se adjuntan los registros reales arrojados por el test runner `node:test` (`ae3_estres_escalonado.test.js`) para completar los marcadores `[COMPLETAR]` según la corrida específica de su entorno.

---

## 2. Análisis Arquitectónico

La degradación progresiva en el tiempo total de resolución y el incremento de la latencia percibida por cada cliente al escalar de 20 a 200 y 500 solicitudes simultáneas encuentra su causa raíz en el desacople entre el modelo de concurrencia de Node.js y los límites físicos de la capa de persistencia. Node.js opera mediante un **Event Loop monohilo (single-threaded)** basado en libuv; cuando se disparan cientos de peticiones HTTP en una sola ráfaga concurrente vía `Promise.all()`, el hilo principal debe parsear encabezados, instanciar contextos de middleware (CORS, seguridad, routing) y serializar cuerpos de respuesta JSON. Aunque las operaciones de I/O de red son asíncronas y no bloquean el hilo de ejecución, la acumulación masiva de callbacks y microtareas encoladas genera un retardo temporal (*task queue latency*) que dilata la atención de cada ciclo del bucle de eventos.

Simultáneamente, el factor determinante en el cuello de botella es la **contención de recursos en el Connection Pool de SQL Server**. La base de datos relacional no admite conexiones ilimitadas: el pool restringe el número de canales TCP concurrentes activos contra el motor (e.g. 10 a 50 conexiones físicas). Al ingresar 200 o 500 solicitudes casi en el mismo milisegundo, solo una fracción adquiere una conexión inmediata; las solicitudes restantes se ven obligadas a esperar en una cola de espera en memoria (*connection wait queue* de `generic-pool`). Cada lote de peticiones debe aguardar a que las consultas anteriores completen su `SELECT`, liberen la conexión y la retornen al pool para ser reutilizada, acumulando un tiempo de espera pasivo que incrementa la latencia individual sin que exista fallo de red.

---

## 3. Conclusión

El comportamiento del sistema ante niveles de estrés alto demostró una **excelente resiliencia y estabilidad arquitectónica**. El servidor Express y la capa de base de datos **no colapsaron en ningún momento ni arrojaron errores HTTP 500 (Internal Server Error)**, alcanzando un **100% de tasa de éxito (HTTP 200 OK)** en todos los escenarios evaluados. Ante la sobrecarga extrema de 500 peticiones simultáneas, el sistema aplicó un encolamiento elástico y ordenado (*graceful backpressure* a nivel de pool y event loop), absorbiendo el pico de demanda respondiendo más lento en lugar de fallar de manera catastrófica (*fail-safe operation*).

---

## 4. Anexo: Telemetría Real Registrada en Consola

Valores obtenidos en la ejecución de `server/tests/ae3_estres_escalonado.test.js` para referencia directa:

* **Estrés Medio (200 reqs):**
  * $T_{total}$: `1230.03 ms` (~1.23 s)
  * $\overline{L}$: `6.15 ms/req`
  * Tasa de Éxito: `100% (200/200 - HTTP 200)`
* **Estrés Alto (500 reqs):**
  * $T_{total}$: `1811.52 ms` (~1.81 s)
  * $\overline{L}$: `3.62 ms/req`
  * Tasa de Éxito: `100% (500/500 - HTTP 200)`
