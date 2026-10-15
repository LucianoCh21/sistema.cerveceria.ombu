const PDFDocument = require('pdfkit');

/**
 * Servicio de Generación de Comprobantes PDF
 */
class ComprobanteService {
    generarTicketPdf(despacho, res) {
        const volumenLitros = (Number(despacho.mililitros_servidos) / 1000.0).toFixed(3);
        const clienteTexto = despacho.cliente_nombre 
            ? `${despacho.cliente_nombre} ${despacho.cliente_apellido}` 
            : 'Consumidor Final / Anónimo';

        const doc = new PDFDocument({ margin: 40, size: 'A6' });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=ticket-ombu-${despacho.id_despacho}.pdf`);

        doc.pipe(res);

        // Encabezado
        doc.fontSize(14).font('Helvetica-Bold').text('CERVECERÍA OMBÚ', { align: 'center' });
        doc.fontSize(9).font('Helvetica').text('Tap Wall Autoservicio NFC', { align: 'center' });
        doc.moveDown(0.5);
        doc.text('----------------------------------------------------', { align: 'center' });
        doc.moveDown(0.5);

        // Detalle de la transacción
        doc.fontSize(10).font('Helvetica-Bold').text(`COMPROBANTE N°: #${despacho.id_despacho}`);
        doc.fontSize(8).font('Helvetica')
            .text(`Fecha: ${new Date(despacho.fecha_hora).toLocaleString('es-AR')}`)
            .text(`Cliente: ${clienteTexto}`)
            .text(`Tarjeta NFC: ${despacho.id_tarjeta}`);

        doc.moveDown(0.8);
        doc.text('----------------------------------------------------', { align: 'center' });
        doc.moveDown(0.5);

        // Detalle del servido
        doc.fontSize(9).font('Helvetica-Bold').text('DETALLE DEL SERVIDO:');
        doc.fontSize(8).font('Helvetica')
            .text(`Canilla N°: ${despacho.id_canilla} — Cerveza: ${despacho.cerveza_nombre}`)
            .text(`Formato: ${despacho.formato_nombre} (${despacho.mililitros_servidos} ml)`)
            .text(`Volumen servido: ${volumenLitros} L`);

        doc.moveDown(0.8);
        doc.fontSize(10).font('Helvetica-Bold')
            .text(`IMPORTE COBRADO: $${Number(despacho.precio_cobrado).toFixed(2)}`, { align: 'right' });
        doc.fontSize(8).font('Helvetica')
            .text(`Saldo Restante Tarjeta: $${Number(despacho.saldo_actual).toFixed(2)}`, { align: 'right' });

        doc.moveDown(1);
        doc.fontSize(7).font('Helvetica-Oblique')
            .text('¡Gracias por disfrutar en Cervecería Ombú!', { align: 'center' })
            .text('Consumo responsable. Prohibida su venta a menores de 18 años.', { align: 'center' });

        doc.end();
    }
}

module.exports = new ComprobanteService();
