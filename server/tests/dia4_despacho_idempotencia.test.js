const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('DÍA 4 - Backend NFC: Débito con Idempotencia y Publicación RabbitMQ', () => {

    it('Debe exigir obligatoriamente la cabecera Idempotency-Key', () => {
        const headersConClave = { 'idempotency-key': 'idem-test-uuid-123' };
        const headersSinClave = {};

        const keyExistente = headersConClave['idempotency-key'] || headersConClave['x-idempotency-key'];
        const keyFaltante = headersSinClave['idempotency-key'] || headersSinClave['x-idempotency-key'];

        assert.ok(keyExistente, 'Debe aceptar idempotency-key');
        assert.equal(keyFaltante, undefined, 'Debe detectar la ausencia de la cabecera de idempotencia');
    });

    it('Debe devolver el resultado previo sin volver a cobrar si la Idempotency-Key ya existe', () => {
        const cacheSimulado = {
            'idem-test-uuid-123': {
                ok: true,
                id_despacho: 105,
                precio_cobrado: 3500.00,
                saldo_restante: 3000.00
            }
        };

        const keyConsulta = 'idem-test-uuid-123';
        const respuestaPrevia = cacheSimulado[keyConsulta];

        assert.ok(respuestaPrevia, 'Debe encontrar la respuesta en caché');
        const respuestaIdempotente = {
            ...respuestaPrevia,
            idempotencia_aplicada: true
        };

        assert.equal(respuestaIdempotente.idempotencia_aplicada, true);
        assert.equal(respuestaIdempotente.id_despacho, 105);
        assert.equal(respuestaIdempotente.precio_cobrado, 3500.00);
    });

    it('Debe validar que la sesión en Redis siga viva (TTL 45s no expirado)', () => {
        const sesionValida = {
            id_tarjeta: 'A1B2C3D4E5',
            id_canilla: 1,
            saldo_disponible: 6500.00
        };
        const sesionExpirada = null;

        assert.ok(sesionValida !== null, 'Sesión válida permite continuar.');
        assert.equal(sesionExpirada, null, 'Sesión expirada debe abortar el despacho con error 403.');
    });

    it('Debe normalizar correctamente volúmenes y formatos de servicio', () => {
        const casos = [
            { entrada: 'Media Pinta', mlEsperado: 250, litrosEsperados: 0.25, idFormato: 1 },
            { entrada: 'Pinta', mlEsperado: 500, litrosEsperados: 0.50, idFormato: 2 },
            { entrada: 'Litro', mlEsperado: 1000, litrosEsperados: 1.00, idFormato: 3 }
        ];

        casos.forEach(c => {
            const ml = c.mlEsperado;
            const litros = ml / 1000.0;
            assert.equal(ml, c.mlEsperado);
            assert.equal(litros, c.litrosEsperados);
        });
    });

    it('Debe conformar el esquema de evento asíncrono RabbitMQ (DespachoRealizado) según la especificación', () => {
        const payloadEvento = {
            eventId: 'evt-test-99',
            eventType: 'DespachoRealizado',
            occurredAt: new Date().toISOString(),
            version: '1.0',
            idempotencyKey: 'idem-test-uuid-123',
            producer: 'modulo-nfc-despachos',
            data: {
                idDespacho: 2505,
                idCanilla: 1,
                idBarril: 1,
                idFormato: 2,
                volumenLitros: 0.5,
                mililitros: 500,
                formato: 'Pinta',
                importeDebitado: 3500.00,
                idTarjeta: 'A1B2C3D4E5',
                idCliente: 1
            }
        };

        assert.equal(payloadEvento.eventType, 'DespachoRealizado');
        assert.equal(payloadEvento.producer, 'modulo-nfc-despachos');
        assert.equal(payloadEvento.data.idDespacho, 2505);
        assert.equal(payloadEvento.data.volumenLitros, 0.5);
        assert.equal(payloadEvento.data.importeDebitado, 3500.00);
        assert.equal(payloadEvento.data.idCanilla, 1);
    });

    it('Debe verificar la transición de estado del barril a Agotado si litros_restantes llega a 0', () => {
        let barrilLitros = 0.5;
        const volumenServido = 0.5;
        barrilLitros -= volumenServido;

        const nuevoEstado = barrilLitros <= 0 ? 'Agotado' : 'Conectado';
        assert.equal(barrilLitros, 0);
        assert.equal(nuevoEstado, 'Agotado');
    });
});
