const tarjetaRepo = require('../repositories/tarjetaRepo');
const despachoRepo = require('../repositories/despachoRepo');
const canillaRepo = require('../repositories/canillaRepo');
const { setNfcSession, getNfcSession } = require('../config/redis');

const MAX_INT_SQL = 2147483647;

/**
 * Convierte id_canilla a entero positivo (acepta 3 o "3"). Devuelve null si no es válido.
 */
const parsearIdCanilla = (valor) => {
    const n = typeof valor === 'string' && /^\d+$/.test(valor.trim()) ? Number(valor) : valor;
    return Number.isInteger(n) && n > 0 && n <= MAX_INT_SQL ? n : null;
};

/**
 * Servicio de Negocio NFC
 */
class NfcService {
    async autenticarTarjeta(idTarjeta, idCanilla) {
        if (!idTarjeta || idCanilla === undefined) {
            const err = new Error("Faltan parámetros obligatorios: id_tarjeta e id_canilla son requeridos.");
            err.codigo = "MISSING_PARAMETERS";
            err.status = 400;
            throw err;
        }

        // Validación de la canilla ANTES de abrir la sesión en Redis: entero positivo, existe y está 'Activa'.
        const canillaId = parsearIdCanilla(idCanilla);
        if (canillaId === null) {
            const err = new Error("El número de canilla no es válido.");
            err.codigo = "INVALID_TAP";
            err.status = 400;
            throw err;
        }
        const canilla = await canillaRepo.findById(canillaId);
        if (!canilla) {
            const err = new Error(`La canilla ${canillaId} no existe.`);
            err.codigo = "TAP_NOT_FOUND";
            err.status = 404;
            throw err;
        }
        if (canilla.estado !== 'Activa') {
            const err = new Error(`La canilla ${canillaId} no está habilitada (Estado: ${canilla.estado}).`);
            err.codigo = "TAP_INACTIVE";
            err.status = 409;
            throw err;
        }

        const tarjeta = await tarjetaRepo.findById(idTarjeta);
        if (!tarjeta) {
            const err = new Error("La tarjeta NFC aproximada no se encuentra registrada en el sistema.");
            err.codigo = "CARD_NOT_FOUND";
            err.status = 404;
            throw err;
        }

        if (tarjeta.estado_tarjeta !== 'Activa') {
            const err = new Error(`La tarjeta NFC se encuentra inhabilitada (Estado: ${tarjeta.estado_tarjeta}).`);
            err.codigo = "CARD_INACTIVE";
            err.status = 403;
            throw err;
        }

        const saldoDisponible = Number(tarjeta.saldo_actual);
        if (saldoDisponible <= 0) {
            const err = new Error("Saldo insuficiente. Debe realizar una recarga antes de servirse.");
            err.codigo = "INSUFFICIENT_FUNDS";
            err.status = 402;
            throw err;
        }

        const ttlSegundos = 45;
        const clienteNombre = tarjeta.nombre 
            ? `${tarjeta.nombre} ${tarjeta.apellido}`.trim() 
            : 'Consumidor Final / Anónimo';

        const sessionPayload = {
            id_tarjeta: tarjeta.id_tarjeta,
            uid_tarjeta: tarjeta.id_tarjeta,
            id_cliente: tarjeta.id_cliente || null,
            cliente_nombre: clienteNombre,
            id_canilla: canillaId,
            saldo_disponible: saldoDisponible,
            iniciado_en: new Date().toISOString()
        };

        const guardada = await setNfcSession(idTarjeta, sessionPayload, ttlSegundos);
        if (!guardada) {
            const err = new Error("No pudimos habilitar el grifo en este momento. Intentá de nuevo en unos segundos.");
            err.codigo = "SESSION_UNAVAILABLE";
            err.status = 503;
            throw err;
        }

        return {
            ok: true,
            sesionValida: true,
            id_tarjeta: tarjeta.id_tarjeta,
            uid_tarjeta: tarjeta.id_tarjeta,
            id_cliente: tarjeta.id_cliente || null,
            cliente_nombre: clienteNombre,
            saldo_disponible: saldoDisponible,
            id_canilla: canillaId,
            ttl_segundos: ttlSegundos
        };
    }

    async consultarSesion(uid) {
        if (!uid) {
            const err = new Error("Identificador de tarjeta no provisto.");
            err.status = 400;
            throw err;
        }

        const sesion = await getNfcSession(uid);
        if (!sesion) {
            const err = new Error("No existe sesión activa para esta tarjeta (expiró o no fue aproximada).");
            err.codigo = "SESSION_EXPIRED";
            err.status = 404;
            throw err;
        }

        return { ok: true, activa: true, sesion };
    }

    async getTarjetas() {
        return tarjetaRepo.findAll();
    }

    async getFormatosYPrecios(idCanilla) {
        return despachoRepo.getFormatosYPreciosPorCanilla(idCanilla);
    }
}

module.exports = new NfcService();
