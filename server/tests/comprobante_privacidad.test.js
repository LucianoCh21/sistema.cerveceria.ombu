// Unitarias con doble de pdfkit (patrón AAA): el comprobante no expone el UID
// completo de la tarjeta ni el saldo (RNF-23, Padlet 3).
const test = require('node:test');
const assert = require('node:assert/strict');

const textos = [];
const id = require.resolve('pdfkit');
require.cache[id] = {
    id, filename: id, loaded: true,
    exports: class FakePDF {
        fontSize() { return this; }
        font() { return this; }
        moveDown() { return this; }
        text(t) { textos.push(String(t)); return this; }
        pipe() { return this; }
        end() {}
    }
};
const comprobanteService = require('../services/comprobanteService');
const { enmascararTarjeta } = comprobanteService;

const despacho = {
    id_despacho: 42, fecha_hora: '2026-11-09T18:00:00.000Z',
    cliente_nombre: 'Ana', cliente_apellido: 'Pérez',
    id_tarjeta: 'A1B2C3D4E5', saldo_actual: 4550,
    id_canilla: 1, cerveza_nombre: 'Caravana IPA', formato_nombre: 'Media Pinta',
    mililitros_servidos: 250, precio_cobrado: 1950
};
const fakeRes = () => ({ setHeader() {} });

test('enmascararTarjeta deja visibles sólo los últimos 4 caracteres', () => {
    // Arrange / Act / Assert
    assert.equal(enmascararTarjeta('A1B2C3D4E5'), '******D4E5');
    assert.equal(enmascararTarjeta('E5'), '****');
    assert.equal(enmascararTarjeta(null), '****');
});

test('el PDF no contiene el UID completo ni el saldo de la tarjeta', () => {
    // Arrange
    textos.length = 0;
    // Act
    comprobanteService.generarTicketPdf(despacho, fakeRes());
    const contenido = textos.join('\n');
    // Assert
    assert.ok(contenido.includes('Tarjeta NFC: ******D4E5'));
    assert.ok(!contenido.includes('A1B2C3D4E5'), 'No debe aparecer el UID completo');
    assert.ok(!/saldo/i.test(contenido), 'No debe imprimir el saldo');
    assert.ok(!contenido.includes('4550'), 'No debe aparecer el monto del saldo');
    assert.ok(contenido.includes('IMPORTE COBRADO: $1950.00'));
});
