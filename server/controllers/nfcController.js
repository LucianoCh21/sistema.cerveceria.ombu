const { getConnection, sql } = require('../config/db');
const { setNfcSession, getNfcSession } = require('../config/redis');

/**
 * Autentica la aproximación de una tarjeta física NFC a una canilla y crea sesión efímera en Redis.
 * Cumple con RN-02: TTL de 45 segundos de apertura de grifo.
 * Adaptado a OmbuDB (soporta tarjetas nominadas y anónimas con id_tarjeta VARCHAR y saldo_actual).
 */
const autenticarTarjeta = async (req, res) => {
    // Acepta id_tarjeta o uid_tarjeta por retrocompatibilidad
    const idTarjeta = req.body.id_tarjeta || req.body.uid_tarjeta;
    const { id_canilla } = req.body;

    if (!idTarjeta || id_canilla === undefined) {
        return res.status(400).json({
            ok: false,
            error: "Faltan parámetros obligatorios: id_tarjeta (o uid_tarjeta) e id_canilla son requeridos.",
            codigo: "MISSING_PARAMETERS"
        });
    }

    try {
        const pool = await getConnection();

        // 1. Validar existencia y estado de la tarjeta y cliente en SQL Server (LEFT JOIN para admitir tarjetas anónimas)
        const queryTarjeta = `
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
        `;

        const result = await pool.request()
            .input('id_tarjeta', sql.VarChar(32), idTarjeta)
            .query(queryTarjeta);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "La tarjeta NFC aproximada no se encuentra registrada en el sistema.",
                codigo: "CARD_NOT_FOUND"
            });
        }

        const tarjeta = result.recordset[0];

        // 2. Validar que la tarjeta no esté dada de baja ni bloqueada
        if (tarjeta.estado_tarjeta !== 'Activa') {
            return res.status(403).json({
                ok: false,
                error: `La tarjeta NFC se encuentra inhabilitada (Estado: ${tarjeta.estado_tarjeta}).`,
                codigo: "CARD_INACTIVE"
            });
        }

        // 3. Validar saldo mínimo para habilitar el grifo
        const saldoDisponible = Number(tarjeta.saldo_actual);
        if (saldoDisponible <= 0) {
            return res.status(402).json({
                ok: false,
                error: "Saldo insuficiente. Debe realizar una recarga antes de servirse.",
                saldo_actual: saldoDisponible,
                codigo: "INSUFFICIENT_FUNDS"
            });
        }

        // 4. Iniciar sesión efímera en Redis con TTL estricto de 45 segundos
        const ttlSegundos = 45;
        const clienteNombre = tarjeta.nombre 
            ? `${tarjeta.nombre} ${tarjeta.apellido}`.trim() 
            : 'Consumidor Final / Anónimo';

        const sessionPayload = {
            id_tarjeta: tarjeta.id_tarjeta,
            uid_tarjeta: tarjeta.id_tarjeta, // Retrocompatibilidad
            id_cliente: tarjeta.id_cliente || null,
            cliente_nombre: clienteNombre,
            id_canilla: Number(id_canilla),
            saldo_disponible: saldoDisponible,
            iniciado_en: new Date().toISOString()
        };

        // Guardar sesión en Redis usando el ID de la tarjeta
        await setNfcSession(idTarjeta, sessionPayload, ttlSegundos);

        return res.status(200).json({
            ok: true,
            sesionValida: true,
            id_tarjeta: tarjeta.id_tarjeta,
            uid_tarjeta: tarjeta.id_tarjeta,
            id_cliente: tarjeta.id_cliente || null,
            cliente_nombre: clienteNombre,
            saldo_disponible: saldoDisponible,
            id_canilla: Number(id_canilla),
            ttl_segundos: ttlSegundos
        });

    } catch (error) {
        console.error("[NFC Controller] Error en autenticarTarjeta:", error);
        return res.status(500).json({
            ok: false,
            error: "Error interno al autenticar tarjeta en base de datos.",
            detalles: error.message,
            codigo: "INTERNAL_SERVER_ERROR"
        });
    }
};

/**
 * Consulta si una tarjeta tiene una sesión efímera vigente en Redis.
 */
const consultarSesion = async (req, res) => {
    const uid = req.params.uid || req.params.id;
    if (!uid) {
        return res.status(400).json({ ok: false, error: "Identificador de tarjeta no provisto." });
    }

    try {
        const sesion = await getNfcSession(uid);
        if (!sesion) {
            return res.status(404).json({
                ok: false,
                activa: false,
                error: "No existe sesión activa para esta tarjeta (expiró o no fue aproximada)."
            });
        }

        return res.status(200).json({
            ok: true,
            activa: true,
            sesion
        });
    } catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
    }
};

/**
 * Obtiene todas las tarjetas NFC registradas en OmbuDB con saldo y titular real.
 */
const getTarjetas = async (req, res) => {
    try {
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

        return res.status(200).json({
            ok: true,
            data: result.recordset
        });
    } catch (error) {
        console.error("[NFC Controller] Error en getTarjetas:", error);
        return res.status(500).json({
            ok: false,
            error: "Error interno al consultar tarjetas en base de datos."
        });
    }
};

/**
 * Obtiene formatos de servicio y precios vigentes según la canilla/cerveza seleccionada.
 */
const getFormatosYPrecios = async (req, res) => {
    const idCanilla = req.query.id_canilla ? Number(req.query.id_canilla) : null;

    try {
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
                ISNULL(pc.precio, CASE 
                    WHEN fs.mililitros = 250 THEN 1950.00
                    WHEN fs.mililitros = 500 THEN 3500.00
                    WHEN fs.mililitros = 1000 THEN 6500.00
                    ELSE 3000.00
                END) AS precio,
                CASE 
                    WHEN fs.mililitros <= 300 THEN '🍺'
                    WHEN fs.mililitros <= 600 THEN '🍻'
                    ELSE '🛢️'
                END AS icon
            FROM FormatoServicio fs
            LEFT JOIN PrecioCerveza pc ON fs.id_formato = pc.id_formato 
                AND pc.vigente_hasta IS NULL
        `;

        if (idCerveza) {
            reqPrecios.input('id_cerveza', sql.Int, idCerveza);
            queryPrecios += ` AND pc.id_cerveza = @id_cerveza`;
        }

        queryPrecios += ` ORDER BY fs.mililitros ASC`;

        const result = await reqPrecios.query(queryPrecios);

        return res.status(200).json({
            ok: true,
            id_canilla: idCanilla,
            id_cerveza: idCerveza,
            cerveza: nombreCerveza || 'Cerveza Ombú',
            formatos: result.recordset
        });
    } catch (error) {
        console.error("[NFC Controller] Error en getFormatosYPrecios:", error);
        return res.status(500).json({
            ok: false,
            error: "Error interno al consultar formatos y precios."
        });
    }
};

module.exports = {
    autenticarTarjeta,
    consultarSesion,
    getTarjetas,
    getFormatosYPrecios
};
