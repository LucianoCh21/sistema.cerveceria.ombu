const { getConnection, sql } = require('../config/db');
const redisExport = require('../config/redis');
const redisClient = redisExport.client || redisExport.redisClient || redisExport;

const getStockResumen = async (req, res) => {
    const cacheKey = 'stock:muro:resumen';

    try {
        // 1. Lectura de Redis con manejo de errores (Resiliencia RNF-14)
        try {
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
                return res.status(200).json({
                    origen: 'redis-cache',
                    data: JSON.parse(cachedData) // Corregido: asegura leer la variable correcta
                });
            }
        } catch (redisError) {
           // console.warn("⚠️ Fallo al leer de Redis (Degradación controlada hacia SQL Server):", redisError.message);
        }

        // 2. Consulta a SQL Server (Fallback)
        const pool = await getConnection();
        const result = await pool.request().query(`
            SELECT c.id_canilla, c.numero as numero_canilla, c.estado as estado_canilla, 
                   b.id_barril, b.litros_totales, b.litros_restantes, b.estado as estado_barril, 
                   ce.nombre as nombre_cerveza
            FROM Canilla c
            LEFT JOIN Barril b ON c.id_canilla = b.id_canilla AND b.estado = 'Conectado'
            LEFT JOIN Cerveza ce ON b.id_cerveza = ce.id_cerveza
        `);

        const resumen = result.recordset;

        // 3. Escritura en caché con soporte para versiones de Redis (v3 o v4)
        try {
            if (typeof redisClient.setEx === 'function') {
                await redisClient.setEx(cacheKey, 60, JSON.stringify(resumen));
            } else if (typeof redisClient.setex === 'function') {
                await redisClient.setex(cacheKey, 60, JSON.stringify(resumen));
            }
        } catch (redisError) {
            // console.warn("⚠️ Fallo al escribir en caché de Redis:", redisError.message);
        }

        return res.status(200).json({
            origen: 'sql-server',
            data: resumen
        });

    } catch (error) {
        // Este catch captura errores reales de caída de SQL Server
        console.error("❌ Error crítico en getStockResumen:", error);
        return res.status(500).json({ error: "Error interno del servidor al obtener el resumen de stock" });
    }
};

module.exports = { getStockResumen };