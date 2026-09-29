const express = require('express');
const router = express.Router();
const nfcController = require('../controllers/nfcController');

// POST /api/nfc/autenticar -> Aproximación y validación de tarjeta NFC (Inicia TTL 45s en Redis)
router.post('/autenticar', nfcController.autenticarTarjeta);

// GET /api/nfc/sesion/:uid -> Comprobación de estado de sesión efímera
router.get('/sesion/:uid', nfcController.consultarSesion);

module.exports = router;
