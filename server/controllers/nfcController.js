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

module.exports = {
    autenticarTarjeta,
    consultarSesion
};
