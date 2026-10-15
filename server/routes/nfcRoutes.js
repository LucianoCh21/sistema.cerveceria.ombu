const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/auth');
const nfcController = require('../controllers/nfcController');

// Middleware para /tarjetas: sólo admin o en modo demo para la terminal de pruebas
const allowAdminOrDemo = (req, res, next) => {
    if (process.env.DEMO_MODE === 'true') {
        return next();
    }
    return requireRole('admin')(req, res, next);
};

// POST /api/nfc/autenticar -> Aproximación y validación de tarjeta NFC (Inicia TTL 45s en Redis)
router.post('/autenticar', requireRole('terminal', 'admin'), nfcController.autenticarTarjeta);

// GET /api/nfc/sesion/:uid -> Comprobación de estado de sesión efímera
router.get('/sesion/:uid', requireRole('terminal', 'admin'), nfcController.consultarSesion);

// GET /api/nfc/tarjetas -> Listado de tarjetas NFC emitidas desde OmbuDB (Solo admin o modo demo)
router.get('/tarjetas', allowAdminOrDemo, nfcController.getTarjetas);

// GET /api/nfc/formatos -> Formatos de servicio y precios vigentes según canilla/cerveza
router.get('/formatos', requireRole('terminal', 'admin'), nfcController.getFormatosYPrecios);

module.exports = router;
