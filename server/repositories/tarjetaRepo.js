const { getConnection, sql } = require('../config/db');

/**
 * Repositorio de Tarjetas NFC (OmbuDB)
 */
class TarjetaRepository {
    async findById(idTarjeta) {
        const pool = await getConnection();
        const result = await pool.request()
            .input('id_tarjeta', sql.VarChar(32), idTarjeta)
            .query(`
                SELECT 
                    t.id_tarjeta,
                    t.saldo_actual,
                    t.estado AS estado_tarjeta,
                    c.id_cliente,
                    c.nombre,
                    c.apellido
                FROM TarjetaNFC t
                LEFT JOIN Cliente c ON t.id_cliente = c.id_cliente
                WHERE t.id_tarjeta = @id_tarjeta
            `);
        return result.recordset[0] || null;
    }

    async findAll() {
        const pool = await getConnection();
        const result = await pool.request().query(`
            SELECT 
                t.id_tarjeta AS uid,
                t.id_tarjeta,
                t.saldo_actual AS saldo,
                t.estado,
                t.id_cliente,
                c.nombre,
                c.apellido,
                CASE 
                    WHEN t.id_cliente IS NULL THEN 'Consumidor Final (Anónima)'
                    ELSE CONCAT(c.nombre, ' ', c.apellido)
                END AS titular,
                CASE 
                    WHEN t.id_cliente IS NULL THEN 'Anónima'
                    ELSE 'Nominada'
                END AS tipo
            FROM TarjetaNFC t
            LEFT JOIN Cliente c ON t.id_cliente = c.id_cliente
            ORDER BY t.id_cliente DESC, t.id_tarjeta ASC
        `);
        return result.recordset;
    }

    async debitarSaldo(transaction, idTarjeta, monto) {
        const request = new sql.Request(transaction);
        const result = await request
            .input('id_tarjeta', sql.VarChar(32), idTarjeta)
            .input('monto', sql.Decimal(10, 2), monto)
            .query(`
                UPDATE TarjetaNFC 
                SET saldo_actual = saldo_actual - @monto
                OUTPUT inserted.id_tarjeta, inserted.saldo_actual, inserted.id_cliente
                WHERE id_tarjeta = @id_tarjeta AND saldo_actual >= @monto AND estado = 'Activa'
            `);
        return result.recordset[0] || null;
    }
}

module.exports = new TarjetaRepository();
