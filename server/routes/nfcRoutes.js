const express = require('express');
const router = express.Router();
const nfcController = require('../controllers/nfcController');

// POST /api/nfc/autenticar -> Aproximación y validación de tarjeta NFC (Inicia TTL 45s en Redis)
router.post('/autenticar', nfcController.autenticarTarjeta);

// GET /api/nfc/sesion/:uid -> Comprobación de estado de sesión efímera
router.get('/sesion/:uid', nfcController.consultarSesion);

// GET /api/nfc/tarjetas -> Listado de tarjetas NFC emitidas desde OmbuDB
router.get('/tarjetas', nfcController.getTarjetas);

// GET /api/nfc/formatos -> Formatos de servicio y precios vigentes según canilla/cerveza
router.get('/formatos', nfcController.getFormatosYPrecios);

module.exports = router;
