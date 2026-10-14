# Evaluación de Calidad de Software (ISO/IEC 25000) - Ombú, Cervecería de Barrio

## Redacción de Justificación Global
El estado de calidad del sistema "Ombú, Cervecería de Barrio" presenta un nivel aceptable de madurez, destacando su arquitectura distribuida que separa el frontend en React Vite y el backend en Express, apoyado en RabbitMQ. Desde la perspectiva de la norma ISO/IEC 25000 (SQuaRE), el sistema responde positivamente en adecuación funcional, permitiendo gestionar el ciclo de la cerveza eficientemente. Su eficiencia de desempeño y fiabilidad se ven altamente beneficiadas por el uso de mensajería asíncrona, aunque existen áreas de mejora en seguridad y mantenibilidad del frontend. La orquestación mediante contenedores facilita la portabilidad y compatibilidad de entornos. En síntesis, el producto de software cumple los requerimientos base de la cervecería, pero requiere aplicar refactorizaciones puntuales en la capa de vista y seguridad de endpoints para alcanzar la máxima robustez que estipula este modelo de calidad.

## Matriz de Relevamiento de las Características de Calidad

| N° | Característica de Calidad (ISO 25010) | ¿Cumple actualmente? (Sí / Parcial / No) | Justificación Técnica Situada |
|---|---|---|---|
| 1 | Adecuación Funcional | Sí | Los endpoints REST implementados en `server/controllers/despachoController.js` y `server/controllers/nfcController.js` resuelven exitosamente las reglas de negocio principales. |
| 2 | Eficiencia de Desempeño | Sí | La asincronía en el procesamiento de eventos mediante RabbitMQ, implementado en `server/workers/stockConsumer.js`, evita bloqueos en el hilo principal de Node.js. |
| 3 | Compatibilidad / Interoperabilidad | Sí | El sistema intercambia datos utilizando JSON sobre HTTP/REST entre el frontend Vite React y la API, y mediante el protocolo AMQP para las colas de RabbitMQ. |
| 4 | Usabilidad | Parcial | El componente `client/src/pages/dashboardStock.js` proporciona una interfaz moderna, pero requiere mejoras en feedback visual ante acciones asíncronas y manejo de estado. |
| 5 | Fiabilidad | Parcial | La resiliencia está soportada por el reencolado de RabbitMQ. Además, se testea tolerancia a fallos en `tests/dia4_despacho_idempotencia.test.js`, aunque faltan validaciones adicionales. |
| 6 | Seguridad | Parcial | Se requiere robustecer la validación de parámetros y sanitización de entradas en archivos como `server/routes/despachoRoutes.js` para prevenir vulnerabilidades de inyección. |
| 7 | Mantenibilidad | Parcial | La modularidad en el backend es adecuada, pero el código del frontend (ej. `client/src/terminalNfc.js`) presenta acoplamiento al mezclar lógica de interfaz con llamadas de red. |
| 8 | Portabilidad | Sí | El archivo `docker-compose.yml` orquesta la inicialización de todos los servicios (Node, DB, RabbitMQ), garantizando un despliegue homogéneo en cualquier entorno. |
| 9 | Seguridad de Uso / Robustez Operativa | Sí | Validaciones como el control del TTL en `tests/dia2_nfc_ttl.test.js` y el manejo de comprobantes en `tests/dia5_comprobante_pdf.test.js` previenen riesgos en la operativa física. |

## Bibliografía
- ISO/IEC. (2011). *ISO/IEC 25010:2011 Systems and software engineering — Systems and software Quality Requirements and Evaluation (SQuaRE) — System and software quality models*. International Organization for Standardization.
- ISO/IEC. (2014). *ISO/IEC 25000:2014 Systems and software engineering — Systems and software Quality Requirements and Evaluation (SQuaRE) — Guide to SQuaRE*. International Organization for Standardization.
