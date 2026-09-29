const amqp = require('amqplib');
const { getConnection, sql } = require('../config/db');
const redisExport = require('../config/redis');
const redisClient = redisExport.client || redisExport.redisClient || redisExport;

const iniciarConsumidor = async () => {
    try {
        const connection = await amqp.connect('amqp://localhost:5672');
        const channel = await connection.createChannel();

        const exchangeName = 'ombu.eventos';
        const queueName = 'stock.despachos.queue';
        const routingKey = 'despacho.confirmado';

        await channel.assertExchange(exchangeName, 'topic', { durable: true });
        await channel.assertQueue(queueName, { durable: true });
        await channel.bindQueue(queueName, exchangeName, routingKey);

        // console.log(`[*] Esperando mensajes en ${queueName}`);

        channel.consume(queueName, async (msg) => {
            if (msg !== null) {
                try {
                    const messageContent = JSON.parse(msg.content.toString());
                    // 1. Extraes los datos originales enviados por Lucrecia
                    const { idDespacho, idCanilla, volumenLitros } = JSON.parse(msg.content.toString()).data;

                    // 2. Generas un factor aleatorio entre 1.00 (0%) y 1.10 (10%)
                    const factorMerma = 1 + (Math.random() * 0.10);

                    // 3. Calculas el volumen real a descontar del barril
                    const volumenFinal = volumenLitros * factorMerma;

                    // 4. Espía visual para la consola (formateado a 3 decimales)
                    console.log(`🔎 [RABBITMQ] ID: ${idDespacho} | Pinta: ${volumenLitros}L | Descuento con merma: ${volumenFinal.toFixed(3)}L`);
                    const pool = await getConnection();
                    
                    // Crear la tabla de idempotencia si no existe
                    await pool.request().query("IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DespachoProcesadoStock') CREATE TABLE DespachoProcesadoStock (id_despacho BIGINT PRIMARY KEY, fecha_procesado DATETIME DEFAULT GETDATE());");
                    
                    const transaction = new sql.Transaction(pool);
                    await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

                    try {
                        const request = new sql.Request(transaction);
                        request.input('idDespacho', sql.BigInt, idDespacho);
                        request.input('idCanilla', sql.Int, idCanilla);
                        // CORRECCIÓN: Usamos volumenFinal en lugar de volumenLitros para aplicar la merma aleatoria
                        request.input('volumenFinal', sql.Decimal(10,2), volumenFinal);

                        // Verificar idempotencia
                        const idempotencyCheck = await request.query("SELECT 1 FROM DespachoProcesadoStock WHERE id_despacho = @idDespacho");
                        
                        if (idempotencyCheck.recordset.length > 0) {
                            // El mensaje ya se procesó antes
                            await transaction.commit();
                            channel.ack(msg);
                            return;
                        }

                        // Actualizar litros restantes usando volumenFinal
                        await request.query("UPDATE Barril SET litros_restantes = litros_restantes - @volumenFinal WHERE id_canilla = @idCanilla AND estado = 'Conectado'");
                        
                        // Actualizar estado a agotado si aplica
                        await request.query("UPDATE Barril SET estado = 'Agotado' WHERE id_canilla = @idCanilla AND estado = 'Conectado' AND litros_restantes <= 0");
                        
                        // Insertar en tabla de idempotencia
                        await request.query("INSERT INTO DespachoProcesadoStock (id_despacho) VALUES (@idDespacho)");

                        await transaction.commit();

                        // Invalida la caché de Redis
                        await redisClient.del('stock:muro:resumen');

                        channel.ack(msg);
                        
                    } catch (innerError) {
                        await transaction.rollback();
                        throw innerError;
                    }
                } catch (error) {
                    console.error('Error al procesar mensaje:', error);
                    channel.nack(msg, false, true);
                }
            }
        }, { noAck: false });

    } catch (error) {
        console.error('Error al iniciar el consumidor RabbitMQ:', error);
    }
};

module.exports = { iniciarConsumidor };
