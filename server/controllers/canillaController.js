const { getConnection, sql } = require('../config/db');

// 1. GET ALL
const getCanillas = async (req, res) => {
    try {
        const pool = await getConnection();
        const result = await pool.request().query(`
            SELECT 
                c.id_canilla, 
                c.numero, 
                c.estado, 
                c.fecha_alta,
                b.id_barril,
                b.litros_restantes,
                b.litros_totales,
                b.estado AS estado_barril,
                ce.id_cerveza,
                ce.nombre AS estilo,
                ce.nombre AS estilo_cerveza,
                ce.nombre AS nombre_cerveza,
                ec.nombre AS variedad,
                ce.ibu,
                ce.abv
            FROM Canilla c
            LEFT JOIN Barril b ON c.id_canilla = b.id_canilla AND b.estado = 'Conectado'
            LEFT JOIN Cerveza ce ON b.id_cerveza = ce.id_cerveza
            LEFT JOIN EstiloCerveza ec ON ce.id_estilo = ec.id_estilo
            ORDER BY c.numero ASC
        `);
        res.status(200).json(result.recordset);
    } catch (error) {
        console.error("Error al obtener canillas:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
};

// 2. GET BY ID
const getCanillaById = async (req, res) => {
    try {
        const pool = await getConnection();
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('SELECT * FROM Canilla WHERE id_canilla = @id');
        
        if (result.recordset.length === 0) return res.status(404).json({ error: "Canilla no encontrada" });
        res.status(200).json(result.recordset[0]);
    } catch (error) {
        res.status(500).json({ error: "Error interno del servidor" });
    }
};

// 3. POST (CREATE)
const createCanilla = async (req, res) => {
    const { numero, estado } = req.body;
    if (!numero || !estado) return res.status(400).json({ error: "Faltan campos obligatorios" });
    
    try {
        const pool = await getConnection();
        await pool.request()
            .input('numero', sql.Int, numero)
            .input('estado', sql.VarChar, estado)
            .query('INSERT INTO Canilla (numero, estado, fecha_alta) VALUES (@numero, @estado, GETDATE())');
        res.status(201).json({ message: "Canilla creada exitosamente" });
    } catch (error) {
        console.error("Error SQL Server:", error); // Esto imprimirá el error real en tu terminal
        res.status(500).json({ error: "Error interno del servidor" });
    }
};

// 4. PUT (UPDATE)
const updateCanilla = async (req, res, next) => {
    const { numero, estado } = req.body;
    const { id } = req.params;

    if (!numero || !estado) {
        return res.status(400).json({ error: "Faltan campos obligatorios (numero, estado)" });
    }

    try {
        const pool = await getConnection();
        const result = await pool.request()
            .input('id', sql.Int, id)
            .input('numero', sql.Int, numero)
            .input('estado', sql.VarChar, estado)
            .query('UPDATE Canilla SET numero = @numero, estado = @estado WHERE id_canilla = @id');

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ error: "Canilla no encontrada para actualizar" });
        }

        res.status(200).json({ message: "Canilla actualizada exitosamente" });
    } catch (error) {
        // AQUÍ EXPONEMOS EL ERROR EN LA TERMINAL
        console.error("Error SQL Server en PUT:", error); 
        res.status(500).json({ error: "Error interno del servidor" });
    }
};

// 5. DELETE (SOFT DELETE)
const deleteCanilla = async (req, res, next) => {
    const { id } = req.params;

    try {
        const pool = await getConnection();
        // Borrado lógico para preservar integridad referencial con el histórico de Despacho y Barril
        const result = await pool.request()
            .input('id', sql.Int, id)
            .query("UPDATE Canilla SET estado = 'Inactiva' WHERE id_canilla = @id");

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ error: "Canilla no encontrada para desactivar" });
        }

        res.status(200).json({ message: "Canilla desactivada exitosamente (borrado lógico)" });
    } catch (error) {
        console.error("Error SQL Server en DELETE (soft-delete):", error); 
        res.status(500).json({ error: "Error interno del servidor" });
    }
};

module.exports = { getCanillas, getCanillaById, createCanilla, updateCanilla, deleteCanilla };