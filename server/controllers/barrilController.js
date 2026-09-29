const { sql, getConnection } = require('../config/db');

/**
 * Obtiene todos los barriles que no estén en estado 'Retirado'.
 * Útil para alimentar tu Dashboard y mostrar el stock actual de las canillas.
 */
const getBarriles = async (req, res) => {
    let pool;
    try {
        pool = await getConnection();
        // Corregido: La tabla en la base de datos se llama 'Barril' (en singular)
        const result = await pool.request()
            .query("SELECT * FROM Barril WHERE estado != 'Retirado'");
        
        res.status(200).json(result.recordset);
    } catch (error) {
        console.error("Error al obtener los barriles:", error);
        res.status(500).json({ error: "Error interno del servidor al obtener barriles." });
    }
};

/**
 * Aplica un Soft Delete (Baja lógica) a un barril.
 * No borra el registro físicamente para no perder el historial de consumos.
 * Actualiza su estado a 'Retirado', libera la canilla (id_canilla = NULL), 
 * y registra la fecha exacta de desconexión.
 */
const retirarBarril = async (req, res) => {
    const { id } = req.params;
    let pool;

    try {
        pool = await getConnection();
        
        // 1. Verificamos si el barril existe en la base de datos
        const verifyResult = await pool.request()
            .input('id', sql.Int, id)
            .query("SELECT id_barril, estado FROM Barril WHERE id_barril = @id");
            
        if (verifyResult.recordset.length === 0) {
            return res.status(404).json({ error: "Barril no encontrado." });
        }
        
        // Evitamos volver a retirar un barril que ya fue retirado
        if (verifyResult.recordset[0].estado === 'Retirado') {
            return res.status(400).json({ error: "El barril ya se encuentra retirado." });
        }

        // 2. Ejecutamos el Soft Delete cambiando el estado
        await pool.request()
            .input('id', sql.Int, id)
            .query(`
                UPDATE Barril 
                SET estado = 'Retirado', 
                    id_canilla = NULL, 
                    fecha_desconexion = GETDATE()
                WHERE id_barril = @id
            `);

        res.status(204).send(); // Status 204 significa "Operación exitosa, sin contenido extra para devolver"
    } catch (error) {
        console.error("Error al retirar el barril:", error);
        res.status(500).json({ error: "Error interno del servidor al retirar el barril." });
    }
};

/**
 * Asigna un barril a una canilla física.
 * CRÍTICO: Utiliza una transacción SERIALIZABLE y bloqueos (UPDLOCK) 
 * para cumplir la regla RN-03 e impedir que dos empleados asignen un barril al mismo tiempo.
 */
const conectarBarril = async (req, res) => {
    // 1. Extraemos los parámetros. Se añade id_empleado_conexion que es NOT NULL en tu BD
    const { id_barril, id_canilla, id_empleado_conexion } = req.body;

    if (!id_barril || !id_canilla || !id_empleado_conexion) {
        return res.status(400).json({ error: "Se requiere id_barril, id_canilla y id_empleado_conexion." });
    }

    let pool;
    let transaction;

    try {
        pool = await getConnection();
        
        // 2. Preparamos el terreno para la transacción segura
        transaction = new sql.Transaction(pool);
        
        // Iniciamos la transacción con el nivel más estricto (SERIALIZABLE)
        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

        // 3. Validamos la canilla usando WITH (UPDLOCK, HOLDLOCK)
        // Esto le dice a SQL Server: "Bloquea esta fila para mí. Si otro empleado
        // intenta leerla para conectarle un barril, hazlo esperar hasta que yo termine".
        const canillaCheck = await transaction.request()
            .input('id_canilla', sql.Int, id_canilla)
            .query(`
                SELECT id_barril 
                FROM Barril WITH (UPDLOCK, HOLDLOCK)
                WHERE id_canilla = @id_canilla AND estado = 'Conectado'
            `);

        // Si la canilla ya tiene un barril, abortamos todo y soltamos el bloqueo (rollback)
        if (canillaCheck.recordset.length > 0) {
            await transaction.rollback();
            return res.status(400).json({ error: "La canilla ya tiene un barril conectado." });
        }

        // 4. Si la canilla está libre, procedemos a hacer el UPDATE con los datos del empleado
        const result = await transaction.request()
            .input('id_barril', sql.Int, id_barril)
            .input('id_canilla', sql.Int, id_canilla)
            .input('id_empleado_conexion', sql.Int, id_empleado_conexion)
            .query(`
                UPDATE Barril
                SET estado = 'Conectado', 
                    id_canilla = @id_canilla, 
                    id_empleado_conexion = @id_empleado_conexion,
                    fecha_conexion = GETDATE(),
                    fecha_desconexion = NULL
                WHERE id_barril = @id_barril AND estado != 'Retirado'
            `);
            
        if (result.rowsAffected[0] === 0) {
            await transaction.rollback();
            return res.status(404).json({ error: "Barril no encontrado o se encuentra 'Retirado'." });
        }

        // 5. Todo salió perfecto, confirmamos los cambios de forma permanente
        await transaction.commit();

        res.status(200).json({ message: "Barril conectado exitosamente." });
    } catch (error) {
        // Mecanismo de seguridad: Si falla el código o la red se cae a la mitad,
        // deshacemos cualquier cambio incompleto para proteger la base de datos
        if (transaction && transaction.isActive) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error("Error haciendo rollback:", rollbackError);
            }
        }
        console.error("Error al conectar el barril:", error);
        res.status(500).json({ error: "Error interno del servidor al conectar el barril." });
    }
};

module.exports = {
    getBarriles,
    retirarBarril,
    conectarBarril
};