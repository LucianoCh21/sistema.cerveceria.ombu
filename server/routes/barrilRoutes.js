const express = require('express');
const router = express.Router();
const barrilController = require('../controllers/barrilController');

router.get('/', barrilController.getBarriles);
router.post('/conectar', barrilController.conectarBarril);
router.delete('/:id', barrilController.retirarBarril);

module.exports = router;