const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const app = require('../index');

describe('Fase 4 (F-09 & F-18) - Health Check Endpoint y Exportación Limpia de App', () => {

    it('F-18: Debe exportar app como una función/instancia Express limpia para pruebas', () => {
        assert.equal(typeof app, 'function', 'app debe ser una función/instancia de Express');
        assert.ok(app.listen, 'app debe poseer el método listen');
    });

    it('F-09: Endpoint GET /api/health debe responder con estructura JSON esperada', async () => {
        // Iniciar un servidor HTTP efímero en puerto libre (0) para probar la app exportada
        const server = http.createServer(app);
        await new Promise((resolve) => server.listen(0, resolve));
        const port = server.address().port;

        try {
            const res = await fetch(`http://localhost:${port}/api/health`);
            // Sin los tres servicios activos devolverá 503, o 200 si estuvieran activos
            assert.ok([200, 503].includes(res.status), `El código HTTP debe ser 200 o 503 (obtenido: ${res.status})`);

            const data = await res.json();
            assert.equal(typeof data.ok, 'boolean', 'El atributo ok debe ser un booleano');
            assert.ok(data.servicios, 'Debe incluir el objeto de servicios');
            assert.ok(['ok', 'caido'].includes(data.servicios.sqlserver), 'sqlserver debe ser ok o caido');
            assert.ok(['ok', 'caido'].includes(data.servicios.redis), 'redis debe ser ok o caido');
            assert.ok(['ok', 'caido'].includes(data.servicios.rabbitmq), 'rabbitmq debe ser ok o caido');

            if (res.status === 200) {
                assert.equal(data.ok, true);
                assert.equal(data.servicios.sqlserver, 'ok');
                assert.equal(data.servicios.redis, 'ok');
                assert.equal(data.servicios.rabbitmq, 'ok');
            } else {
                assert.equal(data.ok, false);
            }
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    });
});
