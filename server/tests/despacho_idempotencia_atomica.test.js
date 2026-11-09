// Unitarias con dobles (patrón AAA) del Padlet 1: reserva atómica de la Idempotency-Key
// (SET NX EX) y consumo atómico de la sesión NFC (GETDEL) en despachoService.
const test = require('node:test');
const assert = require('node:assert/strict');

let estado;
const install = (path, exports) => {
    const id = require.resolve(path);
    require.cache[id] = { id, filename: id, loaded: true, exports };
};
// Redis en memoria: como JavaScript es monohilo, SET NX y GETDEL son atómicos igual que en Redis.
install('../config/redis', {
    reservarIdempotencia: async (key) => {
        if (estado.redisCaido) throw new Error('Redis caído');
        const actual = estado.redis.get(`idempotency:${key}`);
        if (actual === undefined) { estado.redis.set(`idempotency:${key}`, 'en_proceso'); return { reservada: true }; }
        if (actual === 'en_proceso') return { reservada: false, enProceso: true };
        return { reservada: false, resultado: JSON.parse(actual) };
    },
    liberarIdempotencia: async (key) => { estado.redis.delete(`idempotency:${key}`); },
    setIdempotencyResult: async (key, data) => { estado.redis.set(`idempotency:${key}`, JSON.stringify(data)); return true; },
    getNfcSession: async (uid) => {
        const s = estado.redis.get(`nfc:sesion:${uid}`);
        return s ? JSON.parse(s) : null;
    },
    consumirNfcSession: async (uid) => {
        const s = estado.redis.get(`nfc:sesion:${uid}`);
        estado.redis.delete(`nfc:sesion:${uid}`);
        return s ? JSON.parse(s) : null;
    }
});
install('../config/db', {
    getConnection: async () => ({}),
    sql: { Transaction: class {
        async begin() {}
        async commit() { estado.commits++; }
        async rollback() {}
    } }
});
install('../repositories/tarjetaRepo', {
    debitarSaldo: async (tx, idTarjeta, monto) => {
        estado.debitos++;
        if (estado.saldo < monto) return null;
        estado.saldo -= monto;
        return { id_tarjeta: idTarjeta, saldo_actual: estado.saldo, id_cliente: 1 };
    }
});
install('../repositories/despachoRepo', {
    getBarrilActivoPorCanilla: async () => {
        // Cede el event loop para que las solicitudes concurrentes se intercalen de verdad.
        await new Promise(r => setImmediate(r));
        return { id_barril: 1, id_cerveza: 1, litros_restantes: 40, nombre_cerveza: 'IPA' };
    },
    getPrecioYFormatoVigente: async () => ({ nombre: 'Media Pinta', mililitros: 250, precio: 1950 }),
    descontarLitrosBarril: async () => {},
    insertarDespacho: async () => ({ id_despacho: ++estado.ultimoId, fecha_hora: new Date('2026-11-09T18:00:00.000Z') }),
    insertarOutbox: async () => {}
});
const despachoService = require('../services/despachoService');

const abrirSesion = () => estado.redis.set('nfc:sesion:A1B2C3D4E5', JSON.stringify({ id_canilla: 1, cliente_nombre: 'Ana' }));
const pedido = (idempotencyKey) => ({ idempotencyKey, idTarjeta: 'A1B2C3D4E5', idCanilla: 1, idFormato: 1 });

test.beforeEach(() => {
    estado = { redis: new Map(), saldo: 6500, debitos: 0, commits: 0, ultimoId: 100, redisCaido: false };
});

test('dos solicitudes simultáneas con la misma Idempotency-Key cobran una sola vez', async () => {
    // Arrange
    abrirSesion();
    // Act
    const resultados = await Promise.allSettled([
        despachoService.procesarDespacho(pedido('k-doble-click')),
        despachoService.procesarDespacho(pedido('k-doble-click'))
    ]);
    // Assert
    const ok = resultados.filter(r => r.status === 'fulfilled');
    const rechazos = resultados.filter(r => r.status === 'rejected');
    assert.equal(ok.length, 1);
    assert.equal(rechazos[0].reason.codigo, 'IDEMPOTENCY_IN_PROGRESS');
    assert.equal(rechazos[0].reason.status, 409);
    assert.equal(estado.debitos, 1);
    assert.equal(estado.saldo, 6500 - 1950);
});

test('reintento posterior con la misma clave devuelve la respuesta previa sin volver a cobrar', async () => {
    // Arrange
    abrirSesion();
    const primera = await despachoService.procesarDespacho(pedido('k-reintento'));
    // Act
    const segunda = await despachoService.procesarDespacho(pedido('k-reintento'));
    // Assert
    assert.equal(segunda.idempotencia_aplicada, true);
    assert.equal(segunda.id_despacho, primera.id_despacho);
    assert.equal(estado.debitos, 1);
});

test('un tap habilita un solo servido aunque lleguen dos claves distintas (GETDEL)', async () => {
    // Arrange
    abrirSesion();
    // Act
    const resultados = await Promise.allSettled([
        despachoService.procesarDespacho(pedido('k-a')),
        despachoService.procesarDespacho(pedido('k-b'))
    ]);
    // Assert
    const rechazos = resultados.filter(r => r.status === 'rejected');
    assert.equal(rechazos.length, 1);
    assert.equal(rechazos[0].reason.codigo, 'SESSION_ALREADY_USED');
    assert.equal(estado.debitos, 1);
});

test('si falla antes del commit se libera la clave para poder reintentar', async () => {
    // Arrange: saldo insuficiente → el débito atómico no afecta filas
    abrirSesion();
    estado.saldo = 100;
    // Act
    await assert.rejects(despachoService.procesarDespacho(pedido('k-sin-saldo')), { codigo: 'INSUFFICIENT_FUNDS' });
    // Assert
    assert.equal(estado.redis.has('idempotency:k-sin-saldo'), false);
    assert.equal(estado.commits, 0);
});

test('con Redis caído el despacho se rechaza (falla cerrada) y no se cobra', async () => {
    // Arrange
    abrirSesion();
    estado.redisCaido = true;
    // Act / Assert
    await assert.rejects(despachoService.procesarDespacho(pedido('k-redis')), { codigo: 'IDEMPOTENCY_UNAVAILABLE', status: 503 });
    assert.equal(estado.debitos, 0);
});
