const { getConnection, sql } = require('../config/db');

// 1. GET ALL
const getCanillas = async (req, res) => {
    try {
        const pool = await getConnection();
        const result = await pool.request().query('SELECT * FROM Canilla');
        res.status(200).json(result.recordset);
    } catch (error) {
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

// 5. DELETE (REMOVE)
const deleteCanilla = async (req, res, next) => {
    const { id } = req.params;

    try {
        const pool = await getConnection();
        const result = await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM Canilla WHERE id_canilla = @id');

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ error: "Canilla no encontrada para eliminar" });
        }

        res.status(204).send();
    } catch (error) {
        console.error("Error SQL Server en DELETE:", error); 
        res.status(500).json({ error: "Error interno del servidor" });
    }
};

module.exports = { getCanillas, getCanillaById, createCanilla, updateCanilla, deleteCanilla };