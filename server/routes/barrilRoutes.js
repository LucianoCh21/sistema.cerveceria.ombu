const express = require('express');
const router = express.Router();
const barrilController = require('../controllers/barrilController');

// GET: Obtener barriles (excluyendo los retirados)
router.get('/', barrilController.getBarriles);

// POST: Conectar un barril a una canilla
router.post('/conectar', barrilController.conectarBarril);

// DELETE: Retirar un barril (Soft Delete)
router.delete('/:id', barrilController.retirarBarril);

module.exports = router;
