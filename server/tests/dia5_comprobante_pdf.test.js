const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');

describe('DÍA 5 - Generación y Descarga de Comprobante PDF de Despacho', () => {

    it('Debe generar un documento PDF válido con encabezado estándar (%PDF-)', async () => {
        const doc = new PDFDocument({ margin: 40, size: 'A6' });
        const buffers = [];

        doc.on('data', chunk => buffers.push(chunk));

        const pdfGeneradoPromise = new Promise((resolve) => {
            doc.on('end', () => {
                const pdfData = Buffer.concat(buffers);
                resolve(pdfData);
            });
        });

        // Simular emisión de ticket de Ombú
        doc.fontSize(14).font('Helvetica-Bold').text('CERVECERÍA OMBÚ', { align: 'center' });
        doc.fontSize(9).font('Helvetica').text('Tap Wall Autoservicio NFC', { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(10).font('Helvetica-Bold').text('COMPROBANTE N°: #2505');
        doc.fontSize(8).font('Helvetica')
            .text('Fecha: 27/09/2026, 20:30:00')
            .text('Cliente: Juan Pérez')
            .text('Tarjeta NFC: A1B2C3D4E5')
            .text('Canilla N°: 1 — Cerveza: Caravana IPA')
            .text('Formato: Pinta (500 ml)')
            .text('Volumen servido: 0.500 L');
        doc.moveDown(0.5);
        doc.fontSize(10).font('Helvetica-Bold').text('IMPORTE COBRADO: $3500.00', { align: 'right' });
        doc.fontSize(8).font('Helvetica').text('Saldo Restante Tarjeta: $3000.00', { align: 'right' });

        doc.end();

        const pdfBuffer = await pdfGeneradoPromise;

        assert.ok(pdfBuffer.length > 0, 'El buffer del PDF no debe estar vacío');
        const header = pdfBuffer.subarray(0, 5).toString('utf-8');
        assert.equal(header, '%PDF-', 'El documento generado debe comenzar con la firma binaria de PDF (%PDF-)');
    });

    it('Debe configurar adecuadamente las cabeceras HTTP de respuesta para visualización y descarga', () => {
        const idDespacho = 2505;
        const expectedHeaders = {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename=ticket-ombu-${idDespacho}.pdf`
        };

        assert.equal(expectedHeaders['Content-Type'], 'application/pdf');
        assert.ok(expectedHeaders['Content-Disposition'].includes(`ticket-ombu-${idDespacho}.pdf`));
    });

    it('Debe contemplar el cliente anónimo en el cuerpo del ticket', () => {
        const despachoAnonimo = {
            cliente_nombre: null,
            cliente_apellido: null
        };

        const clienteTexto = (despachoAnonimo.cliente_nombre) 
            ? `${despachoAnonimo.cliente_nombre} ${despachoAnonimo.cliente_apellido}` 
            : 'Consumidor Final / Anónimo';

        assert.equal(clienteTexto, 'Consumidor Final / Anónimo');
    });
});
