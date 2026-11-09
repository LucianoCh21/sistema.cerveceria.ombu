// Unitaria (patrón AAA): la URL AMQP se loguea sin contraseña (RNF-23).
const test = require('node:test');
const assert = require('node:assert/strict');
const { ocultarCredenciales } = require('../config/rabbitmq');

test('ocultarCredenciales reemplaza la contraseña de la URL AMQP', () => {
    // Arrange
    const url = 'amqp://ombu:clave-secreta@rabbitmq:5672';
    // Act
    const visible = ocultarCredenciales(url);
    // Assert
    assert.equal(visible, 'amqp://ombu:***@rabbitmq:5672');
    assert.ok(!visible.includes('clave-secreta'));
});

test('ocultarCredenciales no altera URLs sin credenciales', () => {
    assert.equal(ocultarCredenciales('amqp://localhost:5672'), 'amqp://localhost:5672');
});
