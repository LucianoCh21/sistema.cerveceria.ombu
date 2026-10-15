/**
 * Utilidad de Sanitización HTML contra Inyecciones XSS (F-05)
 * Escapa caracteres peligrosos provenientes de APIs o inputs del usuario.
 */

window.escapeHTML = function (valor) {
    return String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};
