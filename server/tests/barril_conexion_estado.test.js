// Unitarias con dobles (patrón AAA): conectar barril valida el estado del barril.
// Antes del fix, un barril 'Conectado' en otra canilla se movía en silencio y uno 'Agotado' se reconectaba.
const test = require('node:test');
const assert = require('node:assert/strict');

let estado;
const install = (path, exports) => {
    const id = require.resolve(path);
    require.cache[id] = { id, filename: id, loaded: true, exports };
};
// Request falso de mssql: registra cada consulta y devuelve en orden los resultados encolados.
const fakeRequest = () => {
    const req = {
        input: () => req,
        query: async (texto) => {
            if (/UPDATE\s+Barril/i.test(texto)) estado.eventos.push('update');
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
install('../config/redis', { getRedisClient: () => ({ del: async () => {} }) });
const { conectarBarril } = require('../controllers/barrilController');

const fakeRes = () => {
    const res = { statusCode: null, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
};
const req = { body: { id_barril: 2, id_canilla: 8, id_empleado_conexion: 1 } };

test.beforeEach(() => {
    estado = { resultados: [], eventos: [] };
});

test('barril conectado en otra canilla: 409 y no se mueve', async () => {
    // Arrange: canilla 8 libre; el barril 2 está conectado en la canilla 2
    estado.resultados = [{ recordset: [] }, { recordset: [{ estado: 'Conectado', id_canilla: 2 }] }];
    const res = fakeRes();
    // Act
    await conectarBarril(req, res);
    // Assert
    assert.equal(res.statusCode, 409);
    assert.match(res.body.error, /ya está conectado en la canilla 2/);
    assert.deepEqual(estado.eventos, ['rollback']);
});

test('barril agotado: 409 y no se reconecta', async () => {
    // Arrange: canilla 8 libre; el barril 2 está agotado
    estado.resultados = [{ recordset: [] }, { recordset: [{ estado: 'Agotado', id_canilla: 2 }] }];
    const res = fakeRes();
    // Act
    await conectarBarril(req, res);
    // Assert
    assert.equal(res.statusCode, 409);
    assert.match(res.body.error, /agotado/);
    assert.deepEqual(estado.eventos, ['rollback']);
});

test('barril inexistente: sigue respondiendo 404 sin commit', async () => {
    // Arrange: canilla libre, el barril no existe y el UPDATE no afecta filas
    estado.resultados = [{ recordset: [] }, { recordset: [] }, { rowsAffected: [0] }];
    const res = fakeRes();
    // Act
    await conectarBarril(req, res);
    // Assert
    assert.equal(res.statusCode, 404);
    assert.ok(!estado.eventos.includes('commit'));
});
