/**
 * ae3_carga_seguridad.test.js
 * =====================================================================
 * Actividad Especial AE3 – Paradigmas y Lenguajes de Programación III
 * Pruebas de Carga Concurrente y Blindaje de Endpoints de Seguridad
 * 
 * Proyecto: Cervecería Ombú (Módulo Stock / Canillas / Despachos)
 * Alumno: Luciano Chesani
 * Carrera: Ingeniería en Sistemas de Información (3er Año) - UCP Posadas
 * 
 * Stack: node:test + node:assert/strict + supertest
 * Metodología: Patrón AAA (Arrange - Act - Assert)
 * =====================================================================
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../index');

describe('AE3 – Batería de Pruebas: Carga Concurrente y Blindaje de Endpoints', () => {

    after(async () => {
        // Cierre limpio de conexiones activas para permitir que el test runner finalice sin bloqueos
        try {
            const { sql } = require('../config/db');
            await sql.close();
        } catch (_) {}
    });

    // ─────────────────────────────────────────────────────────────────
    // TEST 1: Test de Carga Concurrente (20 peticiones simultáneas)
    // ─────────────────────────────────────────────────────────────────
    it('Test 1 – Carga Concurrente: debe procesar 20 peticiones simultáneas con HTTP 200 y registrar latencias', async () => {
        // ARRANGE
        const CANTIDAD_PETICIONES = 20;
        const promesasPeticiones = Array.from({ length: CANTIDAD_PETICIONES }, () => 
            request(app).get('/api/canillas')
        );
        const tiempoInicio = performance.now();

        // ACT
        const respuestas = await Promise.all(promesasPeticiones);
        const tiempoFin = performance.now();
        const tiempoTotalMs = tiempoFin - tiempoInicio;
        const latenciaMediaMs = tiempoTotalMs / CANTIDAD_PETICIONES;

        // Registro de telemetría de rendimiento para el informe técnico
        console.log(`\n  [Métricas de Carga Concurrente]`);
        console.log(`  - Peticiones simultáneas: ${CANTIDAD_PETICIONES}`);
        console.log(`  - Tiempo total:           ${tiempoTotalMs.toFixed(2)} ms`);
        console.log(`  - Latencia media:         ${latenciaMediaMs.toFixed(2)} ms/req\n`);

        // ASSERT
        assert.equal(respuestas.length, CANTIDAD_PETICIONES, 
            `Se esperaba la resolución de exactamente ${CANTIDAD_PETICIONES} respuestas`);

        respuestas.forEach((res, index) => {
            assert.equal(res.status, 200, 
                `La petición concurrente #${index + 1} falló: esperado 200, obtenido ${res.status}`);
            assert.ok(Array.isArray(res.body), 
                `La respuesta #${index + 1} debe contener un arreglo de canillas`);
        });

        assert.ok(tiempoTotalMs > 0, 'El tiempo total debe ser un número positivo medible');
        assert.ok(latenciaMediaMs > 0, 'La latencia media calculada debe ser positiva');
    });

    // ─────────────────────────────────────────────────────────────────
    // TEST 2: Sanitización y Error 400 (Blindaje ante XSS y SQL Injection)
    // ─────────────────────────────────────────────────────────────────
    it('Test 2 – Sanitización y Error 400: debe rechazar payload malicioso con HTTP 400 y NUNCA devolver 500', async () => {
        // ARRANGE
        const tokenAdmin = process.env.ADMIN_TOKEN || 'admin-secret-token-ombu';
        const payloadMalicioso = {
            numero: "<script>alert('XSS_ATTACK_PAYLOAD')</script>",
            estado: "Activa'; DROP TABLE Canilla;--"
        };

        // ACT
        const res = await request(app)
            .post('/api/canillas')
            .set('Authorization', `Bearer ${tokenAdmin}`)
            .send(payloadMalicioso);

        // ASSERT
        assert.notEqual(res.status, 500, 
            'Vulnerabilidad detectada: el servidor NUNCA debe colapsar con HTTP 500 ante entradas maliciosas');
        assert.equal(res.status, 400, 
            `El endpoint blindado debe responder estrictamente HTTP 400 Bad Request (obtenido: ${res.status})`);
        assert.ok(res.body && res.body.error, 
            'El cuerpo de respuesta 400 debe contener una propiedad "error" con la causa del rechazo');
    });

    // ─────────────────────────────────────────────────────────────────
    // TEST 3: Headers de Seguridad (Anti-sniffing y Anti-clickjacking)
    // ─────────────────────────────────────────────────────────────────
    it('Test 3 – Headers de Seguridad: debe inyectar X-Content-Type-Options y X-Frame-Options en la respuesta', async () => {
        // ARRANGE
        const endpoint = '/api/canillas';

        // ACT
        const res = await request(app).get(endpoint);

        // ASSERT
        assert.equal(res.status, 200, 'El endpoint seguro de consulta debe responder HTTP 200');

        // Verificación de Anti-MIME-Sniffing
        assert.equal(res.headers['x-content-type-options'], 'nosniff', 
            'Debe incluir la cabecera "X-Content-Type-Options: nosniff" para prevenir sniffing de tipos MIME');

        // Verificación de Anti-Clickjacking (DENY o SAMEORIGIN)
        const frameOptions = res.headers['x-frame-options'];
        assert.ok(
            frameOptions === 'DENY' || frameOptions === 'SAMEORIGIN', 
            `La cabecera "X-Frame-Options" debe ser "DENY" o "SAMEORIGIN" (obtenido: "${frameOptions}")`
        );
        assert.equal(frameOptions, 'DENY', 
            'La directiva configurada en Express debe ser estrictamente "DENY" para máxima protección');
    });

});
