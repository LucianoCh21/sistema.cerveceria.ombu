const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { mililitrosALitros } = require('../domain/volumen');

// Los dobles se instalan antes de cargar el servicio (CommonJS captura imports).
// Cada archivo node:test se ejecuta en un proceso separado.
let estado;
const install = (path, exports) => {
    const id = require.resolve(path);
    require.cache[id] = { id, filename: id, loaded: true, exports };
};
install('../config/db', {
    getConnection: async () => { estado.conexiones++; return {}; },
    sql: { Transaction: class {
        async begin() { estado.begin++; }
        async commit() { estado.commit++; }
        async rollback() { estado.rollback++; }
    } }
});
install('../config/redis', {
    getIdempotencyResult: async () => { estado.redis++; return null; },
    getNfcSession: async () => { estado.redis++; return { id_canilla: 1, cliente_nombre: 'Cliente de prueba' }; },
    deleteNfcSession: async () => { estado.sesionEliminada = true; return true; },
    setIdempotencyResult: async (key, data, ttl) => { estado.cache = { key, data, ttl }; return true; }
});
install('../repositories/tarjetaRepo', {
    debitarSaldo: async (tx, tarjeta, importe) => {
        estado.saldo -= importe;
        return { id_tarjeta: tarjeta, saldo_actual: estado.saldo, id_cliente: 4 };
    }
});
install('../repositories/despachoRepo', {
    getBarrilActivoPorCanilla: async () => ({ id_barril: 3, id_cerveza: 1, litros_restantes: estado.litros, nombre_cerveza: 'IPA' }),
    getPrecioYFormatoVigente: async () => ({ nombre: 'Pinta', mililitros: 500, precio: 3500 }),
    descontarLitrosBarril: async (tx, id, litros) => { estado.litros -= litros; },
    insertarDespacho: async (tx, datos) => {
        estado.despachos.push(datos);
        return { id_despacho: 120, fecha_hora: new Date('2026-10-14T15:00:00.000Z') };
    },
    insertarOutbox: async (tx, tipo, payload) => { estado.outbox.push({ tipo, payload }); }
});
const express = require('express');
const routes = require('../routes/despachoRoutes');

const schema = {
    ok: 'boolean', id_despacho: 'integer', id_canilla: 'integer', id_barril: 'integer',
    cerveza: 'string', formato: 'string', volumen_litros: 'number', importe_cobrado: 'number',
    saldo_restante: 'number', comprobante_url: 'string', evento_outbox_registrado: 'boolean', fecha_hora: 'date-time'
};
function validarContrato(body) {
    // Proyección explícita de DespachoResponse (docs/openapi.yaml).
    // Se exige presencia y tipo; OpenAPI admite propiedades adicionales.
    for (const [key, type] of Object.entries(schema)) {
        assert.ok(Object.hasOwn(body, key), `Falta ${key}`);
        if (type === 'integer') assert.ok(Number.isInteger(body[key]), key);
        else if (type === 'date-time') {
            assert.equal(typeof body[key], 'string');
            assert.match(body[key], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            assert.ok(Number.isFinite(Date.parse(body[key])));
        } else {
            assert.equal(typeof body[key], type, key);
            if (type === 'number') assert.ok(Number.isFinite(body[key]));
        }
    }
}
async function post(t, body) {
    const previous = process.env.TERMINAL_TOKEN;
    process.env.TERMINAL_TOKEN = 'u4-terminal-test';
    const app = express();
    app.use(express.json());
    app.use('/api/despachos', routes);
    const server = app.listen(0, '127.0.0.1');
    t.after(async () => {
        await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
        if (previous === undefined) delete process.env.TERMINAL_TOKEN;
        else process.env.TERMINAL_TOKEN = previous;
    });
    await once(server, 'listening');
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/despachos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer u4-terminal-test', 'Idempotency-Key': 'u4-despacho-001' },
        body: JSON.stringify(body)
    });
    assert.match(response.headers.get('content-type'), /application\/json/);
    return { status: response.status, body: await response.json() };
}
test.beforeEach(() => {
    estado = { saldo: 4500, litros: 20, conexiones: 0, redis: 0, begin: 0, commit: 0, rollback: 0, despachos: [], outbox: [] };
});

test('U4 - unitario puro: 500 ml se convierten en 0.5 litros para descontar stock', () => {
    // Arrange
    const mililitros = 500;
    // Act
    const litros = mililitrosALitros(mililitros);
    // Assert
    assert.equal(litros, 0.5);
    assert.equal(estado.conexiones, 0);
    assert.equal(estado.redis, 0);
});

test('U4 - integración HTTP: despacho válido devuelve 201 y contrato JSON', async (t) => {
    // Arrange: precio y volumen oficiales provienen del repositorio doble.
    const payload = { id_tarjeta: 'U4-TARJETA', id_canilla: 1, id_formato: 2 };
    // Act: petición HTTP real a las capas de producción.
    const result = await post(t, payload);
    // Assert: contrato y efectos observables en los dobles.
    assert.equal(result.status, 201);
    validarContrato(result.body);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.id_despacho, 120);
    assert.equal(result.body.volumen_litros, 0.5);
    assert.equal(result.body.importe_cobrado, 3500);
    assert.equal(result.body.saldo_restante, 1000);
    assert.equal(result.body.evento_outbox_registrado, true);
    assert.equal(result.body.comprobante_url, '/api/despachos/120/comprobante');
    assert.equal(estado.saldo, 1000);
    assert.equal(estado.litros, 19.5);
    assert.equal(estado.despachos.length, 1);
    assert.equal(estado.outbox.length, 1);
    assert.equal(estado.outbox[0].tipo, 'DespachoRealizado');
    assert.equal(estado.outbox[0].payload.data.volumenLitros, 0.5);
    assert.equal(estado.begin, 1);
    assert.equal(estado.commit, 1);
    assert.equal(estado.rollback, 0);
    assert.equal(estado.sesionEliminada, true);
    assert.equal(estado.cache.ttl, 300);
});

test('U4 - borde HTTP: formato corrupto devuelve 400 y no genera cobro', async (t) => {
    // Arrange: resto del payload y autenticación válidos.
    const payload = { id_tarjeta: 'U4-TARJETA', id_canilla: 1, id_formato: 'invalido' };
    // Act
    const result = await post(t, payload);
    // Assert: 400 exacto descarta 500; rechazo antes de SQL y Redis.
    assert.equal(result.status, 400);
    assert.deepEqual(Object.keys(result.body).sort(), ['codigo', 'error', 'ok']);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.codigo, 'INVALID_FORMAT');
    assert.equal(typeof result.body.error, 'string');
    assert.ok(result.body.error.length > 0);
    assert.equal(estado.conexiones, 0);
    assert.equal(estado.redis, 0);
    assert.equal(estado.begin, 0);
    assert.equal(estado.commit, 0);
    assert.equal(estado.saldo, 4500);
    assert.equal(estado.litros, 20);
    assert.equal(estado.despachos.length, 0);
    assert.equal(estado.outbox.length, 0);
});
