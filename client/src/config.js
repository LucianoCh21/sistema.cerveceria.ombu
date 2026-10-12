/**
 * Ombú - Cervecería de Barrio | Configuración Centralizada del Cliente (F-21)
 * Determina dinámicamente la URL base de la API backend sin hardcodear localhost:3000.
 */

(function () {
    const origin = window.location.origin;
    // Si el frontend se sirve en un puerto diferente (ej. 5500 de live-server), redirigir al puerto 3000
    // Si está detrás de un proxy Nginx en producción (sin puerto o puerto estándar), usar /api relativo
    let apiBase = 'http://localhost:3000/api';
    
    if (origin && !origin.includes('file://')) {
        if (window.location.port) {
            apiBase = origin.replace(/:\d+$/, ':3000') + '/api';
        } else {
            apiBase = origin + '/api';
        }
    }

    window.OMBU_CONFIG = {
        API_BASE: apiBase,
        TERMINAL_TOKEN: 'terminal-secret-token-ombu'
    };
})();
