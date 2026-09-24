const express = require('express');
const router = express.Router();
const despachoController = require('../controllers/despachoController');

// POST /api/despachos -> Registrar despacho, debitar saldo y publicar a RabbitMQ
router.post('/', despachoController.crearDespacho);

// GET /api/despachos/:id/comprobante -> Descarga de ticket digital en PDF
router.get('/:id/comprobante', despachoController.obtenerComprobante);

module.exports = router;
