const express = require('express');
const cors = require('cors');
const canillaRoutes = require('./routes/canillaRoutes');
const barrilRoutes = require('./routes/barrilRoutes');

const app = express();

// Middleware de CORS para permitir peticiones desde el frontend
app.use(cors());

// Middleware para parseo de cuerpos JSON
app.use(express.json());

// Enrutamiento de la entidad Canilla (soporta /api/canillas y /api/v1/canillas)
app.use('/api/canillas', canillaRoutes);
app.use('/api/v1/canillas', canillaRoutes);

// Enrutamiento de la entidad Barriles
app.use('/api/v1/barriles', barrilRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`API de Cervecería Ombú escuchando en http://localhost:${PORT}`);
});