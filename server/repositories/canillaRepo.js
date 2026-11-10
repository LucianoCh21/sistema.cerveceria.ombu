const { getConnection, sql } = require('../config/db');

/**
 * Repositorio de Canillas (OmbuDB)
 */
class CanillaRepository {
    async findById(idCanilla) {
        const pool = await getConnection();
        const result = await pool.request()
            .input('id_canilla', sql.Int, idCanilla)
            .query('SELECT id_canilla, estado FROM Canilla WHERE id_canilla = @id_canilla');
        return result.recordset[0] || null;
    }
}

module.exports = new CanillaRepository();
