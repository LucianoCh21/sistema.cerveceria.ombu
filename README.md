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