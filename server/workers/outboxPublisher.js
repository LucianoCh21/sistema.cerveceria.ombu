/**
 * Worker: Publicador Transaccional Outbox (F-07)
 * Consulta la tabla EventoOutbox periódicamente y publica los eventos pendientes
 * a RabbitMQ utilizando un ConfirmChannel con waitForConfirms().
 * Garantiza entrega confiable sin pérdida de mensajes aunque RabbitMQ se reinicie.
 */

const amqp = require('amqplib');
const { getConnection, sql } = require('../config/db');
require('dotenv').config();

const rabbitUrl = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const EXCHANGE_NAME = process.env.RABBITMQ_EXCHANGE || 'ombu.eventos';
const ROUTING_KEY_DESPACHO = 'despacho.confirmado';
const INTERVALO_MS = 2000;
const LOTE_MAX = 50;

let isRunning = false;
let confirmChannel = null;
let connection = null;

const initConfirmChannel = async () => {
    if (confirmChannel) return confirmChannel;

    try {
        if (!connection) {
            connection = await amqp.connect(rabbitUrl);
            connection.on('error', (err) => {
                console.warn(`[OutboxPublisher] Conexión interrumpida: ${err.message}`);
                connection = null;
                confirmChannel = null;
            });
            connection.on('close', () => {
                console.warn('[OutboxPublisher] Conexión cerrada. Reconectando...');
                connection = null;
                confirmChannel = null;
            });
        }

        confirmChannel = await connection.createConfirmChannel();
        await confirmChannel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });
        console.log(`[OutboxPublisher] Canal de confirmación establecido en exchange '${EXCHANGE_NAME}'.`);
        return confirmChannel;
    } catch (err) {
        console.warn(`[OutboxPublisher] RabbitMQ no disponible (${err.message}). Reintentando en próximo ciclo...`);
        confirmChannel = null;
        return null;
    }
};

/**
 * Procesa un lote de eventos pendientes en EventoOutbox
 */
const procesarEventosPendientes = async () => {
    try {
        const pool = await getConnection();
        const ch = await initConfirmChannel();
        if (!ch) {
            return; // Esperar al siguiente ciclo si el broker no está accesible
        }

        const pendientes = await pool.request().query(`
            SELECT TOP ${LOTE_MAX} id_evento, tipo, payload, intentos
            FROM EventoOutbox
            WHERE publicado_en IS NULL
            ORDER BY id_evento ASC
        `);

        if (pendientes.recordset.length === 0) {
            return;
        }

        console.log(`[OutboxPublisher] Procesando ${pendientes.recordset.length} evento(s) pendiente(s)...`);

        for (const ev of pendientes.recordset) {
            try {
                const messageBuffer = Buffer.from(ev.payload);
                ch.publish(
                    EXCHANGE_NAME,
                    ROUTING_KEY_DESPACHO,
                    messageBuffer,
                    {
                        persistent: true,
                        contentType: 'application/json',
                        headers: {
                            'outbox-event-id': ev.id_evento,
                            'tipo': ev.tipo
                        }
                    }
                );

                // Esperar confirmación de persistencia del broker RabbitMQ
                await ch.waitForConfirms();

                // Marcar como publicado
                await pool.request()
                    .input('id', sql.BigInt, ev.id_evento)
                    .query(`
                        UPDATE EventoOutbox 
                        SET publicado_en = SYSDATETIME() 
                        WHERE id_evento = @id
                    `);

                console.log(`[OutboxPublisher] Evento #${ev.id_evento} (${ev.tipo}) publicado y confirmado con éxito.`);

            } catch (pubErr) {
                console.error(`[OutboxPublisher] Error al publicar evento #${ev.id_evento}:`, pubErr.message);
                await pool.request()
                    .input('id', sql.BigInt, ev.id_evento)
                    .query(`
                        UPDATE EventoOutbox 
                        SET intentos = intentos + 1 
                        WHERE id_evento = @id
                    `);
                break; // Detener lote actual si hay caída de conexión
            }
        }

    } catch (dbErr) {
        console.warn('[OutboxPublisher] Error accediendo a la base de datos para eventos outbox:', dbErr.message);
    }
};

/**
 * Inicia el proceso recurrente del publicador
 */
const iniciarOutboxPublisher = () => {
    if (isRunning) return;
    isRunning = true;
    console.log(`[OutboxPublisher] Iniciado (revisión cada ${INTERVALO_MS / 1000}s).`);

    setInterval(async () => {
        await procesarEventosPendientes();
    }, INTERVALO_MS);
};

module.exports = {
    procesarEventosPendientes,
    iniciarOutboxPublisher
};

if (require.main === module) {
    iniciarOutboxPublisher();
}
