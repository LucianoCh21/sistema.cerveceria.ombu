const despachoService = require('../services/despachoService');
const comprobanteService = require('../services/comprobanteService');

/**
 * Controlador de Despachos y Comprobantes (Delgado: lee req, invoca servicio, responde res)
 */
const crearDespacho = async (req, res) => {
    const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
    const idTarjeta = req.body.id_tarjeta || req.body.uid_tarjeta;
    const { id_canilla, id_formato } = req.body;

    try {
        const respuesta = await despachoService.procesarDespacho({
            idempotencyKey,
            idTarjeta,
            idCanilla: id_canilla,
            idFormato: id_formato
        });

        const status = respuesta.idempotencia_aplicada ? 200 : 201;
        return res.status(status).json(respuesta);

    } catch (error) {
        if (error.status && error.status < 500) {
            return res.status(error.status).json({
                ok: false,
                error: error.message,
                codigo: error.codigo || 'ERROR'
            });
        }

        const traceId = Date.now().toString(36);
        console.error(`[${traceId}] [Despacho Controller] Error en crearDespacho:`, error);
        return res.status(500).json({
            ok: false,
            error: "No pudimos procesar el servido. Intentá de nuevo.",
            codigo: "TRANSACTION_FAILED",
            traceId
        });
    }
};

const obtenerComprobante = async (req, res) => {
    const { id } = req.params;

    try {
        const despacho = await despachoService.getDespachoDetalle(id);
        if (!despacho) {
            return res.status(404).json({ ok: false, error: "Despacho no encontrado." });
        }

        comprobanteService.generarTicketPdf(despacho, res);

    } catch (error) {
        console.error("[Despacho Controller] Error generando comprobante PDF:", error);
        return res.status(500).json({ ok: false, error: "Error al generar comprobante PDF." });
    }
};

module.exports = {
    crearDespacho,
    obtenerComprobante
};
