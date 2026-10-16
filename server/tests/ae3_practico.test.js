/**
 * ae3_practico.test.js
 * =====================================================================
 * Batería de pruebas automatizadas – AE3 Paradigmas y Lenguajes III
 * Proyecto: Cervecería Ombú (Módulo Luciano Chesani)
 *
 * Stack: node:test + node:assert + supertest
 * Patrón: AAA (Arrange → Act → Assert)
 *
 * Ejecución:
 *   node --test server/tests/ae3_practico.test.js
 * =====================================================================
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../index');

/* ───────────────────────────────────────────────────────────────
 * Función utilitaria escapeHTML (copia aislada para Node.js)
 * La versión original vive en client/src/utils/escapeHTML.js y
 * depende de `window`, por lo que se replica aquí para poder
 * ejecutar el test unitario sin entorno de navegador.
 * ─────────────────────────────────────────────────────────────── */
function escapeHTML(valor) {
    return String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/* ═══════════════════════════════════════════════════════════════
 * TEST 1 – Unitario Puro (Aislamiento Total)
 * Verifica que escapeHTML sanitiza correctamente caracteres
 * peligrosos para prevenir ataques XSS.
 * Sin base de datos, sin red, < 10 ms.
 * ═══════════════════════════════════════════════════════════════ */
describe('Test 1 – Unitario: escapeHTML (XSS Sanitización)', () => {
    it('debe escapar etiquetas <script> para prevenir XSS', () => {
        // Arrange
        const inputMalicioso = '<script>alert(1)</script>';
        const salidaEsperada = '&lt;script&gt;alert(1)&lt;/script&gt;';

        // Act
        const resultado = escapeHTML(inputMalicioso);

        // Assert
        assert.equal(resultado, salidaEsperada,
            'La función debe reemplazar < y > por sus entidades HTML');
    });

    it('debe escapar comillas dobles, simples y ampersands', () => {
        // Arrange
        const input = `"Ombú" & 'Cervecería'`;
        const esperado = '&quot;Ombú&quot; &amp; &#039;Cervecería&#039;';

        // Act
        const resultado = escapeHTML(input);

        // Assert
        assert.equal(resultado, esperado);
    });

    it('debe manejar valores null/undefined sin romper', () => {
        // Arrange & Act & Assert
        assert.equal(escapeHTML(null), '');
        assert.equal(escapeHTML(undefined), '');
    });
});

/* ═══════════════════════════════════════════════════════════════
 * TEST 2 – Integración 201 (Validación de Contrato)
 * POST /api/canillas con payload válido y token de admin.
 * Verifica status 201 y esquema JSON con propiedad esperada.
 * ═══════════════════════════════════════════════════════════════ */
describe('Test 2 – Integración: POST /api/canillas → 201', () => {
    /**
     * Helper: verifica si SQL Server está disponible.
     * Si Docker no está corriendo, el test se salta con un mensaje claro
     * en vez de fallar con un 500 que no aporta valor diagnóstico.
     */
    async function sqlServerDisponible() {
        try {
            const { getConnection } = require('../config/db');
            const pool = await Promise.race([
                getConnection(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
            ]);
            await pool.request().query('SELECT 1');
            return true;
        } catch {
            return false;
        }
    }

    it('debe crear una canilla y responder 201 con JSON válido', async (t) => {
        // Pre-condición: SQL Server debe estar disponible
        const dbOnline = await sqlServerDisponible();
        if (!dbOnline) {
            t.skip('SQL Server no disponible (Docker apagado) — ejecutar con la infra levantada');
            return;
        }

        // Arrange
        const TOKEN_ADMIN = process.env.ADMIN_TOKEN || 'admin-secret-token-ombu';
        const payload = {
            numero: 999,       // Número alto para evitar colisiones
            estado: 'Activa'
        };

        // Act
        const res = await request(app)
            .post('/api/canillas')
            .set('Authorization', `Bearer ${TOKEN_ADMIN}`)
            .send(payload)
            .expect('Content-Type', /json/);

        // Assert
        assert.equal(res.status, 201,
            `Se esperaba status 201 pero se recibió ${res.status}`);
        assert.ok(res.body !== null && typeof res.body === 'object',
            'La respuesta debe ser un objeto JSON válido');
        assert.ok(res.body.message || res.body.ok,
            'El body debe contener "message" o "ok" confirmando la creación');
    });
});

/* ═══════════════════════════════════════════════════════════════
 * TEST 3 – Borde 400 (Datos Corruptos / Validación de Entrada)
 * POST /api/canillas con payload inválido (campo obligatorio
 * omitido). Verifica que el servidor responda 400 y NO 500.
 * ═══════════════════════════════════════════════════════════════ */
describe('Test 3 – Borde: POST /api/canillas con datos inválidos → 400', () => {
    it('debe rechazar con 400 cuando falta el campo "numero"', async () => {
        // Arrange
        const TOKEN_ADMIN = process.env.ADMIN_TOKEN || 'admin-secret-token-ombu';
        const payloadInvalido = {
            // "numero" omitido intencionalmente
            estado: 'Activa'
        };

        // Act
        const res = await request(app)
            .post('/api/canillas')
            .set('Authorization', `Bearer ${TOKEN_ADMIN}`)
            .send(payloadInvalido)
            .expect('Content-Type', /json/);

        // Assert
        assert.equal(res.status, 400,
            `Se esperaba 400 Bad Request pero se recibió ${res.status} — el servidor NO debe devolver 500`);
        assert.ok(res.body.error,
            'La respuesta 400 debe incluir un campo "error" descriptivo');
    });

    it('debe rechazar con 400 cuando falta el campo "estado"', async () => {
        // Arrange
        const TOKEN_ADMIN = process.env.ADMIN_TOKEN || 'admin-secret-token-ombu';
        const payloadInvalido = {
            numero: 123
            // "estado" omitido intencionalmente
        };

        // Act
        const res = await request(app)
            .post('/api/canillas')
            .set('Authorization', `Bearer ${TOKEN_ADMIN}`)
            .send(payloadInvalido)
            .expect('Content-Type', /json/);

        // Assert
        assert.equal(res.status, 400,
            `Se esperaba 400 Bad Request pero se recibió ${res.status}`);
        assert.ok(res.body.error,
            'La respuesta debe indicar qué campos faltan');
    });

    it('debe rechazar con 401 si no se envía token de autenticación', async () => {
        // Arrange
        const payloadValido = { numero: 50, estado: 'Activa' };

        // Act
        const res = await request(app)
            .post('/api/canillas')
            .send(payloadValido);

        // Assert
        assert.equal(res.status, 401,
            'Sin token, el middleware RBAC debe bloquear con 401');
    });
});
