# Informe Técnico de Integración, Correcciones y Base de Datos (AE2)

**Autora:** Lucrecia Sabrina Mencia  
**Destinatario:** Luciano Rubén Chesani  
**Proyecto:** Sistema de Autoservicio Cervecería Ombú — Tap Wall NFC y Control de Stock  
**Rama:** `ae2/lecturas-nfc`  
**Base de Datos:** Microsoft SQL Server 2022 (`OmbuDB`)  
**Fecha:** 29 de Septiembre de 2026  

---

## 1. Resumen Ejecutivo de Cambios Realizados

Tras fusionar las novedades de `develop` y analizar el comportamiento integral de la aplicación y las capturas de error, se detectaron fallos críticos de configuración, visualización en el frontend y desacoplamiento de datos hardcodeados. Se aplicaron soluciones integrales en backend, frontend y bases de datos.

### 1.1. Infraestructura, Docker y Variables de Entorno
1. **Unificación de Puertos de SQL Server**:
   - `docker-compose.yml`: Se configuró el puerto de host dinámico `"${DB_PORT:-1434}:1433"`.
   - `.env`: Se actualizó `DB_PORT=1434` y la cadena `DATABASE_URL` para coincidir con la configuración del contenedor de base de datos.
2. **Seguridad y Sanitización**:
   - `.env.example`: Se eliminaron contraseñas en texto plano, reemplazándolas por `<TU_PASSWORD>`.
   - `docker-compose.yml`: Se reemplazó la contraseña fija por `${DB_PASSWORD:-TuPassword123!}`.
3. **Conexión a Base de Datos (`server/config/db.js`)**:
   - **Corrección crítica**: Se eliminó la directiva `database: 'master'` que impedía acceder a las tablas del sistema. Ahora apunta a `process.env.DB_DATABASE || 'OmbuDB'`.
   - **Resolución de `.env`**: Se configuró la lectura jerárquica con `path.resolve` para cargar las variables sin importar si el proceso se inicia desde la raíz del repositorio o dentro de `server/`.
4. **Script de Inicialización Resiliente (`server/init-db.js`)**:
   - Se añadió un paso de arranque que conecta inicialmente a `master` para verificar y crear la base de datos `OmbuDB` si no existiera (`IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'OmbuDB') CREATE DATABASE [OmbuDB]`).
   - Seguidamente se conecta a `OmbuDB` para limpiar esquemas previos y ejecutar los 153 lotes DDL/DML con éxito.

---

### 1.2. Módulo Frontend: Dashboard de Barriles y Stock
*Archivos: `client/src/pages/dashboardStock.js` y `client/index.html`*

1. **Resolución de Pantalla Negra / En Blanco**:
   - Ante fallos de conexión con el backend o la base de datos, el bloque `catch` antes solo ejecutaba `console.error` dejando el contenedor DOM vacío.
   - Se implementó el **estado visual de carga cervecero (`.muro-loader`)** con spinner mientras consulta el stock.
   - Se implementó la **tarjeta de error y reintento (`.muro-vacio.muro-error`)** con el botón interactivo `🔄 Reintentar consulta de stock`.
   - Se implementó el **estado vacío (`.muro-vacio`)** en caso de que no existan canillas registradas.
2. **Estilos en Modo Oscuro**:
   - Se rediseñaron las barras de progreso para coincidir con el diseño oscuro de Ombú (`rgba(255, 255, 255, 0.08)` con bordes sutiles y animación `transition: width 0.6s`).
   - Se añadieron badges de nivel (`ÓPTIMO`, `NIVEL BAJO`, `SIN STOCK`) y métricas de litros restantes sobre litros totales.
3. **Navegación Reactiva**:
   - Al pulsar la pestaña **"Barriles y Stock"** en el sidebar (`activarVista('stock')`), se dispara la recarga automática `window.dashboardStock.cargarStock()`.

---

### 1.3. Módulo Frontend: Terminal de Autoservicio Tap Wall NFC
*Archivos: `client/src/terminalNfc.js` e `client/index.html`*

1. **Eliminación Total de Datos Hardcodeados**:
   - **Tarjetas NFC**: Se eliminó el array estático `TARJETAS_PRESET` con titulares ficticios. Ahora se consumen en vivo desde la base de datos a través del endpoint `GET /api/nfc/tarjetas`.
   - **Canillas**: Se eliminó el array estático `CANILLAS_INFO`. Ahora se consumen en vivo desde `GET /api/canillas`.
   - **Formatos y Precios**: Se eliminó el array estático `FORMATOS_DISPONIBLES` con precios fijos. Ahora se consultan dinámicamente mediante `GET /api/nfc/formatos?id_canilla=${id}`, reflejando los precios vigentes reales de la cerveza conectada (`PrecioCerveza`).
2. **Limpieza de Placeholders en HTML**:
   - Se quitaron valores fijos como `A1B2C3D4E5`, `Juan Pérez` y `$6.500,00` del marcado inicial de `index.html`. Ahora se inicializan en `-` y `$0,00` hasta que se detecta la sesión.
3. **Sincronización Reactiva**:
   - Al despachar una cerveza, la terminal descuenta el saldo en `OmbuDB`, actualiza la lista de tarjetas y actualiza el stock de barriles inmediatamente.

---

### 1.4. Módulo Backend: Nuevos Endpoints y Adaptación Relacional
*Archivos: `server/controllers/canillaController.js`, `server/controllers/nfcController.js`, `server/routes/nfcRoutes.js`*

1. **`GET /api/canillas`**:
   - Ahora incluye `LEFT JOIN` con `Barril`, `Cerveza` y `EstiloCerveza` para proveer estilo, variedad, IBU y ABV reales desde `OmbuDB`.
2. **`GET /api/nfc/tarjetas`**:
   - Devuelve todas las tarjetas registradas con su titular (cruzado con `Cliente`), saldo actual y tipo (`Nominada` o `Anónima`).
3. **`GET /api/nfc/formatos?id_canilla={id}`**:
   - Resuelve la cerveza conectada al grifo y extrae los precios activos (`vigente_hasta IS NULL`) para `Media Pinta (250 ml)`, `Pinta (500 ml)` y `Litro (1000 ml)`.

---

## 2. Cambios y Consideraciones para la Base de Datos (Luciano Chesani)

Para que el módulo de stock y barriles funcione en perfecta armonía con el módulo NFC y las correcciones docentes de la cátedra, Luciano debe tener en cuenta los siguientes puntos en `OmbuDB`:

### 2.1. Reglas del Modelo Relacional y Nombres de Columnas

1. **Tabla `TarjetaNFC`**:
   - Clave Primaria: Debe ser **`id_tarjeta VARCHAR(32)`** (el identificador físico NFC, ej: `'A1B2C3D4E5'`). **No** utilizar un entero autoincremental `id_tarjeta INT`.
   - Columna de saldo: El nombre en la BD es **`saldo_actual DECIMAL(10,2)`** (no `saldo`).
   - Tarjetas anónimas: La columna `id_cliente` es **`NULL-able`**. No hacer `INNER JOIN` obligatorio con `Cliente`, sino `LEFT JOIN`. Si `id_cliente IS NULL`, corresponde a "Consumidor Final".
2. **Tabla `Barril`**:
   - Clave foránea de canilla: `id_canilla INT NULL`. Los barriles nuevos o en depósito deben tener `id_canilla = NULL` y estado `'En Espera'`.
   - Responsable de conexión: `id_empleado_conexion INT NOT NULL` (debe registrarse siempre el ID del empleado que realizó la maniobra física).
   - Estados canónicos: `'Conectado'`, `'En Espera'`, `'Agotado'`, `'Retirado'`.
   - **Invalidación de Caché**: Cada vez que se conecte o retire un barril en `barrilController`, se debe invalidar la clave de Redis `stock:muro:resumen`.
3. **Tabla `PrecioCerveza`**:
   - Fechas de vigencia: Las columnas son **`vigente_desde DATE`** y **`vigente_hasta DATE NULL`**.
   - Para consultar precios vigentes, la condición es: `WHERE vigente_hasta IS NULL`.
4. **Tabla `Cerveza`**:
   - Graduación alcohólica: La columna se llama **`abv DECIMAL(4,2)`** (no `graduacion_alcoholica`).
5. **Tabla `Despacho`**:
   - Clave foránea obligatoria de barril: `id_barril INT NOT NULL`. Todo despacho debe estar asociado al barril específico del cual se descontaron los litros.
   - Formato de servicio: `id_formato INT NOT NULL` relacionado a `FormatoServicio`.

---

### 2.2. Sentencias SQL Recomendadas (Inserts Adicionales para Pruebas)

Si Luciano desea probar flujos adicionales de validación en su entorno local, puede ejecutar los siguientes scripts en `OmbuDB`:

```sql
USE [OmbuDB];
GO

-- 1. Tarjeta Bloqueada para verificar rechazo de seguridad (HTTP 403 CARD_INACTIVE)
IF NOT EXISTS (SELECT 1 FROM TarjetaNFC WHERE id_tarjeta = 'B2C3D4E5F6')
BEGIN
    INSERT INTO [dbo].[TarjetaNFC] 
        ([id_tarjeta], [id_cliente], [id_empleado_emision], [saldo_actual], [fecha_alta], [estado])
    VALUES 
        (N'B2C3D4E5F6', 1, 2, CAST(8000.00 AS Decimal(10, 2)), CAST(GETDATE() AS Date), N'Bloqueada');
END
GO

-- 2. Tarjeta sin fondos para verificar rechazo de saldo (HTTP 402 INSUFFICIENT_FUNDS)
IF NOT EXISTS (SELECT 1 FROM TarjetaNFC WHERE id_tarjeta = 'D4E5F6A1B2')
BEGIN
    INSERT INTO [dbo].[TarjetaNFC] 
        ([id_tarjeta], [id_cliente], [id_empleado_emision], [saldo_actual], [fecha_alta], [estado])
    VALUES 
        (N'D4E5F6A1B2', 1, 2, CAST(0.00 AS Decimal(10, 2)), CAST(GETDATE() AS Date), N'Activa');
END
GO

-- 3. Barriles en Depósito ('En Espera') para probar conexión desde el Modal de Stock
-- Disponibles para asignar a las canillas inactivas #8, #9 y #10
IF NOT EXISTS (SELECT 1 FROM Barril WHERE id_barril = 8)
BEGIN
    SET IDENTITY_INSERT [dbo].[Barril] ON;
    INSERT INTO [dbo].[Barril] 
        ([id_barril], [id_cerveza], [id_canilla], [id_empleado_conexion], [litros_totales], [litros_restantes], [fecha_conexion], [fecha_desconexion], [estado])
    VALUES 
        (8, 1, NULL, 1, CAST(50.00 AS Decimal(6,2)), CAST(50.00 AS Decimal(6,2)), GETDATE(), NULL, 'En Espera'),
        (9, 3, NULL, 1, CAST(50.00 AS Decimal(6,2)), CAST(50.00 AS Decimal(6,2)), GETDATE(), NULL, 'En Espera');
    SET IDENTITY_INSERT [dbo].[Barril] OFF;
END
GO
```

---

## 3. Estado de la Suite de Pruebas Automatizadas

Se ejecutó la suite completa de pruebas unitarias y de integración cruzada:
```bash
npm test
```
**Resultado:**
- Total de Suites: **7**
- Total de Tests: **24 pasados (0 fallos)**
- Cobertura:
  - Autenticación NFC y Sesión Efímera Redis (TTL 45s).
  - Débito Transaccional con Idempotencia e inserción en RabbitMQ.
  - Generación de Comprobante PDF (PDFKit).
  - Integración Cruzada E2E (Tap NFC -> Despacho -> Evento RabbitMQ -> Descuento en Stock).
  - Tolerancia a Fallos, Reconexión Exponencial y Fallback SQL Server.
