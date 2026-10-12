const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const canillaRoutes = require('./routes/canillaRoutes');
const nfcRoutes = require('./routes/nfcRoutes');
const despachoRoutes = require('./routes/despachoRoutes');
const barrilRoutes = require('./routes/barrilRoutes');
const stockRoutes = require('./routes/stockRoutes');
const { iniciarConsumidor } = require('./workers/stockConsumer');
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

// Verificación de estado del servicio
app.get('/api/health', (req, res) => {
    res.status(200).json({
        ok: true,
        servicio: "Cervecería Ombú - Tap Wall API",
        version: "2.0.0",
        fecha: new Date().toISOString()
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🍺 API Cervecería Ombú escuchando en http://localhost:${PORT}`);
    console.log(`📡 Endpoints NFC:       POST /api/nfc/autenticar`);
    console.log(`🍻 Endpoints Despachos: POST /api/despachos`);
    console.log(`📄 Comprobante PDF:     GET  /api/despachos/:id/comprobante`);
    console.log(`📦 Endpoints Barriles:  GET/POST/DELETE /api/barriles`);
    console.log(`====================================================`);
});

iniciarConsumidor().then(() => console.log('Consumidor RabbitMQ iniciado')).catch(console.error);
iniciarOutboxPublisher();