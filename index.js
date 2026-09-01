const express = require('express');
const canillaRoutes = require('./routes/canillaRoutes');

const app = express();
app.use(express.json());

// Prefijo base para la entidad Canilla
app.use('/api/v1/canillas', canillaRoutes);

app.listen(3000, () => {
    console.log('API de Cervecería Ombú escuchando en http://localhost:3000');
});