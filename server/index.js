require('dotenv').config();
const express = require('express');
const cors = require('cors');

const canillaRoutes = require('./routes/canillaRoutes');
const nfcRoutes = require('./routes/nfcRoutes');
const despachoRoutes = require('./routes/despachoRoutes');

const app = express();

// Middlewares globales
app.use(cors());
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
app.use('/api/canillas', canillaRoutes);
app.use('/api/v1/canillas', canillaRoutes);

// Módulo AE2: Lecturas NFC y Despachos (Lucrecia Sabrina Mencia)
app.use('/api/nfc', nfcRoutes);
app.use('/api/despachos', despachoRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🍺 API Cervecería Ombú escuchando en http://localhost:${PORT}`);
    console.log(`📡 Endpoints NFC:       POST /api/nfc/autenticar`);
    console.log(`🍻 Endpoints Despachos: POST /api/despachos`);
    console.log(`📄 Comprobante PDF:     GET  /api/despachos/:id/comprobante`);
    console.log(`====================================================`);
});