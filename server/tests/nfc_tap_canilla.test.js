// Unitarias con dobles (patrón AAA): el tap NFC valida id_canilla en el servidor
// (entero positivo, existe, 'Activa') ANTES de abrir la sesión de 45 s en Redis.
const test = require('node:test');
const assert = require('node:assert/strict');

let estado;
const install = (path, exports) => {
    const id = require.resolve(path);
    require.cache[id] = { id, filename: id, loaded: true, exports };
};
// Base falsa: responde según la tabla consultada.
const CANILLAS = { 1: 'Activa', 8: 'Inactiva', 9: 'Mantenimiento' };
const fakePool = {
    request: () => {
        const params = {};
        const req = {
            input: (nombre, _tipo, valor) => { params[nombre] = valor; return req; },
            query: async (texto) => {
                if (/FROM TarjetaNFC/.test(texto)) {
                    return { recordset: [{ id_tarjeta: 'A1B2C3D4E5', saldo_actual: 6500, estado_tarjeta: 'Activa', id_cliente: 1, nombre: 'Juan', apellido: 'Pérez' }] };
                }
                if (/FROM Canilla/.test(texto)) {
                    const e = CANILLAS[params.id_canilla];
                    return { recordset: e ? [{ id_canilla: params.id_canilla, estado: e }] : [] };
                }
                return { recordset: [] };
            }
        };
        return req;
    }
};
install('../config/db', { getConnection: async () => fakePool, sql: { Int: 'Int', VarChar: () => 'VarChar' } });
install('../config/redis', {
    setNfcSession: async (uid, payload) => { estado.sesiones.push(payload); return true; },
    getNfcSession: async () => null
});
const nfcService = require('../services/nfcService');

const tapear = async (idCanilla) => {
    try {
        return { ok: await nfcService.autenticarTarjeta('A1B2C3D4E5', idCanilla) };
    } catch (err) {
        return { err };
    }
};

test.beforeEach(() => {
    estado = { sesiones: [] };
});

for (const [valor, desc] of [['abc', 'texto'], [-3, 'negativo'], [0, 'cero'], [2.5, 'decimal'], [null, 'null'], [true, 'booleano']]) {
    test(`id_canilla ${desc} (${JSON.stringify(valor)}): 400 INVALID_TAP y sin sesión`, async () => {
        // Arrange: tarjeta válida, canilla inválida
        // Act
        const r = await tapear(valor);
        // Assert
        assert.equal(r.err?.status, 400);
        assert.equal(r.err.codigo, 'INVALID_TAP');
        assert.equal(estado.sesiones.length, 0);
    });
}

test('canilla inexistente (11): 404 TAP_NOT_FOUND y sin sesión', async () => {
    // Arrange: la canilla 11 no está en la base
    // Act
    const r = await tapear(11);
    // Assert
    assert.equal(r.err?.status, 404);
    assert.equal(r.err.codigo, 'TAP_NOT_FOUND');
    assert.equal(estado.sesiones.length, 0);
});

test('canilla Inactiva (8) o en Mantenimiento (9): 409 TAP_INACTIVE y sin sesión', async () => {
    // Arrange: canillas existentes pero no habilitadas
    // Act
    const r8 = await tapear(8);
    const r9 = await tapear('9');
    // Assert
    assert.equal(r8.err?.status, 409);
    assert.equal(r8.err.codigo, 'TAP_INACTIVE');
    assert.match(r9.err.message, /Mantenimiento/);
    assert.equal(estado.sesiones.length, 0);
});

test('canilla Activa como texto ("1"): abre la sesión con id_canilla numérico', async () => {
    // Arrange: canilla 1 Activa
    // Act
    const r = await tapear('1');
    // Assert
    assert.equal(r.ok?.sesionValida, true);
    assert.equal(r.ok.id_canilla, 1);
    assert.equal(estado.sesiones.length, 1);
    assert.equal(estado.sesiones[0].id_canilla, 1);
});
