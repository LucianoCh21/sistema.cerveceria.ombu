/**
 * Middleware de Control de Acceso basado en Roles (RBAC)
 * Soporta roles mínimos: 'terminal' (lector/kiosco NFC) y 'admin' (personal y stock)
 * Para el alcance académico, utiliza tokens preconfigurados vía cabecera Authorization: Bearer <token>.
 */

const getTokens = () => {
    const adminToken = process.env.ADMIN_TOKEN || 'admin-secret-token-ombu';
    const terminalToken = process.env.TERMINAL_TOKEN || 'terminal-secret-token-ombu';

    return {
        [adminToken]: 'admin',
        [terminalToken]: 'terminal'
    };
};

const requireRole = (...roles) => (req, res, next) => {
    // Si no se especificaron roles permitidos, continuar
    if (!roles || roles.length === 0) {
        return next();
    }

    const authHeader = req.headers.authorization || req.headers['x-api-key'] || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    const TOKENS = getTokens();
    const rol = TOKENS[token];

    if (!token || !rol) {
        return res.status(401).json({
            ok: false,
            error: 'Acceso no autorizado. Se requiere token Bearer válido.',
            codigo: 'UNAUTHORIZED'
        });
    }

    if (!roles.includes(rol)) {
        return res.status(403).json({
            ok: false,
            error: 'No tenés permisos suficientes para realizar esta acción.',
            codigo: 'FORBIDDEN'
        });
    }

    req.user = { rol, token };
    req.rol = rol;
    next();
};

module.exports = {
    requireRole
};
