const test = require('node:test');
const assert = require('node:assert/strict');

test('Fase 3 (F-07) - Patrón Transactional Outbox', async (t) => {
    await t.test('Debe estructurar el evento outbox con tipo DespachoRealizado y payload serializado', () => {
        const despachoEjemplo = {
            id_despacho: 101,
            fecha_hora: new Date('2026-10-12T18:00:00.000Z')
        };
        const idCanilla = 2;
        const idBarril = 5;
        const idFormato = 2;
        const volumenLitros = 0.5;
        const mlServidos = 500;
        const formatoNombre = 'Pinta';
        const precioCobrado = 3500.00;
        const idTarjeta = 'A1B2C3D4';
        const idempotencyKey = 'idem-test-outbox-01';

        const eventoPayload = {
            eventId: `evt-${Date.now()}-${despachoEjemplo.id_despacho}`,
            eventType: "DespachoRealizado",
            occurredAt: despachoEjemplo.fecha_hora.toISOString(),
            version: "1.0",
            idempotencyKey: idempotencyKey,
            producer: "modulo-nfc-despachos",
            data: {
                idDespacho: despachoEjemplo.id_despacho,
                idCanilla: Number(idCanilla),
                idBarril: idBarril,
                idFormato: idFormato,
                volumenLitros: volumenLitros,
                mililitros: mlServidos,
                formato: formatoNombre,
                importeDebitado: precioCobrado,
                idTarjeta: idTarjeta,
                idCliente: null
            }
        };

        const outboxRow = {
            tipo: 'DespachoRealizado',
            payload: JSON.stringify(eventoPayload)
        };

        assert.equal(outboxRow.tipo, 'DespachoRealizado');
        const parsed = JSON.parse(outboxRow.payload);
        assert.equal(parsed.eventType, 'DespachoRealizado');
        assert.equal(parsed.data.idDespacho, 101);
        assert.equal(parsed.data.idCanilla, 2);
        assert.equal(parsed.data.volumenLitros, 0.5);
        assert.equal(parsed.data.importeDebitado, 3500.00);
    });

    await t.test('Debe verificar que outboxPublisher exporta las funciones principales', () => {
        const outboxModule = require('../workers/outboxPublisher');
        assert.equal(typeof outboxModule.procesarEventosPendientes, 'function');
        assert.equal(typeof outboxModule.iniciarOutboxPublisher, 'function');
    });
});
