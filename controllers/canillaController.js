const { getConnection, sql } = require('../config/db');

const getCanillas = async (req, res) => {
    try {
        const pool = await getConnection();
        const result = await pool.request().query('SELECT * FROM Canilla');
        res.status(200).json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: "Error interno del servidor" });
    }
};

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
        res.status(500).json({ error: "Error interno del servidor" });
    }
};

module.exports = { getCanillas, getCanillaById, createCanilla };