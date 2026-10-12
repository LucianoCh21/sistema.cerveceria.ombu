const { getConnection, sql } = require('../config/db');

/**
 * Repositorio de Despachos y Operaciones Transaccionales (OmbuDB)
 */
class DespachoRepository {
    async getBarrilActivoPorCanilla(transaction, idCanilla) {
        const request = new sql.Request(transaction);
        const result = await request
            .input('id_canilla', sql.Int, Number(idCanilla))
            .query(`
                SELECT b.id_barril, b.id_cerveza, b.litros_restantes, b.estado, ce.nombre AS nombre_cerveza
                FROM Barril b
                JOIN Cerveza ce ON b.id_cerveza = ce.id_cerveza
                WHERE b.id_canilla = @id_canilla AND b.estado = 'Conectado'
            `);
        return result.recordset[0] || null;
    }

    async getPrecioYFormatoVigente(transaction, idCerveza, idFormato) {
        const request = new sql.Request(transaction);
        const result = await request
            .input('id_cerveza', sql.Int, idCerveza)
            .input('id_formato', sql.Int, idFormato)
            .query(`
                SELECT fs.nombre, fs.mililitros, pc.precio
                FROM FormatoServicio fs
                JOIN PrecioCerveza pc ON pc.id_formato = fs.id_formato
                WHERE fs.id_formato = @id_formato
                  AND pc.id_cerveza = @id_cerveza
                  AND pc.vigente_hasta IS NULL
            `);
        return result.recordset[0] || null;
    }

    async descontarLitrosBarril(transaction, idBarril, volumenLitros) {
        const request = new sql.Request(transaction);
        return request
            .input('id_barril', sql.Int, idBarril)
            .input('litros', sql.Decimal(6, 2), volumenLitros)
            .query(`
                UPDATE Barril
                SET litros_restantes = CASE WHEN (litros_restantes - @litros) < 0 THEN 0.00 ELSE (litros_restantes - @litros) END,
                    estado = CASE WHEN (litros_restantes - @litros) <= 0 THEN 'Agotado' ELSE 'Conectado' END,
                    fecha_desconexion = CASE WHEN (litros_restantes - @litros) <= 0 THEN GETDATE() ELSE NULL END
                WHERE id_barril = @id_barril
            `);
    }

    async insertarDespacho(transaction, datos) {
        const { idTarjeta, idCanilla, idBarril, idFormato, mlServidos, precioCobrado } = datos;
        const request = new sql.Request(transaction);
        const result = await request
            .input('id_tarjeta', sql.VarChar(32), idTarjeta)
            .input('id_canilla', sql.Int, Number(idCanilla))
            .input('id_barril', sql.Int, idBarril)
            .input('id_formato', sql.Int, idFormato)
            .input('mililitros_servidos', sql.SmallInt, mlServidos)
            .input('precio_cobrado', sql.Decimal(10, 2), precioCobrado)
            .query(`
                INSERT INTO Despacho (
                    id_tarjeta, id_canilla, id_barril, id_formato,
                    mililitros_servidos, precio_cobrado, monto_compensacion,
                    fecha_hora, estado
                )
                OUTPUT inserted.id_despacho, inserted.fecha_hora
                VALUES (
                    @id_tarjeta, @id_canilla, @id_barril, @id_formato,
                    @mililitros_servidos, @precio_cobrado, 0.00,
                    GETDATE(), 'Exitoso'
                )
            `);
        return result.recordset[0];
    }

    async insertarOutbox(transaction, tipo, payload) {
        const request = new sql.Request(transaction);
        return request
            .input('tipo', sql.VarChar(60), tipo)
            .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
            .query(`
                INSERT INTO EventoOutbox (tipo, payload)
                VALUES (@tipo, @payload)
            `);
    }

    async findDespachoById(idDespacho) {
        const pool = await getConnection();
        const result = await pool.request()
            .input('id', sql.BigInt, Number(idDespacho))
            .query(`
                SELECT 
                    d.id_despacho,
                    d.mililitros_servidos,
                    d.precio_cobrado,
                    d.monto_compensacion,
                    d.fecha_hora,
                    d.id_canilla,
                    d.id_barril,
                    d.id_formato,
                    f.nombre AS formato_nombre,
                    cz.nombre AS cerveza_nombre,
                    t.id_tarjeta,
                    t.saldo_actual,
                    c.id_cliente,
                    c.nombre AS cliente_nombre,
                    c.apellido AS cliente_apellido
                FROM Despacho d
                INNER JOIN FormatoServicio f ON d.id_formato = f.id_formato
                INNER JOIN Barril b ON d.id_barril = b.id_barril
                INNER JOIN Cerveza cz ON b.id_cerveza = cz.id_cerveza
                INNER JOIN TarjetaNFC t ON d.id_tarjeta = t.id_tarjeta
                LEFT JOIN Cliente c ON t.id_cliente = c.id_cliente
                WHERE d.id_despacho = @id
            `);
        return result.recordset[0] || null;
    }

    async getFormatosYPreciosPorCanilla(idCanilla) {
        const pool = await getConnection();
        let idCerveza = null;
        let nombreCerveza = null;

        if (idCanilla) {
            const canillaResult = await pool.request()
                .input('id_canilla', sql.Int, idCanilla)
                .query(`
                    SELECT b.id_cerveza, ce.nombre as nombre_cerveza
                    FROM Canilla c
                    LEFT JOIN Barril b ON c.id_canilla = b.id_canilla AND b.estado = 'Conectado'
                    LEFT JOIN Cerveza ce ON b.id_cerveza = ce.id_cerveza
                    WHERE c.id_canilla = @id_canilla
                `);
            if (canillaResult.recordset.length > 0) {
                idCerveza = canillaResult.recordset[0].id_cerveza;
                nombreCerveza = canillaResult.recordset[0].nombre_cerveza;
            }
        }

        const reqPrecios = pool.request();
        let queryPrecios = `
            SELECT 
                fs.id_formato AS id,
                fs.nombre,
                fs.mililitros AS ml,
                pc.precio AS precio,
                CASE 
                    WHEN fs.mililitros <= 300 THEN '🍺'
                    WHEN fs.mililitros <= 600 THEN '🍻'
                    ELSE '🛢️'
                END AS icon
            FROM FormatoServicio fs
            JOIN PrecioCerveza pc ON fs.id_formato = pc.id_formato 
                AND pc.vigente_hasta IS NULL
        `;

        if (idCerveza) {
            reqPrecios.input('id_cerveza', sql.Int, idCerveza);
            queryPrecios += ` WHERE pc.id_cerveza = @id_cerveza`;
        }

        queryPrecios += ` ORDER BY fs.mililitros ASC`;

        const result = await reqPrecios.query(queryPrecios);
        return {
            idCanilla,
            idCerveza,
            nombreCerveza,
            formatos: result.recordset
        };
    }
}

module.exports = new DespachoRepository();
