const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const amqp = require('amqplib');
const Redis = require('ioredis');
const { getConnection } = require('./config/db');
const { getRedisClient } = require('./config/redis');

const canillaRoutes = require('./routes/canillaRoutes');
const nfcRoutes = require('./routes/nfcRoutes');
const despachoRoutes = require('./routes/despachoRoutes');
const barrilRoutes = require('./routes/barrilRoutes');
const stockRoutes = require('./routes/stockRoutes');
const { iniciarOutboxPublisher } = require('./workers/outboxPublisher');

const { requireRole } = require('./middleware/auth');

const app = express();

// Middlewares globales
const allowedOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5500';
app.use(cors({
    origin: (origin, callback) => {
        // Permitir peticiones sin origen (curl, server-to-server) o si coincide con el origen permitido
        if (!origin || origin === allowedOrigin || origin === 'http://localhost:3000' || origin === 'http://127.0.0.1:5500' || origin === 'http://localhost:5500') {
            return callback(null, true);
        }
        return callback(null, true); // Permisivo en desarrollo local, configurable en CLIENT_ORIGIN
    },
    credentials: true
}));
app.use(express.json());

// F-09: Endpoint GET /api/health con verificación activa de dependencias (SQL Server, Redis y RabbitMQ)
app.get('/api/health', async (req, res) => {
    let sqlserverStatus = 'ok';
    let redisStatus = 'ok';
    let rabbitmqStatus = 'ok';

    // 1. Verificación de SQL Server (SELECT 1)
    try {
        const pool = await Promise.race([
            getConnection(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout SQL Server')), 1500))
        ]);
        await pool.request().query('SELECT 1');
    } catch (err) {
        sqlserverStatus = 'caido';
    }

    // 2. Verificación de Redis (PING)
    try {
        const redisHost = process.env.REDIS_HOST || 'localhost';
        const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
        const singletonClient = getRedisClient();

        if (singletonClient.status === 'ready') {
            const pong = await singletonClient.ping();
            if (pong !== 'PONG') redisStatus = 'caido';
        } else {
            // Sonda rápida sin reintentos infinitos para no colgar el event loop ante desconexiones
            const tempRedis = new Redis({
                host: redisHost,
                port: redisPort,
                password: process.env.REDIS_PASSWORD || undefined,
                connectTimeout: 1000,
                maxRetriesPerRequest: 0,
                retryStrategy: () => null,
                lazyConnect: true
            });
            try {
                await tempRedis.connect();
                const pong = await tempRedis.ping();
                if (pong !== 'PONG') redisStatus = 'caido';
                tempRedis.disconnect(false);
            } catch (_) {
                tempRedis.disconnect(false);
                redisStatus = 'caido';
            }
        }
    } catch (err) {
        redisStatus = 'caido';
    }

    // 3. Verificación de RabbitMQ (AMQP Ping/Connect)
    try {
        const rabbitUrl = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
        const conn = await Promise.race([
            amqp.connect(rabbitUrl),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout RabbitMQ')), 1500))
        ]);
        await conn.close();
    } catch (err) {
        rabbitmqStatus = 'caido';
    }

    const todoOk = sqlserverStatus === 'ok' && redisStatus === 'ok' && rabbitmqStatus === 'ok';
    const statusCode = todoOk ? 200 : 503;

    return res.status(statusCode).json({
        ok: todoOk,
        servicios: {
            sqlserver: sqlserverStatus,
            redis: redisStatus,
            rabbitmq: rabbitmqStatus
        }
    });
});

// Enrutamiento de entidades del sistema
// Las lecturas GET son públicas, las mutaciones se protegen en canillaRoutes
app.use('/api/canillas', canillaRoutes);
app.use('/api/v1/canillas', canillaRoutes);

// Módulo AE2: Lecturas NFC y Despachos (Lucrecia Sabrina Mencia)
app.use('/api/nfc', nfcRoutes);
app.use('/api/despachos', despachoRoutes);

// Módulo AE2: Barriles y Control de Stock (Luciano Chesani) - Rutas protegidas para administración
app.use('/api/barriles', requireRole('admin'), barrilRoutes);
app.use('/api/stock', requireRole('admin'), stockRoutes);

// F-18 & F-21: Exportar 'app' limpio para pruebas automatizadas (supertest)
// El consumidor de RabbitMQ fue desacoplado a su propio proceso worker (workers/stockConsumer.js)
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`====================================================`);
        console.log(`🍺 API Cervecería Ombú escuchando en http://localhost:${PORT}`);
        console.log(`📡 Endpoints NFC:       POST /api/nfc/autenticar`);
        console.log(`🍻 Endpoints Despachos: POST /api/despachos`);
        console.log(`📄 Comprobante PDF:     GET  /api/despachos/:id/comprobante`);
        console.log(`📦 Endpoints Barriles:  GET/POST/DELETE /api/barriles`);
        console.log(`❤️  Health Check:        GET  /api/health`);
        console.log(`====================================================`);
    });

    iniciarOutboxPublisher();
}

module.exports = app;