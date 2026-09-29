const express = require('express');
const router = express.Router();
const stockController = require('../controllers/stockController');

// Ruta GET /resumen apuntando a stockController.getStockResumen
router.get('/resumen', stockController.getStockResumen);

module.exports = router;
