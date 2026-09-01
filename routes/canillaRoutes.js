const express = require('express');
const router = express.Router();
const { 
    getCanillas, 
    getCanillaById, 
    createCanilla, 
    updateCanilla, 
    deleteCanilla 
} = require('../controllers/canillaController');

router.get('/', getCanillas);
router.get('/:id', getCanillaById);
router.post('/', createCanilla);
router.put('/:id', updateCanilla);
router.delete('/:id', deleteCanilla);

module.exports = router;