const Redis = require('ioredis');
require('dotenv').config();

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
const redisPassword = process.env.REDIS_PASSWORD || undefined;

let redisClient = null;

const getRedisClient = () => {
    if (!redisClient) {
        redisClient = new Redis({
            host: redisHost,
            port: redisPort,
            password: redisPassword,
            retryStrategy(times) {
                // Estrategia de reconexión exponencial con tope de 3 segundos
                const delay = Math.min(times * 100, 3000);
                return delay;
            },
            lazyConnect: true,
            maxRetriesPerRequest: 3
        });

        redisClient.on('connect', () => {
            console.log(`[Redis] Conectado exitosamente en ${redisHost}:${redisPort}`);
        });

        redisClient.on('error', (err) => {
            console.warn(`[Redis] Advertencia de conexión: ${err.message}`);
        });
    }
    return redisClient;
};

/**
 * Guarda una sesión efímera de grifo para una tarjeta NFC con TTL estricto.
 * @param {string} uid - Identificador hexadecimal de la tarjeta NFC.
 * @param {object} sessionData - Datos de la sesión { id_tarjeta, id_canilla, saldo, id_cliente }.
 * @param {number} ttlSeconds - Tiempo de expiración (por defecto 45 segundos según RN-02).
 */
const setNfcSession = async (uid, sessionData, ttlSeconds = 45) => {
    try {
        const client = getRedisClient();
        if (client.status !== 'ready' && client.status !== 'connecting') {
            await client.connect().catch(() => {});
        }
        const key = `nfc:sesion:${uid}`;
        await client.set(key, JSON.stringify(sessionData), 'EX', ttlSeconds);
        return true;
    } catch (error) {
        console.error(`[Redis] Error al guardar sesión NFC para ${uid}:`, error.message);
        return false;
    }
};

/**
 * Recupera la sesión efímera activa de una tarjeta.
 */
const getNfcSession = async (uid) => {
    try {
        const client = getRedisClient();
        if (client.status !== 'ready' && client.status !== 'connecting') {
            await client.connect().catch(() => {});
        }
        const key = `nfc:sesion:${uid}`;
        const data = await client.get(key);
        return data ? JSON.parse(data) : null;
    } catch (error) {
        console.error(`[Redis] Error al consultar sesión NFC para ${uid}:`, error.message);
        return null;
    }
};

/**
 * Elimina la sesión efímera una vez completado el despacho.
 */
const deleteNfcSession = async (uid) => {
    try {
        const client = getRedisClient();
        if (client.status !== 'ready' && client.status !== 'connecting') {
            await client.connect().catch(() => {});
        }
        const key = `nfc:sesion:${uid}`;
        await client.del(key);
        return true;
    } catch (error) {
        console.error(`[Redis] Error al borrar sesión NFC para ${uid}:`, error.message);
        return false;
    }
};

/**
 * Control de Idempotencia: almacena el resultado de una operación para una clave única.
 */
const setIdempotencyResult = async (idempotencyKey, responseData, ttlSeconds = 300) => {
    try {
        const client = getRedisClient();
        if (client.status !== 'ready' && client.status !== 'connecting') {
            await client.connect().catch(() => {});
        }
        const key = `idempotency:${idempotencyKey}`;
        await client.set(key, JSON.stringify(responseData), 'EX', ttlSeconds);
        return true;
    } catch (error) {
        console.error(`[Redis] Error guardando idempotencia para ${idempotencyKey}:`, error.message);
        return false;
    }
};

const getIdempotencyResult = async (idempotencyKey) => {
    try {
        const client = getRedisClient();
        if (client.status !== 'ready' && client.status !== 'connecting') {
            await client.connect().catch(() => {});
        }
        const key = `idempotency:${idempotencyKey}`;
        const data = await client.get(key);
        return data ? JSON.parse(data) : null;
    } catch (error) {
        console.error(`[Redis] Error consultando idempotencia para ${idempotencyKey}:`, error.message);
        return null;
    }
};

module.exports = {
    getRedisClient,
    setNfcSession,
    getNfcSession,
    deleteNfcSession,
    setIdempotencyResult,
    getIdempotencyResult
};
