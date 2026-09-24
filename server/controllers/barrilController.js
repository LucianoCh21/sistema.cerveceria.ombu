const { sql, getConnection } = require('../config/db');

/**
 * Obtiene todos los barriles que no estén en estado 'Retirado'.
 */
const getBarriles = async (req, res) => {
    let pool;
    try {
        pool = await getConnection();
        const result = await pool.request()
            .query("SELECT * FROM Barriles WHERE estado != 'Retirado'");
        
        res.status(200).json(result.recordset);
    } catch (error) {
        console.error("Error al obtener los barriles:", error);
        res.status(500).json({ error: "Error interno del servidor al obtener barriles." });
    }
};

/**
 * Aplica un Soft Delete (Baja lógica) a un barril.
 * Actualiza su estado a 'Retirado', desvincula la canilla (id_canilla = NULL), 
 * y establece la fecha de desconexión. Retorna 204.
 */
const retirarBarril = async (req, res) => {
    const { id } = req.params;
    let pool;

    try {
        pool = await getConnection();
        
        // Verificamos si el barril existe antes de intentar retirarlo
        const verifyResult = await pool.request()
            .input('id', sql.Int, id)
            .query("SELECT id_barril, estado FROM Barriles WHERE id_barril = @id");
            
        if (verifyResult.recordset.length === 0) {
            return res.status(404).json({ error: "Barril no encontrado." });
        }
        
        if (verifyResult.recordset[0].estado === 'Retirado') {
            return res.status(400).json({ error: "El barril ya se encuentra retirado." });
        }

        await pool.request()
            .input('id', sql.Int, id)
            .query(`
                UPDATE Barriles 
                SET estado = 'Retirado', 
                    id_canilla = NULL, 
                    fecha_desconexion = GETDATE()
                WHERE id_barril = @id
            `);

        res.status(204).send(); // 204 No Content
    } catch (error) {
        console.error("Error al retirar el barril:", error);
        res.status(500).json({ error: "Error interno del servidor al retirar el barril." });
    }
};

/**
 * Asigna un barril a una canilla.
 * CRITICO: Implementa transacción SERIALIZABLE para evitar condición de carrera (RN-03).
 */
const conectarBarril = async (req, res) => {
    const { id_barril, id_canilla } = req.body;

    if (!id_barril || !id_canilla) {
        return res.status(400).json({ error: "Se requiere id_barril y id_canilla." });
    }

    let pool;
    let transaction;

    try {
        pool = await getConnection();
        
        // Creamos la transacción
        transaction = new sql.Transaction(pool);
        
        // Iniciamos la transacción con nivel de aislamiento SERIALIZABLE
        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

        // Validamos la canilla con UPDLOCK o bloqueo por transacción para que otros queries esperen
        const canillaCheck = await transaction.request()
            .input('id_canilla', sql.Int, id_canilla)
            .query(`
                SELECT id_barril 
                FROM Barriles WITH (UPDLOCK, HOLDLOCK)
                WHERE id_canilla = @id_canilla AND estado = 'Conectado'
            `);

        // Si ya hay un barril conectado a esa canilla, hacemos rollback y error 400
        if (canillaCheck.recordset.length > 0) {
            await transaction.rollback();
            return res.status(400).json({ error: "La canilla ya tiene un barril conectado." });
        }

        // Si la canilla está libre, procedemos a conectar el barril
        const result = await transaction.request()
            .input('id_barril', sql.Int, id_barril)
            .input('id_canilla', sql.Int, id_canilla)
            .query(`
                UPDATE Barriles
                SET estado = 'Conectado', 
                    id_canilla = @id_canilla, 
                    fecha_conexion = GETDATE(),
                    fecha_desconexion = NULL
                WHERE id_barril = @id_barril AND estado != 'Retirado'
            `);
            
        if (result.rowsAffected[0] === 0) {
            await transaction.rollback();
            return res.status(404).json({ error: "Barril no encontrado o se encuentra 'Retirado'." });
        }

        // Confirmamos la transacción
        await transaction.commit();

        res.status(200).json({ message: "Barril conectado exitosamente." });
    } catch (error) {
        // En caso de cualquier error, abortamos la transacción
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
