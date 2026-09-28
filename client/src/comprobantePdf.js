/**
 * Ombú - Cervecería de Barrio | Gestor de Comprobantes Digitales PDF
 * Módulo de Lucrecia Sabrina Mencia (ae2/lecturas-nfc) - Día 5
 */

const ComprobanteManager = {
    API_BASE: 'http://localhost:3000/api',

    /**
     * Abre el comprobante PDF oficial emitido por el backend en una nueva pestaña
     * @param {number|string} idDespacho - ID del despacho procesado
     */
    abrirEnPestana(idDespacho) {
        if (!idDespacho) {
            console.error('ID de despacho requerido para abrir el comprobante.');
            return;
        }
        const url = `${this.API_BASE}/despachos/${idDespacho}/comprobante`;
        window.open(url, '_blank');
    },

    /**
     * Descarga forzada del comprobante PDF en disco del cliente
     * @param {number|string} idDespacho - ID del despacho procesado
     */
    async descargarArchivo(idDespacho) {
        if (!idDespacho) return;
        try {
            const url = `${this.API_BASE}/despachos/${idDespacho}/comprobante`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = `ticket-cerveceria-ombu-${idDespacho}.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(downloadUrl);
        } catch (error) {
            console.error('Error al descargar comprobante PDF:', error);
            // Fallback directo a ventana nueva
            this.abrirEnPestana(idDespacho);
        }
    }
};

window.ComprobanteManager = ComprobanteManager;
