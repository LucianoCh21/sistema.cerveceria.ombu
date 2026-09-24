const { getConnection, sql } = require('../config/db');
const { setNfcSession, getNfcSession } = require('../config/redis');

/**
 * Autentica la aproximación de una tarjeta física NFC a una canilla y crea sesión efímera en Redis.
 * Cumple con RN-02: TTL de 45 segundos de apertura de grifo.
 */
const autenticarTarjeta = async (req, res) => {
    const { uid_tarjeta, id_canilla } = req.body;

    if (!uid_tarjeta || id_canilla === undefined) {
        return res.status(400).json({
            ok: false,
            error: "Faltan parámetros obligatorios: uid_tarjeta e id_canilla son requeridos.",
            codigo: "MISSING_PARAMETERS"
        });
    }

    try {
        const pool = await getConnection();

        // 1. Validar existencia y estado de la tarjeta y cliente en SQL Server
        const queryTarjeta = `
            SELECT 
                t.id_tarjeta,
                t.uid_tarjeta,
                t.saldo,
                t.estado AS estado_tarjeta,
                c.id_cliente,
                c.nombre,
                c.apellido,
                c.estado AS estado_cliente
            FROM TarjetaNFC t
            INNER JOIN Cliente c ON t.id_cliente = c.id_cliente
            WHERE t.uid_tarjeta = @uid
        `;

        const result = await pool.request()
            .input('uid', sql.VarChar, uid_tarjeta)
            .query(queryTarjeta);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                ok: false,
                error: "La tarjeta NFC aproximada no se encuentra registrada en el sistema.",
                codigo: "CARD_NOT_FOUND"
            });
        }

        const tarjeta = result.recordset[0];

        // 2. Validar que la tarjeta y el cliente no estén dados de baja
        if (tarjeta.estado_tarjeta !== 'Activa') {
            return res.status(403).json({
                ok: false,
                error: `La tarjeta NFC se encuentra inhabilitada (Estado: ${tarjeta.estado_tarjeta}).`,
                codigo: "CARD_INACTIVE"
            });
        }

        // 3. Validar saldo mínimo para habilitar el grifo (ej. costo mínimo para media pinta)
        if (tarjeta.saldo <= 0) {
            return res.status(402).json({
                ok: false,
                error: "Saldo insuficiente. Debe realizar una recarga antes de servirse.",
                saldo_actual: tarjeta.saldo,
                codigo: "INSUFFICIENT_FUNDS"
            });
        }

        // 4. Iniciar sesión efímera en Redis con TTL estricto de 45 segundos
        const ttlSegundos = 45;
        const sessionPayload = {
            id_tarjeta: tarjeta.id_tarjeta,
            uid_tarjeta: tarjeta.uid_tarjeta,
            id_cliente: tarjeta.id_cliente,
            cliente_nombre: `${tarjeta.nombre} ${tarjeta.apellido}`.trim(),
            id_canilla: Number(id_canilla),
            saldo_disponible: Number(tarjeta.saldo),
            iniciado_en: new Date().toISOString()
        };

        await setNfcSession(uid_tarjeta, sessionPayload, ttlSegundos);

        return res.status(200).json({
            ok: true,
            sesionValida: true,
            uid_tarjeta: tarjeta.uid_tarjeta,
            id_tarjeta: tarjeta.id_tarjeta,
            id_cliente: tarjeta.id_cliente,
            cliente_nombre: sessionPayload.cliente_nombre,
            saldo_disponible: sessionPayload.saldo_disponible,
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
    const { uid } = req.params;
    if (!uid) {
        return res.status(400).json({ ok: false, error: "UID de tarjeta no provisto." });
    }

    try {
        const sesion = await getNfcSession(uid);
        if (!sesion) {
            return res.status(404).json({
                ok: false,
                activa: false,
                error: "No existe sesión activa para esta tarjeta (expiró o no fue autenticada)."
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

module.exports = {
    autenticarTarjeta,
    consultarSesion
};
