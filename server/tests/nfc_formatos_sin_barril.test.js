// Unitarias con dobles (patrón AAA): GET /api/nfc/formatos en una canilla sin barril
// no lista los precios de todas las cervezas; responde lista vacía con bandera explícita.
const test = require('node:test');
const assert = require('node:assert/strict');

const install = (path, exports) => {
    const id = require.resolve(path);
    require.cache[id] = { id, filename: id, loaded: true, exports };
};
// Base falsa: canilla 1 con Caravana IPA (id_cerveza 1), canilla 8 sin barril, 11 no existe.
const CANILLAS = { 1: { id_cerveza: 1, nombre_cerveza: 'Caravana IPA' }, 8: { id_cerveza: null, nombre_cerveza: null } };
const PRECIOS = [
    { id: 1, nombre: 'Media Pinta', ml: 250, precio: 1950, icon: 'x', id_cerveza: 1 },
    { id: 1, nombre: 'Media Pinta', ml: 250, precio: 2200, icon: 'x', id_cerveza: 2 }
];
const fakePool = {
    request: () => {
        const params = {};
        const req = {
            input: (nombre, _tipo, valor) => { params[nombre] = valor; return req; },
            query: async (texto) => {
                if (/FROM Canilla c/.test(texto)) {
                    const c = CANILLAS[params.id_canilla];
                    return { recordset: c ? [c] : [] };
                }
                if (/FROM FormatoServicio/.test(texto)) {
                    return { recordset: params.id_cerveza ? PRECIOS.filter(p => p.id_cerveza === params.id_cerveza) : PRECIOS };
                }
                return { recordset: [] };
            }
        };
        return req;
    }
};
install('../config/db', { getConnection: async () => fakePool, sql: { Int: 'Int', VarChar: () => 'VarChar', BigInt: 'BigInt', Decimal: () => 'Decimal' } });
install('../config/redis', { setNfcSession: async () => true, getNfcSession: async () => null });
const { getFormatosYPrecios } = require('../controllers/nfcController');

const pedir = async (id_canilla) => {
    const res = { statusCode: null, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    await getFormatosYPrecios({ query: id_canilla === undefined ? {} : { id_canilla } }, res);
    return res;
};

test('canilla sin barril (8): 200, sin_barril y lista vacía', async () => {
    // Arrange: la canilla 8 existe pero no tiene barril conectado
    // Act
    const res = await pedir('8');
    // Assert
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.sin_barril, true);
    assert.equal(res.body.codigo, 'NO_ACTIVE_BARREL');
    assert.deepEqual(res.body.formatos, []);
});

test('canilla inexistente (11): 404 TAP_NOT_FOUND', async () => {
    // Arrange / Act
    const res = await pedir('11');
    // Assert
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.codigo, 'TAP_NOT_FOUND');
});

test('id_canilla inválido ("abc"): 400 INVALID_TAP', async () => {
    // Arrange / Act
    const res = await pedir('abc');
    // Assert
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.codigo, 'INVALID_TAP');
});

test('canilla con barril (1): solo los precios de su cerveza', async () => {
    // Arrange / Act
    const res = await pedir('1');
    // Assert
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.cerveza, 'Caravana IPA');
    assert.equal(res.body.sin_barril, undefined);
    assert.deepEqual(res.body.formatos.map(f => f.precio), [1950]);
});
