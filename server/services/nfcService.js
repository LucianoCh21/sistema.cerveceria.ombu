const tarjetaRepo = require('../repositories/tarjetaRepo');
const despachoRepo = require('../repositories/despachoRepo');
const { setNfcSession, getNfcSession } = require('../config/redis');

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
            id_canilla: Number(idCanilla),
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
            id_canilla: Number(idCanilla),
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
