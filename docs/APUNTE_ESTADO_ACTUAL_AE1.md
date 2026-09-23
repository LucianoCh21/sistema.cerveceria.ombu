# Apunte Técnico: Diagnóstico de Estado Actual y Trazabilidad Post-AE1
**Proyecto:** Ombú - Cervecería de Barrio (Tap Wall Autoservicio NFC)  
**Asignatura:** Paradigmas y Lenguajes de Programación III (UCP - FAITA)  
**Equipo:** Grupo 1 (Lucrecia Sabrina Mencia - Luciano Rubén Chesani)  
**Docente evaluador:** Prof. Carlos Emiliano Pereyra  
**Fecha de actualización:** 22 de septiembre de 2026  

---

## 1. Contexto y Registro de Devolución Docente (AE1)

Tras la defensa oral y presentación de la primera versión funcional correspondiente a la **Actividad de Evaluación N° 1 (AE1)**, el equipo recibió la siguiente retroalimentación formal por parte del docente evaluador (Prof. Carlos Emiliano Pereyra):

### Síntesis de la Retroalimentación:
* **Fortalezas destacadas:** Alta solvencia técnica durante el coloquio, excelente adopción del flujo de control de versiones y gestión ordenada de ramas en **GitHub**.
* **Observaciones y aspectos críticos a corregir:**
  1. **Gestión del tiempo y Pitch:** Exceso de 5 minutos sobre el límite establecido. Exigencia de formular un *Elevator Pitch* conciso centrado en la problemática real que resuelve el sistema y su propuesta de valor.
  2. **Estrategia de persistencia en la API (DELETE):** Eliminar el borrado físico de registros (`DELETE FROM ...`) e implementar **borrado defensivo o lógico (*soft delete*)** mediante cambio de estado para preservar la integridad referencial e histórica.
  3. **Formalización de la Metodología de Trabajo:** Explicitar y documentar el marco metodológico adoptado (Kanban, XP, etc.) para gobernar el flujo de tareas y entregables por hito.

---

## 2. Análisis Crítico de los Tres Ejes de Corrección

### Eje 1: Lógica de Persistencia y Borrado a la Defensiva (Soft Delete)
* **Diagnóstico del código en AE1:**
  En [`server/controllers/canillaController.js`](../server/controllers/canillaController.js), el endpoint `DELETE /api/canillas/:id` ejecutaba una sentencia física:
  ```sql
  DELETE FROM Canilla WHERE id_canilla = @id
  ```
* **Impacto en el dominio:**
  En el modelo relacional de Ombú, la entidad `Canilla` mantiene relaciones obligatorias con las tablas `Barril` (que registra el historial volumétrico de litros servidos) y `Despacho` (que audita cada consumo efectuado mediante tarjetas NFC). Un borrado físico rompe las restricciones de clave foránea (`FK_Barril_Canilla`, `FK_Despacho_Canilla`) o genera inconsistencias y pérdida de trazabilidad contable.
* **Solución de avance (Soft Delete):**
  Ajustar el controlador para que la operación `DELETE` no destruya la tupla, sino que realice una actualización de estado:
  ```sql
  UPDATE Canilla SET estado = 'Inactiva' WHERE id_canilla = @id
  ```
  De esta forma, la canilla queda inhabilitada para el autoservicio sin comprometer el historial ni violar la integridad referencial.

### Eje 2: Formalización del Marco Metodológico
* **Definición metodológica:** Se adopta formalmente un enfoque **Kanban evolutivo complementado con prácticas de Extreme Programming (XP)**:
  * **Visualización del flujo de valor:** Tablero Kanban estructurado en: `Backlog` $\rightarrow$ `En Análisis / Diseño` $\rightarrow$ `En Desarrollo` $\rightarrow$ `Revisión de Código / Pair Programming` $\rightarrow$ `Validación / Pruebas` $\rightarrow$ `Desplegado / Listo`.
  * **Límites de Trabajo en Progreso (WIP):** Máximo de 2 tarjetas concurrentes por integrante para asegurar foco y culminación incremental de funcionalidades.
  * **Estrategia Git:** *Feature Branch Workflow* con ramas prefijadas (`feat/`, `fix/`, `docs/`, `refactor/`) convergiendo hacia `main` mediante revisiones cruzadas.

### Eje 3: Estructura del Elevator Pitch (Síntesis de 2 Minutos)
Para respetar estrictamente los tiempos de exposición futuros, el discurso de apertura se estandariza con la siguiente estructura:
1. **Problema (30s):** En locales gastronómicos y cervecerías artesanales, la atención tradicional en barra genera cuellos de botella en horarios pico, demoras de hasta 20 minutos por cliente y mermas no contabilizadas de cerveza de hasta un 15% por falta de control volumétrico.
2. **Solución y Valor Diferencial (50s):** **Ombú Self-Service Tap Wall** automatiza el expendio mediante tecnología NFC. El cliente recarga saldo en su tarjeta, se sirve la cantidad exacta deseada directamente del grifo, y el sistema descuenta los mililitros consumidos en tiempo real.
3. **Arquitectura y Estado de Avance (40s):** Arquitectura desacoplada en capas (Node.js/Express + Frontend reactivo vanilla con estados de carga + SQL Server contenerizado en Docker), garantizando escalabilidad, resiliencia y alta disponibilidad.

---

## 3. Estado Actual del Sistema: Avances Superadores Post-AE1

El proyecto ha evolucionado sustancialmente respecto de la entrega de AE1, consolidando los siguientes componentes:

```
sistema.cerveceria.ombu/
├── client/                     # Frontend desacoplado
│   ├── index.html              # Contenedor ancla dinámico, lógica async y accesibilidad
│   └── src/
│       └── styles.css          # Sistema de diseño Ombú (variables, spinner y estados)
├── server/                     # Backend modular en capas
│   ├── config/db.js            # Conexión nativa mssql y pool centralizado
│   ├── controllers/            # Controladores de negocio (CRUD Canillas)
│   ├── routes/                 # Enrutamiento modular RESTful
│   └── index.js                # Punto de entrada Express y middlewares
└── sql/ (Descargas)            # Modelo relacional completo DDL (12 entidades)
```

### A. Capa de Presentación (Frontend Desacoplado)
1. **Contenedor Ancla Dinámico:** En [`client/index.html`](../client/index.html) se eliminó cualquier dato mock o estático, proveyendo el contenedor `<div id="muro-canillas">` provisto de atributos de accesibilidad (`aria-live="polite"`, `aria-busy="true"`, `role="status"`).
2. **Estado Visual de Carga (Spinner Ámbar):** Implementación de `.spinner-cervecero` animado con rotación fluida y tonalidad ámbar cerveza (`--primary: #f59e0b;`) integrada al tema oscuro de Ombú en [`client/src/styles.css`](../client/src/styles.css).
3. **Resiliencia y Corrección de Bugs:** Eliminación de la condición errónea `hasChildNodes()` que silenciaba el estado de error ante caídas del servidor. Incorporación de un botón interactivo **"🔄 Reintentar conexión"**.
4. **Seguridad y Rendimiento:** Sanitización activa de cadenas dinámicas contra ataques XSS (`escapeHTML`) e inyección atómica en el DOM mediante `DocumentFragment`.
5. **Ajuste de Latencia para Demostración:** Inclusión de un retardo calibrado de 2 segundos para evidenciar de forma pedagógica el ciclo de vida de la vista.

### B. Capa de Datos y Persistencia (SQL Server en Docker)
* **Entorno:** Contenedor Docker `sqlserver` (*Microsoft SQL Server 2022*) corriendo en el puerto local `1433`.
* **Esquema Relacional:** Base de datos `OmbuDB` creada con el esquema integral de **12 entidades**:
  * Catálogos y maestros: `Proveedor`, `EstiloCerveza`, `FormatoServicio`, `Empleado`, `Cliente`.
  * Núcleo cervecero: `Cerveza`, `PrecioCerveza`, `Canilla`, `Barril`.
  * Operaciones y auditoría: `TarjetaNFC`, `Recarga`, `Despacho`.
* **Datos iniciales:** 10 canillas inicializadas operativamente y vinculadas a la API.

### C. Capa de Lógica y Servicios (API REST Backend)
* API Express operativa en el puerto `3000` con CORS y parseo JSON.
* Endpoints validados: `GET /api/canillas` consumido y renderizado exitosamente por el frontend.

---

## 4. Matriz de Cumplimiento y Próximos Pasos (Hacia AE2)

| Eje Evaluativo | Observación AE1 | Estado Actual Post-AE1 | Acción Inmediata |
| :--- | :--- | :--- | :--- |
| **Persistencia (DELETE)** | Borrado físico presente | Diagnosticado en [`canillaController.js`](../server/controllers/canillaController.js#L77-L95) | Refactorizar a Soft Delete (`UPDATE Canilla SET estado = 'Inactiva'`) |
| **Gestión del Tiempo** | Excedidos por 5 min | Estructura de Elevator Pitch redactada y acotada a 2 min | Ensayar defensa oral con cronómetro |
| **Metodología** | No explicitada formalmente | Definida: Kanban + Prácticas XP + Git Feature Branch | Registrar tablero y políticas en documentación del repo |
| **Arquitectura de Vistas** | Pendiente en AE1 | **100% Implementada:** Vista dinámica, loader, spinner y desacoplamiento total | Mantener y documentar para el coloquio |
| **Base de Datos** | Parcial / en desarrollo | **100% Implementada:** 12 entidades DDL cargadas y operativas en Docker | Vincular endpoints de barriles y stock |

---
*Documento preparado como insumo formal de seguimiento y preparación para el Coloquio AE2.*
