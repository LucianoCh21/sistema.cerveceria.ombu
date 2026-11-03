const { getConnection, sql } = require('../config/db');

/**
 * Función de seguridad para detectar patrones de inyección maliciosa (XSS y SQL Injection)
 * Protege contra cadenas de comandos SQL y etiquetas o scripts embebidos en el payload.
 */
const contienePatronMalicioso = (valor) => {
    if (typeof valor !== 'string') return false;
    const patronXSS = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>|<[^>]+>/i;
    const patronSQLi = /(--|;|\/\*|\*\/|@@|char|nchar|varchar|nvarchar|alter|begin|cast|create|cursor|declare|delete|drop|end|exec|execute|fetch|insert|kill|open|select|sys|table|update)/i;
    return patronXSS.test(valor) || patronSQLi.test(valor);
};

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
    if (numero === undefined || numero === null || !estado) {
        return res.status(400).json({ error: "Faltan campos obligatorios (numero, estado)" });
    }

    // Blindaje y sanitización: Detección proactiva de XSS y SQL Injection
    if (contienePatronMalicioso(String(numero)) || contienePatronMalicioso(String(estado))) {
        return res.status(400).json({ 
            error: "Entrada rechazada: se detectaron caracteres o sentencias maliciosas (XSS/SQLi)" 
        });
    }

    // Validación de tipo y rango para 'numero'
    const numParsed = Number(numero);
    if (!Number.isInteger(numParsed) || numParsed <= 0) {
        return res.status(400).json({ 
            error: "El campo numero debe ser un entero positivo válido" 
        });
    }

    // Validación de catálogo para 'estado'
    const estadosPermitidos = ['Activa', 'Inactiva', 'Mantenimiento', 'Desconectada'];
    if (typeof estado !== 'string' || !estadosPermitidos.includes(estado.trim())) {
        return res.status(400).json({ 
            error: `Estado inválido. Valores permitidos: ${estadosPermitidos.join(', ')}` 
        });
    }
    
    try {
        const pool = await getConnection();
        await pool.request()
            .input('numero', sql.Int, numParsed)
            .input('estado', sql.VarChar, estado.trim())
            .query('INSERT INTO Canilla (numero, estado, fecha_alta) VALUES (@numero, @estado, GETDATE())');
        res.status(201).json({ message: "Canilla creada exitosamente" });
    } catch (error) {
        console.error("Error SQL Server:", error);
        if (error.name === 'TypeError' || error.code === 'EPARAM' || error.number === 245) {
            return res.status(400).json({ error: "Parámetros inválidos para la base de datos" });
        }
        res.status(500).json({ error: "Error interno del servidor" });
    }
};

// 4. PUT (UPDATE)
const updateCanilla = async (req, res, next) => {
    const { numero, estado } = req.body;
    const { id } = req.params;

    if (numero === undefined || numero === null || !estado) {
        return res.status(400).json({ error: "Faltan campos obligatorios (numero, estado)" });
    }

    // Blindaje y sanitización: Detección proactiva de XSS y SQL Injection
    if (contienePatronMalicioso(String(numero)) || contienePatronMalicioso(String(estado))) {
        return res.status(400).json({ 
            error: "Entrada rechazada: se detectaron caracteres o sentencias maliciosas (XSS/SQLi)" 
        });
    }

    const numParsed = Number(numero);
    if (!Number.isInteger(numParsed) || numParsed <= 0) {
        return res.status(400).json({ 
            error: "El campo numero debe ser un entero positivo válido" 
        });
    }

    const estadosPermitidos = ['Activa', 'Inactiva', 'Mantenimiento', 'Desconectada'];
    if (typeof estado !== 'string' || !estadosPermitidos.includes(estado.trim())) {
        return res.status(400).json({ 
            error: `Estado inválido. Valores permitidos: ${estadosPermitidos.join(', ')}` 
        });
    }

    try {
        const pool = await getConnection();
        const result = await pool.request()
            .input('id', sql.Int, id)
            .input('numero', sql.Int, numParsed)
            .input('estado', sql.VarChar, estado.trim())
            .query('UPDATE Canilla SET numero = @numero, estado = @estado WHERE id_canilla = @id');

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ error: "Canilla no encontrada para actualizar" });
        }

        res.status(200).json({ message: "Canilla actualizada exitosamente" });
    } catch (error) {
        console.error("Error SQL Server en PUT:", error); 
        if (error.name === 'TypeError' || error.code === 'EPARAM' || error.number === 245) {
            return res.status(400).json({ error: "Parámetros inválidos para la base de datos" });
        }
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
