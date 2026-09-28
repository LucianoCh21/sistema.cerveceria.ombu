const amqp = require('amqplib');
require('dotenv').config();

const rabbitUrl = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const EXCHANGE_NAME = process.env.RABBITMQ_EXCHANGE || 'ombu.eventos';
const ROUTING_KEY_DESPACHO = 'despacho.confirmado';

let connection = null;
let channel = null;

const getRabbitChannel = async () => {
    if (channel) return channel;

    try {
        if (!connection) {
            connection = await amqp.connect(rabbitUrl);
            connection.on('error', (err) => {
                console.warn(`[RabbitMQ] Conexión interrumpida: ${err.message}`);
                connection = null;
                channel = null;
            });
            connection.on('close', () => {
                console.warn(`[RabbitMQ] Conexión cerrada. Reconectando en próximo llamado...`);
                connection = null;
                channel = null;
            });
        }

        channel = await connection.createChannel();
        // Declarar el exchange central del Tap Wall de tipo topic y durable
        await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });
        console.log(`[RabbitMQ] Canal establecido. Exchange '${EXCHANGE_NAME}' verificado.`);
        return channel;
    } catch (error) {
        console.warn(`[RabbitMQ] No se pudo establecer conexión inmediata con ${rabbitUrl}: ${error.message}`);
        channel = null;
        return null;
    }
};

/**
 * Publica el evento DespachoRealizado de forma no bloqueante hacia el exchange topic.
 * @param {object} payload - Cuerpo del evento con idDespacho, idCanilla, volumen, tarjeta, etc.
 * @returns {Promise<boolean>} - Indica si el mensaje fue enrutado al buffer del broker.
 */
const publishDespachoRealizado = async (payload) => {
    try {
        const ch = await getRabbitChannel();
        if (!ch) {
            console.warn('[RabbitMQ] Broker no disponible. Evento no publicado:', payload.eventId);
            return false;
        }

        const messageBuffer = Buffer.from(JSON.stringify(payload));
        const published = ch.publish(
            EXCHANGE_NAME,
            ROUTING_KEY_DESPACHO,
            messageBuffer,
            {
                persistent: true,
                contentType: 'application/json',
                timestamp: Date.now(),
                messageId: payload.eventId || undefined
            }
        );

        if (published) {
            console.log(`[RabbitMQ] Evento emitido -> Exchange: '${EXCHANGE_NAME}', Key: '${ROUTING_KEY_DESPACHO}', EventId: ${payload.eventId}`);
        }
        return published;
    } catch (error) {
        console.error(`[RabbitMQ] Error publicando evento DespachoRealizado:`, error.message);
        return false;
    }
};

module.exports = {
    getRabbitChannel,
    publishDespachoRealizado,
    EXCHANGE_NAME,
    ROUTING_KEY_DESPACHO
};
