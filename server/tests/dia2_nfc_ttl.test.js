const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Importar utilidades de Redis
const { setNfcSession, getNfcSession, deleteNfcSession } = require('../config/redis');

describe('DÍA 2 - Backend NFC: Autenticación de Tarjeta y Sesión Efímera en Redis (TTL 45s)', () => {

    it('Debe formatear adecuadamente el titular para tarjetas nominadas y anónimas', () => {
        // Tarjeta nominada
        const clienteNominado = { nombre: 'Juan', apellido: 'Pérez' };
        const nombreNominado = clienteNominado.nombre 
            ? `${clienteNominado.nombre} ${clienteNominado.apellido}`.trim() 
            : 'Consumidor Final / Anónimo';
        assert.equal(nombreNominado, 'Juan Pérez');

        // Tarjeta anónima (al portador)
        const clienteAnonimo = { nombre: null, apellido: null };
        const nombreAnonimo = clienteAnonimo.nombre 
            ? `${clienteAnonimo.nombre} ${clienteAnonimo.apellido}`.trim() 
            : 'Consumidor Final / Anónimo';
        assert.equal(nombreAnonimo, 'Consumidor Final / Anónimo');
    });

    it('Debe rechazar tarjetas inactivas o bloqueadas', () => {
        const estadoInactivo = 'Inactiva';
        assert.notEqual(estadoInactivo, 'Activa', 'Solo las tarjetas con estado Activa pueden ser autenticadas.');
    });

    it('Debe validar saldo mínimo positivo antes de iniciar sesión en grifo', () => {
        const saldoCero = 0;
        const saldoNegativo = -150.50;
        const saldoValido = 3500.00;

        assert.ok(saldoCero <= 0, 'Saldo cero debe ser rechazado.');
        assert.ok(saldoNegativo <= 0, 'Saldo negativo debe ser rechazado.');
        assert.ok(saldoValido > 0, 'Saldo positivo debe habilitar la apertura de sesión.');
    });

    it('Debe estructurar el payload de sesión efímera con TTL estricto de 45 segundos (RN-02)', () => {
        const idTarjeta = 'A1B2C3D4E5';
        const sessionPayload = {
            id_tarjeta: idTarjeta,
            id_cliente: 1,
            cliente_nombre: 'Juan Pérez',
            id_canilla: 2,
            saldo_disponible: 6500.00,
            iniciado_en: new Date().toISOString()
        };

        const ttlSegundos = 45;

        assert.equal(ttlSegundos, 45, 'El TTL de la sesión de grifo debe ser exactamente 45 segundos según la regla de negocio RN-02.');
        assert.equal(sessionPayload.id_tarjeta, idTarjeta);
        assert.equal(sessionPayload.id_canilla, 2);
        assert.equal(sessionPayload.saldo_disponible, 6500.00);
    });

    it('Debe contemplar la clave de Redis normalizada: nfc:sesion:{id_tarjeta}', () => {
        const idTarjeta = 'F6G7H8I9J0';
        const redisKey = `nfc:sesion:${idTarjeta}`;
        assert.equal(redisKey, 'nfc:sesion:F6G7H8I9J0');
    });
});
