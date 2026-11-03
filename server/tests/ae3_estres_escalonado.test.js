/**
 * ae3_estres_escalonado.test.js
 * =====================================================================
 * Actividad Especial AE3 – Paradigmas y Lenguajes de Programación III
 * Pruebas de Estrés Escalonado: Evaluación del Event Loop y Connection Pool
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

describe('AE3 – Pruebas de Estrés Escalonado (200 y 500 peticiones)', () => {

    after(async () => {
        try {
            const { sql } = require('../config/db');
            await sql.close();
        } catch (_) {}
    });

    // ─────────────────────────────────────────────────────────────────
    // TEST 1: Estrés Medio (200 peticiones concurrentes)
    // ─────────────────────────────────────────────────────────────────
    it('Test 1 – Estrés Medio (200 reqs): debe procesar 200 peticiones simultáneas con HTTP 200', async () => {
        // ARRANGE
        const CANTIDAD = 200;
        const promesas = Array.from({ length: CANTIDAD }, () => 
            request(app).get('/api/canillas')
        );
        const tInicio = performance.now();

        // ACT
        const respuestas = await Promise.all(promesas);
        const tFin = performance.now();
        const tiempoTotalMs = tFin - tInicio;
        const latenciaMediaMs = tiempoTotalMs / CANTIDAD;

        // Impresión en consola (stdout)
        console.log(`\n  ======================================================`);
        console.log(`  [Estrés Medio - 200 Reqs Simultáneas]`);
        console.log(`  - Peticiones disparadas: ${CANTIDAD}`);
        console.log(`  - Tiempo Total (T_total): ${tiempoTotalMs.toFixed(2)} ms`);
        console.log(`  - Latencia Media (L_bar): ${latenciaMediaMs.toFixed(2)} ms/req`);
        console.log(`  ======================================================\n`);

        // ASSERT
        assert.equal(respuestas.length, CANTIDAD, 
            `Se esperaba recibir exactamente ${CANTIDAD} respuestas`);

        respuestas.forEach((res, idx) => {
            assert.equal(res.status, 200, 
                `Petición #${idx + 1} falló: esperado 200, obtenido ${res.status}`);
            assert.ok(Array.isArray(res.body), 
                `Petición #${idx + 1} debe contener un arreglo de canillas`);
        });

        assert.ok(tiempoTotalMs > 0, 'El tiempo total debe ser un número positivo');
        assert.ok(latenciaMediaMs > 0, 'La latencia media debe ser un número positivo');
    });

    // ─────────────────────────────────────────────────────────────────
    // TEST 2: Estrés Alto (500 peticiones concurrentes)
    // ─────────────────────────────────────────────────────────────────
    it('Test 2 – Estrés Alto (500 reqs): debe procesar 500 peticiones simultáneas con HTTP 200', async () => {
        // ARRANGE
        const CANTIDAD = 500;
        const promesas = Array.from({ length: CANTIDAD }, () => 
            request(app).get('/api/canillas')
        );
        const tInicio = performance.now();

        // ACT
        const respuestas = await Promise.all(promesas);
        const tFin = performance.now();
        const tiempoTotalMs = tFin - tInicio;
        const latenciaMediaMs = tiempoTotalMs / CANTIDAD;

        // Impresión en consola (stdout)
        console.log(`\n  ======================================================`);
        console.log(`  [Estrés Alto - 500 Reqs Simultáneas]`);
        console.log(`  - Peticiones disparadas: ${CANTIDAD}`);
        console.log(`  - Tiempo Total (T_total): ${tiempoTotalMs.toFixed(2)} ms`);
        console.log(`  - Latencia Media (L_bar): ${latenciaMediaMs.toFixed(2)} ms/req`);
        console.log(`  ======================================================\n`);

        // ASSERT
        assert.equal(respuestas.length, CANTIDAD, 
            `Se esperaba recibir exactamente ${CANTIDAD} respuestas`);

        respuestas.forEach((res, idx) => {
            assert.equal(res.status, 200, 
                `Petición #${idx + 1} falló: esperado 200, obtenido ${res.status}`);
            assert.ok(Array.isArray(res.body), 
                `Petición #${idx + 1} debe contener un arreglo de canillas`);
        });

        assert.ok(tiempoTotalMs > 0, 'El tiempo total debe ser un número positivo');
        assert.ok(latenciaMediaMs > 0, 'La latencia media debe ser un número positivo');
    });

});
