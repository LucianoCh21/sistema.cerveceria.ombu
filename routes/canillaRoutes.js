const express = require('express');
const router = express.Router();
const { getCanillas, getCanillaById, createCanilla } = require('../controllers/canillaController');

router.get('/', getCanillas);
router.get('/:id', getCanillaById);
router.post('/', createCanilla);

module.exports = router;