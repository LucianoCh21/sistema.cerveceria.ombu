const nfcService = require('../services/nfcService');

/**
 * Controlador de Lecturas y Autenticación NFC (Delgado: lee req, invoca servicio, responde res)
 */
const autenticarTarjeta = async (req, res) => {
    const idTarjeta = req.body.id_tarjeta || req.body.uid_tarjeta;
    const { id_canilla } = req.body;

    try {
        const resultado = await nfcService.autenticarTarjeta(idTarjeta, id_canilla);
        return res.status(200).json(resultado);
    } catch (error) {
        // 503 SESSION_UNAVAILABLE (Redis no disponible) se informa tal cual al cliente.
        if (error.status && (error.status < 500 || error.status === 503)) {
            return res.status(error.status).json({
                ok: false,
                error: error.message,
                codigo: error.codigo || 'VALIDATION_ERROR'
            });
        }
        const traceId = Date.now().toString(36);
        console.error(`[${traceId}] [NFC Controller] Error en autenticarTarjeta:`, error);
        return res.status(500).json({
            ok: false,
            error: "Error interno al autenticar tarjeta en base de datos.",
            codigo: "INTERNAL_SERVER_ERROR",
            traceId
        });
    }
};

const consultarSesion = async (req, res) => {
    const uid = req.params.uid || req.params.id;

    try {
        const resultado = await nfcService.consultarSesion(uid);
        return res.status(200).json(resultado);
    } catch (error) {
        if (error.status && error.status < 500) {
            return res.status(error.status).json({
                ok: false,
                activa: false,
                error: error.message
            });
        }
        const traceId = Date.now().toString(36);
        console.error(`[${traceId}] [NFC Controller] Error en consultarSesion:`, error);
        return res.status(500).json({
            ok: false,
            error: "Error interno al consultar la sesión.",
            codigo: "INTERNAL_SERVER_ERROR",
            traceId
        });
    }
};

const getTarjetas = async (req, res) => {
    try {
        const tarjetas = await nfcService.getTarjetas();
        return res.status(200).json({ ok: true, data: tarjetas });
    } catch (error) {
        const traceId = Date.now().toString(36);
        console.error(`[${traceId}] [NFC Controller] Error en getTarjetas:`, error);
        return res.status(500).json({
            ok: false,
            error: "Error interno al consultar tarjetas en base de datos.",
            codigo: "INTERNAL_SERVER_ERROR",
            traceId
        });
    }
};

const getFormatosYPrecios = async (req, res) => {
    const idCanilla = req.query.id_canilla !== undefined && req.query.id_canilla !== '' ? req.query.id_canilla : null;

    try {
        const resultado = await nfcService.getFormatosYPrecios(idCanilla);
        // Canilla sin barril: 200 con lista vacía y bandera explícita (el cliente actual
        // limpia los precios en pantalla con una lista vacía; un 409 los dejaría desactualizados).
        if (resultado.sinBarril) {
            return res.status(200).json({
                ok: true,
                id_canilla: Number(resultado.idCanilla),
                sin_barril: true,
                codigo: 'NO_ACTIVE_BARREL',
                mensaje: 'Esta canilla no tiene un barril conectado: no hay formatos a la venta.',
                id_cerveza: null,
                cerveza: null,
                formatos: []
            });
        }
        return res.status(200).json({
            ok: true,
            id_canilla: resultado.idCanilla,
            id_cerveza: resultado.idCerveza,
            cerveza: resultado.nombreCerveza || 'Cerveza Ombú',
            formatos: resultado.formatos
        });
    } catch (error) {
        if (error.status && error.status < 500) {
            return res.status(error.status).json({ ok: false, error: error.message, codigo: error.codigo || 'VALIDATION_ERROR' });
        }
        const traceId = Date.now().toString(36);
        console.error(`[${traceId}] [NFC Controller] Error en getFormatosYPrecios:`, error);
        return res.status(500).json({
            ok: false,
            error: "Error interno al consultar formatos y precios.",
            codigo: "INTERNAL_SERVER_ERROR",
            traceId
        });
    }
};

module.exports = {
    autenticarTarjeta,
    consultarSesion,
    getTarjetas,
    getFormatosYPrecios
};
