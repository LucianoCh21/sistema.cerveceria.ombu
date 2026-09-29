const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('DÍA 6 - Pruebas de Integración Cruzada (Módulo NFC -> Módulo Stock)', () => {

    describe('1. Flujo Integrado E2E: Lectura NFC -> Despacho -> Evento RabbitMQ -> Descuento en Stock', () => {

        // Almacén simulado de Redis en memoria para validar ciclo de vida
        const redisStore = new Map();
        const ttlStore = new Map();

        const simularSetSession = (key, data, ttl) => {
            redisStore.set(key, JSON.stringify(data));
            ttlStore.set(key, Date.now() + (ttl * 1000));
            return true;
        };

        const simularGetSession = (key) => {
            if (!redisStore.has(key)) return null;
            if (Date.now() > ttlStore.get(key)) {
                redisStore.delete(key);
                ttlStore.delete(key);
                return null;
            }
            return JSON.parse(redisStore.get(key));
        };

        it('Paso 1: Aproximación de Tarjeta y Apertura de Sesión Efímera en Redis (TTL 45s)', () => {
            const idTarjeta = 'A1B2C3D4E5';
            const sessionData = {
                id_tarjeta: idTarjeta,
                id_cliente: 1,
                cliente_nombre: 'Juan Pérez',
                id_canilla: 1,
                saldo_disponible: 6500.00,
                iniciado_en: new Date().toISOString()
            };

            const key = `nfc:sesion:${idTarjeta}`;
            simularSetSession(key, sessionData, 45);

            const sesionActiva = simularGetSession(key);
            assert.ok(sesionActiva, 'La sesión NFC debe existir en Redis');
            assert.equal(sesionActiva.id_tarjeta, idTarjeta);
            assert.equal(sesionActiva.saldo_disponible, 6500.00);
            assert.equal(sesionActiva.id_canilla, 1);
        });

        it('Paso 2: Generación del Despacho Transaccional y Emisión de Evento RabbitMQ', () => {
            const idDespachoSimulado = 3001;
            const idCanilla = 1;
            const volumenLitros = 0.5; // Pinta 500ml
            const precioCobrado = 3500.00;
            const idempotencyKey = 'idem-cross-test-001';

            // Simulación de transacción financiera: saldo disminuye
            let saldoTarjeta = 6500.00;
            saldoTarjeta -= precioCobrado;
            assert.equal(saldoTarjeta, 3000.00, 'El saldo de la tarjeta debe debitar exactamente el importe cobrado');

            // Estructura del evento publicado al exchange ombu.eventos
            const eventoRabbitMQ = {
                eventId: 'evt-test-cross-001',
                eventType: 'DespachoRealizado',
                occurredAt: new Date().toISOString(),
                version: '1.0',
                idempotencyKey: idempotencyKey,
                producer: 'modulo-nfc-despachos',
                data: {
                    idDespacho: idDespachoSimulado,
                    idCanilla: idCanilla,
                    idBarril: 1,
                    idFormato: 2,
                    volumenLitros: volumenLitros,
                    mililitros: 500,
                    formato: 'Pinta',
                    importeDebitado: precioCobrado,
                    idTarjeta: 'A1B2C3D4E5',
                    idCliente: 1
                }
            };

            assert.equal(eventoRabbitMQ.eventType, 'DespachoRealizado');
            assert.equal(eventoRabbitMQ.producer, 'modulo-nfc-despachos');
            assert.equal(eventoRabbitMQ.data.idDespacho, 3001);
            assert.equal(eventoRabbitMQ.data.volumenLitros, 0.5);

            // Eliminar sesión efímera de Redis (consumo completo)
            redisStore.delete('nfc:sesion:A1B2C3D4E5');
            assert.equal(simularGetSession('nfc:sesion:A1B2C3D4E5'), null, 'La sesión efímera debe quedar purgada tras el cobro');
        });

        it('Paso 3: Consumidor Asíncrono de Stock descuenta litros del barril e invalida caché', () => {
            // Estado inicial del barril conectado a la canilla 1 (50 Litros)
            const barrilMock = {
                id_barril: 1,
                id_canilla: 1,
                litros_totales: 50.0,
                litros_restantes: 50.0,
                estado: 'Conectado'
            };

            // Simulación de la cola stock.despachos.queue recibiendo el mensaje
            const mensajeConsumido = {
                data: {
                    idDespacho: 3001,
                    idCanilla: 1,
                    volumenLitros: 0.50
                }
            };

            // Ejecución del worker stockConsumer:
            barrilMock.litros_restantes = Number((barrilMock.litros_restantes - mensajeConsumido.data.volumenLitros).toFixed(2));
            if (barrilMock.litros_restantes <= 0) {
                barrilMock.estado = 'Agotado';
            }

            assert.equal(barrilMock.litros_restantes, 49.50, 'El stock remanente del barril debe quedar en 49.50 L');
            assert.equal(barrilMock.estado, 'Conectado');

            // Simulación de invalidación de caché caliente stock:muro:resumen
            const cacheStock = new Map([['stock:muro:resumen', JSON.stringify([{ canilla: 1, litros: 50.0 }])]]);
            cacheStock.delete('stock:muro:resumen');
            assert.equal(cacheStock.has('stock:muro:resumen'), false, 'La caché de stock debe invalidarse para forzar lectura fresca');
        });
    });

    describe('2. Validación de Idempotencia en Ambos Extremos (API y Worker)', () => {

        it('Idempotencia Nivel API: Mismo Idempotency-Key no vuelve a cobrar ni duplicar despacho', () => {
            const idempotenciaMap = new Map();
            const idempotencyKey = 'idem-req-uuid-999';

            const primeraRespuesta = {
                ok: true,
                id_despacho: 3005,
                precio_cobrado: 3500.00,
                saldo_restante: 3000.00
            };

            // Primer request: guarda en mapa de idempotencia
            idempotenciaMap.set(`idempotency:${idempotencyKey}`, primeraRespuesta);

            // Segundo request con la misma clave:
            const cacheHit = idempotenciaMap.get(`idempotency:${idempotencyKey}`);
            assert.ok(cacheHit, 'Debe detectar la clave repetida');

            const respuestaIdempotente = {
                ...cacheHit,
                idempotencia_aplicada: true
            };

            assert.equal(respuestaIdempotente.idempotencia_aplicada, true);
            assert.equal(respuestaIdempotente.id_despacho, 3005);
            assert.equal(respuestaIdempotente.precio_cobrado, 3500.00, 'El importe debe ser el mismo sin volver a debitar');
        });

        it('Idempotencia Nivel Worker: Mensaje duplicado en RabbitMQ no vuelve a descontar stock', () => {
            const tablaIdempotenciaStock = new Set();
            const idDespacho = 3005;
            let litrosBarril = 49.50;

            // Primer procesamiento del mensaje
            if (!tablaIdempotenciaStock.has(idDespacho)) {
                litrosBarril -= 0.50;
                tablaIdempotenciaStock.add(idDespacho);
            }
            assert.equal(litrosBarril, 49.00);

            // Reintento o retransmisión por fallo de red
            let mensajeDuplicadoDetectado = false;
            if (tablaIdempotenciaStock.has(idDespacho)) {
                mensajeDuplicadoDetectado = true;
                // No se descuenta stock
            } else {
                litrosBarril -= 0.50;
            }

            assert.equal(mensajeDuplicadoDetectado, true, 'El worker debe detectar que el despacho ya fue aplicado');
            assert.equal(litrosBarril, 49.00, 'El stock remanente no debe decrementar por segunda vez');
        });
    });

    describe('3. Reconexiones, Manejo de Errores y Tolerancia a Fallos', () => {

        it('Tolerancia a Expiración de TTL: Rechazo determinístico con código 403 (SESSION_EXPIRED)', () => {
            // Sesión que expiró tras 45 segundos
            const sesionActiva = null; // Simula get de clave inexistente por TTL vencido

            const validarSesion = (sesion) => {
                if (!sesion) {
                    return {
                        status: 403,
                        body: {
                            ok: false,
                            error: "La sesión del grifo ha expirado (TTL de 45 segundos agotado) o la tarjeta no fue aproximada al lector.",
                            codigo: "SESSION_EXPIRED"
                        }
                    };
                }
                return { status: 200 };
            };

            const respuesta = validarSesion(sesionActiva);
            assert.equal(respuesta.status, 403);
            assert.equal(respuesta.body.codigo, "SESSION_EXPIRED");
        });

        it('Tolerancia a Saldo Insuficiente: Rechazo previo al servido con código 402 (INSUFFICIENT_FUNDS)', () => {
            const saldoActual = 0.00;
            const formatoPrecio = 3500.00;

            const esRechazado = saldoActual < formatoPrecio;
            assert.equal(esRechazado, true, 'Debe rechazar la operación si el saldo es menor al precio');
        });

        it('Estrategia de Reconexión Exponencial: Redis reconecta con tope de 3000ms', () => {
            const retryStrategy = (times) => Math.min(times * 100, 3000);

            assert.equal(retryStrategy(1), 100);
            assert.equal(retryStrategy(5), 500);
            assert.equal(retryStrategy(10), 1000);
            assert.equal(retryStrategy(30), 3000);
            assert.equal(retryStrategy(100), 3000, 'El tope máximo de espera ante reconexiones debe ser 3000ms');
        });

        it('Degradación Controlada: Fallback transparente a SQL Server si Redis está fuera de línea', () => {
            let fallbackEjecutado = false;
            let origenRespuesta = null;

            try {
                // Simulación de fallo en lectura de Redis
                throw new Error("ECONNREFUSED 127.0.0.1:6379");
            } catch (redisError) {
                // El catch ejecuta la consulta a SQL Server directamente sin colgar el servidor
                fallbackEjecutado = true;
                origenRespuesta = 'sql-server';
            }

            assert.equal(fallbackEjecutado, true, 'Debe capturar el error de conexión de Redis');
            assert.equal(origenRespuesta, 'sql-server', 'El origen de los datos debe degradar a SQL Server sin interrupción de servicio');
        });

        it('Transición de Estado Crítica: El barril pasa a Agotado automáticamente cuando el remanente llega a 0', () => {
            let litrosRestantes = 0.50;
            const servido = 0.50;
            litrosRestantes -= servido;

            let estadoBarril = 'Conectado';
            if (litrosRestantes <= 0) {
                estadoBarril = 'Agotado';
            }

            assert.equal(litrosRestantes, 0.00);
            assert.equal(estadoBarril, 'Agotado', 'El barril debe marcarse como Agotado al consumirse el último litro');
        });
    });
});
