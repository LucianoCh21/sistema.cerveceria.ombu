const { mililitrosALitros } = require('../domain/volumen');
const { getConnection, sql } = require('../config/db');
const { getNfcSession, deleteNfcSession, setIdempotencyResult, getIdempotencyResult } = require('../config/redis');
const tarjetaRepo = require('../repositories/tarjetaRepo');
const despachoRepo = require('../repositories/despachoRepo');

/**
 * Servicio de Negocio de Despachos y Cobros Transaccionales
 */
class DespachoService {
    async procesarDespacho({ idempotencyKey, idTarjeta, idCanilla, idFormato }) {
        if (!idempotencyKey) {
            const err = new Error("La cabecera 'Idempotency-Key' es obligatoria para garantizar la integridad del cobro.");
            err.codigo = "MISSING_IDEMPOTENCY_KEY";
            err.status = 400;
            throw err;
        }

        if (!idTarjeta || idCanilla === undefined) {
            const err = new Error("Faltan datos obligatorios para registrar el despacho (id_tarjeta/uid_tarjeta, id_canilla).");
            err.codigo = "MISSING_PARAMETERS";
            err.status = 400;
            throw err;
        }

        const formatoId = Number(idFormato);
        if (!Number.isInteger(formatoId) || formatoId <= 0) {
            const err = new Error("Seleccioná un formato de servicio válido.");
            err.codigo = "INVALID_FORMAT";
            err.status = 400;
            throw err;
        }

        // 1. Verificación de Idempotencia previa
        const operacionPrevia = await getIdempotencyResult(idempotencyKey);
        if (operacionPrevia) {
            console.log(`[Idempotencia] Solicitud repetida detectada (${idempotencyKey}). Retornando respuesta previa.`);
            return {
                ...operacionPrevia,
                idempotencia_aplicada: true
            };
        }

        // 2. Validación de Sesión Efímera en Redis (Control de TTL 45s y Canilla)
        const sesion = await getNfcSession(idTarjeta);
        if (!sesion) {
            const err = new Error("La sesión del grifo ha expirado (TTL de 45 segundos agotado) o la tarjeta no fue aproximada al lector.");
            err.codigo = "SESSION_EXPIRED";
            err.status = 403;
            throw err;
        }

        if (Number(sesion.id_canilla) !== Number(idCanilla)) {
            const err = new Error("La tarjeta fue habilitada en otra canilla. Volvé a apoyarla en esta.");
            err.codigo = "SESSION_TAP_MISMATCH";
            err.status = 403;
            throw err;
        }

        const pool = await getConnection();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 3. Validar canilla y barril conectado
            const barrilActivo = await despachoRepo.getBarrilActivoPorCanilla(transaction, idCanilla);
            if (!barrilActivo) {
                await transaction.rollback();
                const err = new Error("La canilla seleccionada no cuenta con un barril conectado activamente o se encuentra cerrada.");
                err.codigo = "NO_ACTIVE_BARREL";
                err.status = 409;
                throw err;
            }

            // 4. Obtener precio vigente y volumen
            const datosPrecio = await despachoRepo.getPrecioYFormatoVigente(transaction, barrilActivo.id_cerveza, formatoId);
            if (!datosPrecio) {
                await transaction.rollback();
                const err = new Error("Este formato no tiene precio vigente para la cerveza servida.");
                err.codigo = "PRICE_NOT_FOUND";
                err.status = 409;
                throw err;
            }

            const { nombre: formatoNombre, mililitros: mlServidos, precio } = datosPrecio;
            const precioCobrado = Number(precio);
            const volumenLitros = mililitrosALitros(mlServidos);

            if (Number(barrilActivo.litros_restantes) < volumenLitros) {
                await transaction.rollback();
                const err = new Error("Stock insuficiente en el barril conectado para servir el volumen solicitado.");
                err.codigo = "INSUFFICIENT_STOCK";
                err.status = 409;
                throw err;
            }

            // 5. Débito atómico en tarjeta
            const tarjetaActualizada = await tarjetaRepo.debitarSaldo(transaction, idTarjeta, precioCobrado);
            if (!tarjetaActualizada) {
                await transaction.rollback();
                const err = new Error("Saldo insuficiente en la tarjeta o tarjeta inhabilitada al momento de debitar.");
                err.codigo = "INSUFFICIENT_FUNDS";
                err.status = 402;
                throw err;
            }

            // 6. Descontar litros del barril
            await despachoRepo.descontarLitrosBarril(transaction, barrilActivo.id_barril, volumenLitros);

            // 7. Insertar registro en tabla Despacho
            const despachoInsertado = await despachoRepo.insertarDespacho(transaction, {
                idTarjeta: tarjetaActualizada.id_tarjeta,
                idCanilla: Number(idCanilla),
                idBarril: barrilActivo.id_barril,
                idFormato: formatoId,
                mlServidos,
                precioCobrado
            });

            // 8. Construir evento y guardar en EventoOutbox (F-07)
            const eventoPayload = {
                eventId: `evt-${Date.now()}-${despachoInsertado.id_despacho}`,
                eventType: "DespachoRealizado",
                occurredAt: despachoInsertado.fecha_hora.toISOString(),
                version: "1.0",
                idempotencyKey: idempotencyKey,
                producer: "modulo-nfc-despachos",
                data: {
                    idDespacho: despachoInsertado.id_despacho,
                    idCanilla: Number(idCanilla),
                    idBarril: barrilActivo.id_barril,
                    idFormato: formatoId,
                    volumenLitros: volumenLitros,
                    mililitros: mlServidos,
                    formato: formatoNombre,
                    importeDebitado: precioCobrado,
                    idTarjeta: tarjetaActualizada.id_tarjeta,
                    idCliente: tarjetaActualizada.id_cliente || null
                }
            };

            await despachoRepo.insertarOutbox(transaction, 'DespachoRealizado', eventoPayload);

            // 9. Confirmar transacción
            await transaction.commit();

            // 10. Eliminar sesión efímera en Redis
            await deleteNfcSession(idTarjeta);

            // 11. Armar respuesta
            const clienteNombre = sesion?.cliente_nombre || (tarjetaActualizada.id_cliente ? 'Cliente Ombú' : 'Consumidor Final');

            const responseData = {
                ok: true,
                id_despacho: despachoInsertado.id_despacho,
                id_canilla: Number(idCanilla),
                id_barril: barrilActivo.id_barril,
                cerveza: barrilActivo.nombre_cerveza || 'Cerveza Ombú',
                cliente: clienteNombre,
                cliente_nombre: clienteNombre,
                id_formato: formatoId,
                formato: formatoNombre,
                volumen_litros: volumenLitros,
                mililitros_servidos: mlServidos,
                importe: precioCobrado,
                importe_cobrado: precioCobrado,
                importe_debitado: precioCobrado,
                precio_cobrado: precioCobrado,
                saldo_restante: Number(tarjetaActualizada.saldo_actual),
                comprobante_url: `/api/despachos/${despachoInsertado.id_despacho}/comprobante`,
                evento_outbox_registrado: true,
                fecha_hora: despachoInsertado.fecha_hora
            };

            // 12. Guardar resultado de idempotencia en Redis
            await setIdempotencyResult(idempotencyKey, responseData, 300);

            return responseData;

        } catch (txErr) {
            try { await transaction.rollback(); } catch (_) {}
            throw txErr;
        }
    }

    async getDespachoDetalle(idDespacho) {
        return despachoRepo.findDespachoById(idDespacho);
    }
}

module.exports = new DespachoService();
