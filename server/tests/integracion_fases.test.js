const test = require('node:test');
const assert = require('node:assert/strict');
const { getRedisClient } = require('../config/redis');
const despachoService = require('../services/despachoService');
const nfcService = require('../services/nfcService');

test.after(async () => {
    try {
        const redis = getRedisClient();
        await redis.quit();
    } catch (e) {
        // Ignorar si no estaba conectado
    }
});

test('Fase 5 (F-18) - Pruebas de Integración y Reglas de Negocio Despachos/NFC', async (t) => {

    await t.test('F-02: Debe rechazar despacho si no se envía un id_formato válido entero', async () => {
        await assert.rejects(
            async () => {
                await despachoService.procesarDespacho({
                    idempotencyKey: 'idem-test-f02-1',
                    idTarjeta: 'TARJETA01',
                    idCanilla: 1,
                    idFormato: 'invalido'
                });
            },
            (err) => {
                assert.equal(err.codigo, 'INVALID_FORMAT');
                assert.equal(err.status, 400);
                return true;
            }
        );
    });

    await t.test('F-02: Debe rechazar despacho si falta idempotencyKey', async () => {
        await assert.rejects(
            async () => {
                await despachoService.procesarDespacho({
                    idTarjeta: 'TARJETA01',
                    idCanilla: 1,
                    idFormato: 2
                });
            },
            (err) => {
                assert.equal(err.codigo, 'MISSING_IDEMPOTENCY_KEY');
                assert.equal(err.status, 400);
                return true;
            }
        );
    });

    await t.test('F-03: Debe rechazar si la tarjeta no tiene sesión activa en Redis', async () => {
        await assert.rejects(
            async () => {
                await despachoService.procesarDespacho({
                    idempotencyKey: 'idem-test-f03-nosession',
                    idTarjeta: 'TARJETA_INEXISTENTE_99',
                    idCanilla: 1,
                    idFormato: 2
                });
            },
            (err) => {
                assert.equal(err.codigo, 'SESSION_EXPIRED');
                assert.equal(err.status, 403);
                return true;
            }
        );
    });

    await t.test('F-03: Debe rechazar autenticación NFC si faltan parámetros obligatorios', async () => {
        await assert.rejects(
            async () => {
                await nfcService.autenticarTarjeta(null, 1);
            },
            (err) => {
                assert.equal(err.codigo, 'MISSING_PARAMETERS');
                assert.equal(err.status, 400);
                return true;
            }
        );
    });
});
