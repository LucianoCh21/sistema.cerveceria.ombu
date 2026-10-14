const amqp = require('amqplib');
const { getConnection, sql } = require('../config/db');
const redisExport = require('../config/redis');
const redisClient = redisExport.client || redisExport.redisClient || redisExport;
require('dotenv').config();

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const EXCHANGE_NAME = process.env.RABBITMQ_EXCHANGE || 'ombu.eventos';
const QUEUE_NAME = 'stock.despachos.queue';
const ROUTING_KEY = 'despacho.confirmado';
const DLX_EXCHANGE = 'ombu.dlx';
const DLQ_QUEUE = 'stock.despachos.dlq';

let isConnecting = false;

const iniciarConsumidor = async () => {
    if (isConnecting) return;
    isConnecting = true;

    try {
        console.log(`[stockConsumer] Conectando a RabbitMQ en ${RABBITMQ_URL}...`);
        const connection = await amqp.connect(RABBITMQ_URL);

        connection.on('error', (err) => {
            console.warn(`[stockConsumer] Error de conexión RabbitMQ: ${err.message}`);
        });

        connection.on('close', () => {
            console.warn('[stockConsumer] Conexión cerrada con RabbitMQ. Reconectando en 5 segundos...');
            isConnecting = false;
            setTimeout(iniciarConsumidor, 5000);
        });

        const channel = await connection.createChannel();

        // Configuración de Dead Letter Exchange (DLX) y Dead Letter Queue (DLQ) (F-08)
        await channel.assertExchange(DLX_EXCHANGE, 'topic', { durable: true });
        await channel.assertQueue(DLQ_QUEUE, { durable: true });
        await channel.bindQueue(DLQ_QUEUE, DLX_EXCHANGE, '#');

        // Configuración de Exchange Principal y Cola con redirección a DLX en caso de nack sin requeue
        await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });

        try {
            await channel.assertQueue(QUEUE_NAME, {
                durable: true,
                deadLetterExchange: DLX_EXCHANGE
            });
        } catch (queueErr) {
            console.warn(`[stockConsumer] Reconfigurando cola ${QUEUE_NAME} para vincular DLX...`);
            const repairChannel = await connection.createChannel();
            await repairChannel.deleteQueue(QUEUE_NAME);
            await repairChannel.assertQueue(QUEUE_NAME, {
                durable: true,
                deadLetterExchange: DLX_EXCHANGE
            });
            await repairChannel.close();
        }

        await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, ROUTING_KEY);

        console.log(`[*] [stockConsumer] Escuchando eventos en ${QUEUE_NAME} (DLQ: ${DLQ_QUEUE} via ${DLX_EXCHANGE})`);

        channel.consume(QUEUE_NAME, async (msg) => {
            if (!msg) return;

            let parsedContent;
            try {
                parsedContent = JSON.parse(msg.content.toString());
            } catch (jsonErr) {
                console.error('[stockConsumer] Mensaje con formato JSON inválido:', jsonErr.message);
                // Si el mensaje es ininteligible, directo a la DLQ sin reintentos infinitos
                channel.nack(msg, false, false);
                return;
            }

            const data = parsedContent.data || parsedContent;
            const idDespacho = data.idDespacho || parsedContent.idDespacho;
            const idBarril = data.idBarril !== undefined ? data.idBarril : parsedContent.idBarril;

            try {
                console.log(`🍺 [stockConsumer] Evento recibido: Despacho #${idDespacho} | Barril #${idBarril}`);

                const pool = await getConnection();

                // Tabla de idempotencia para garantizar semántica exactly-once
                await pool.request().query(`
                    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DespachoProcesadoStock' AND xtype='U')
                    CREATE TABLE DespachoProcesadoStock (
                        id_despacho BIGINT PRIMARY KEY,
                        fecha_procesado DATETIME DEFAULT GETDATE()
                    );
                `);

                const transaction = new sql.Transaction(pool);
                await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

                try {
                    const request = new sql.Request(transaction);
                    request.input('idDespacho', sql.BigInt, idDespacho);

                    // 1. Verificación de Idempotencia previa
                    const idempotencyCheck = await request.query(
                        "SELECT 1 FROM DespachoProcesadoStock WHERE id_despacho = @idDespacho"
                    );

                    if (idempotencyCheck.recordset.length > 0) {
                        console.log(`[stockConsumer] Despacho #${idDespacho} ya fue procesado previamente. Omitiendo duplicado.`);
                        await transaction.commit();
                        channel.ack(msg);
                        return;
                    }

                    // 2. F-01: Actualizar el estado de la Canilla a 'Sin Stock' haciendo JOIN con Barril donde b.id_barril = @idBarril AND b.estado = 'Agotado'
                    // NOTA: El descuento físico de litros ya fue aplicado atómicamente por el controlador/servicio de Despacho.
                    if (idBarril) {
                        request.input('idBarril', sql.Int, idBarril);
                        await request.query(`
                            UPDATE c
                            SET c.estado = 'Sin Stock'
                            FROM Canilla c
                            INNER JOIN Barril b ON c.id_canilla = b.id_canilla
                            WHERE b.id_barril = @idBarril AND b.estado = 'Agotado'
                        `);
                    }

                    // 3. Registrar despacho en tabla de idempotencia
                    await request.query("INSERT INTO DespachoProcesadoStock (id_despacho) VALUES (@idDespacho)");

                    await transaction.commit();

                    // 4. Invalidar caché caliente en Redis
                    await redisClient.del('stock:muro:resumen');

                    // Confirmar procesamiento exitoso
                    channel.ack(msg);

                } catch (txError) {
                    try { await transaction.rollback(); } catch (_) {}
                    throw txError;
                }

            } catch (error) {
                console.error(`[stockConsumer] Error al procesar mensaje (Despacho #${idDespacho}):`, error.message);

                // F-08: Gestión de Dead Letter Queue (DLQ) mediante header 'x-reintentos'
                const headers = msg.properties.headers || {};
                const reintentos = Number(headers['x-reintentos'] || 0);

                if (reintentos < 3) {
                    const nuevosHeaders = {
                        ...headers,
                        'x-reintentos': reintentos + 1
                    };
                    console.warn(`[stockConsumer] Reintentando mensaje (intento ${reintentos + 1}/3)...`);
                    channel.sendToQueue(QUEUE_NAME, msg.content, {
                        persistent: true,
                        headers: nuevosHeaders
                    });
                    channel.ack(msg);
                } else {
                    console.error(`[stockConsumer] Máximo de reintentos alcanzado (3). Derivando a DLQ con nack.`);
                    channel.nack(msg, false, false);
                }
            }
        }, { noAck: false });

    } catch (error) {
        console.error('[stockConsumer] Error al inicializar consumidor RabbitMQ:', error.message);
        isConnecting = false;
        setTimeout(iniciarConsumidor, 5000);
    }
};

module.exports = { iniciarConsumidor };

if (require.main === module) {
    iniciarConsumidor();
}
