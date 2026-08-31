# Ombú Cervecería de Especialidad - Self-Service Tap Wall NFC

Sistema backend para la gestión de un muro de canillas de autoservicio, desarrollado para la materia Paradigmas y Lenguajes de Programación III (UCP - FAITA).

**Actividad de Evaluación N° 1 (AE1)**: Diseño y codificación incremental de una API RESTful.

**Autores**
* Lucrecia Sabrina Mencia
* Luciano Rubén Chesani

**Arquitectura y Stack Tecnológico**
El proyecto implementa una arquitectura en capas (N-Layers) para separar responsabilidades, operando de forma asíncrona y nativa sin ORMs.
* **Entorno**: Node.js puro sobre Linux.
* **Enrutamiento**: Express.js.
* **Base de Datos**: Microsoft SQL Server (vía driver nativo `mssql`).
* **Estructura**:
  * `/config`: Conexión directa, exclusión mutua y credenciales de base de datos.
  * `/routes`: Definición de endpoints HTTP.
  * `/controllers`: Lógica de negocio, validaciones y manejo centralizado de códigos HTTP (200, 201, 400, 404, 500).

**Entidad Principal (AE1): Canilla**
El sistema expone un CRUD funcional para gestionar los grifos físicos del muro:
* `GET /api/v1/canillas`: Retorna el listado completo de canillas.
* `GET /api/v1/canillas/{id}`: Retorna el detalle de una canilla específica.
* `POST /api/v1/canillas`: Da de alta una nueva canilla (requiere validación de payload JSON).
* `PUT /api/v1/canillas/{id}`: Modifica el estado operativo o configuración.
* `DELETE /api/v1/canillas/{id}`: Elimina el recurso del sistema.

**Ejecución del Proyecto**
1. Clonar el repositorio.
2. Ejecutar `npm install` para instalar Express y el driver SQL.
3. Asegurar que el contenedor de SQL Server esté activo en el puerto 1433 local.
4. Levantar el servidor de desarrollo con `node index.js`.
