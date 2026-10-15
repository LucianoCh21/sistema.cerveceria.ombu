const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/auth');
const despachoController = require('../controllers/despachoController');

// POST /api/despachos -> Registrar despacho, debitar saldo y publicar a RabbitMQ (Terminal o Admin)
router.post('/', requireRole('terminal', 'admin'), despachoController.crearDespacho);

// GET /api/despachos/:id/comprobante -> Descarga de ticket digital en PDF
router.get('/:id/comprobante', despachoController.obtenerComprobante);

module.exports = router;
