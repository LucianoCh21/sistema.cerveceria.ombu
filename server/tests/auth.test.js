const test = require('node:test');
const assert = require('node:assert/strict');
const { requireRole } = require('../middleware/auth');

test('Fase 2 (F-04) - Middleware RBAC auth.js', async (t) => {
    process.env.ADMIN_TOKEN = 'token-admin-test';
    process.env.TERMINAL_TOKEN = 'token-terminal-test';

    await t.test('Debe retornar 401 si no se envía cabecera de autenticación', () => {
        let statusSent = null;
        let jsonSent = null;
        const req = { headers: {} };
        const res = {
            status: (s) => {
                statusSent = s;
                return {
                    json: (j) => { jsonSent = j; }
                };
            }
        };
        let nextCalled = false;

        const middleware = requireRole('terminal', 'admin');
        middleware(req, res, () => { nextCalled = true; });

        assert.equal(nextCalled, false);
        assert.equal(statusSent, 401);
        assert.equal(jsonSent.codigo, 'UNAUTHORIZED');
    });

    await t.test('Debe retornar 403 si el rol autenticado no coincide con los permitidos', () => {
        let statusSent = null;
        let jsonSent = null;
        const req = { headers: { authorization: 'Bearer token-terminal-test' } };
        const res = {
            status: (s) => {
                statusSent = s;
                return {
                    json: (j) => { jsonSent = j; }
                };
            }
        };
        let nextCalled = false;

        const middleware = requireRole('admin');
        middleware(req, res, () => { nextCalled = true; });

        assert.equal(nextCalled, false);
        assert.equal(statusSent, 403);
        assert.equal(jsonSent.codigo, 'FORBIDDEN');
    });

    await t.test('Debe dar paso (next) si el token pertenece a un rol autorizado', () => {
        const req = { headers: { authorization: 'Bearer token-terminal-test' } };
        const res = {};
        let nextCalled = false;

        const middleware = requireRole('terminal', 'admin');
        middleware(req, res, () => { nextCalled = true; });

        assert.equal(nextCalled, true);
        assert.equal(req.rol, 'terminal');
    });
});
