const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/auth');
const { 
    getCanillas, 
    getCanillaById, 
    createCanilla, 
    updateCanilla, 
    deleteCanilla 
} = require('../controllers/canillaController');

// Lecturas públicas para el muro de canillas
router.get('/', getCanillas);
router.get('/:id', getCanillaById);

// Operaciones de gestión protegidas exclusivamente para administradores
router.post('/', requireRole('admin'), createCanilla);
router.put('/:id', requireRole('admin'), updateCanilla);
router.delete('/:id', requireRole('admin'), deleteCanilla);

module.exports = router;