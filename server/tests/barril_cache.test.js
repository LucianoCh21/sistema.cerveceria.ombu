// Unitarias con dobles (patrón AAA): conectar/retirar barril invalidan la caché
// del resumen de stock sólo después de confirmar el cambio en la base.
const test = require('node:test');
const assert = require('node:assert/strict');

let estado;
const install = (path, exports) => {
    const id = require.resolve(path);
    require.cache[id] = { id, filename: id, loaded: true, exports };
};
// Request falso de mssql: devuelve en orden los resultados encolados en estado.resultados.
const fakeRequest = () => {
    const req = {
        input: () => req,
        query: async () => {
            estado.queries++;
            return estado.resultados.shift() || { recordset: [], rowsAffected: [1] };
        }
    };
    return req;
};
install('../config/db', {
    getConnection: async () => ({ request: fakeRequest }),
    sql: {
        Int: 'Int',
        ISOLATION_LEVEL: { SERIALIZABLE: 'SERIALIZABLE' },
        Transaction: class {
            async begin() { this.isActive = true; }
            request() { return fakeRequest(); }
            async commit() { estado.eventos.push('commit'); this.isActive = false; }
            async rollback() { estado.eventos.push('rollback'); this.isActive = false; }
        }
    }
});
install('../config/redis', {
    getRedisClient: () => ({
        del: async (key) => {
            if (estado.redisCaido) throw new Error('Redis caído');
            estado.eventos.push(`del:${key}`);
        }
    })
});
const { conectarBarril, retirarBarril } = require('../controllers/barrilController');

const fakeRes = () => {
    const res = { statusCode: null, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    res.send = () => res;
    return res;
};

test.beforeEach(() => {
    estado = { resultados: [], eventos: [], queries: 0, redisCaido: false };
});

test('conectar barril: invalida stock:muro:resumen después del commit', async () => {
    // Arrange: canilla libre y UPDATE que afecta 1 fila
    estado.resultados = [{ recordset: [] }, { rowsAffected: [1] }];
    const req = { body: { id_barril: 2, id_canilla: 8, id_empleado_conexion: 1 } };
    const res = fakeRes();
    // Act
    await conectarBarril(req, res);
    // Assert
    assert.equal(res.statusCode, 200);
    assert.deepEqual(estado.eventos, ['commit', 'del:stock:muro:resumen']);
});

test('conectar barril: si la canilla está ocupada no toca la caché', async () => {
    // Arrange: ya hay un barril conectado en la canilla
    estado.resultados = [{ recordset: [{ id_barril: 1 }] }];
    const res = fakeRes();
    // Act
    await conectarBarril({ body: { id_barril: 2, id_canilla: 1, id_empleado_conexion: 1 } }, res);
    // Assert
    assert.equal(res.statusCode, 400);
    assert.deepEqual(estado.eventos, ['rollback']);
});

test('retirar barril: invalida la caché después del UPDATE', async () => {
    // Arrange: el barril existe y está conectado
    estado.resultados = [{ recordset: [{ id_barril: 3, estado: 'Conectado' }] }, { rowsAffected: [1] }];
    const res = fakeRes();
    // Act
    await retirarBarril({ params: { id: 3 } }, res);
    // Assert
    assert.equal(res.statusCode, 204);
    assert.deepEqual(estado.eventos, ['del:stock:muro:resumen']);
});

test('retirar barril: con Redis caído la operación igual responde 204', async () => {
    // Arrange
    estado.resultados = [{ recordset: [{ id_barril: 3, estado: 'Conectado' }] }, { rowsAffected: [1] }];
    estado.redisCaido = true;
    const res = fakeRes();
    // Act
    await retirarBarril({ params: { id: 3 } }, res);
    // Assert: el cambio ya está confirmado; la caché vence sola por TTL (60 s)
    assert.equal(res.statusCode, 204);
});
